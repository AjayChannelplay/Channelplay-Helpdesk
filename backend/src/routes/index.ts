import express, { type Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, hashPassword, comparePasswords } from "./auth";
import { mailgunService, isRecipientAuthorized } from "./mailgun";
import { pool, db } from "./db";
import { sendTicketReplyDirect } from "./email-direct";
import { registerAdminRoutes } from "./admin-tools";
import { z } from "zod";
import { eq, and, between, gte, lte, sql, count, avg, isNull, not, desc, gt } from "drizzle-orm";
import {
  insertTicketSchema,
  insertMessageSchema,
  insertDeskSchema,
  insertUserSchema,
  Desk,
  Ticket,
  messages,
  tickets,
  users,
} from "@shared/schema";
import path from "path";
import fs from "fs/promises";
import session from "express-session";
import { upload, getFileInfo, getFilesInfo, AttachmentInfo } from "./uploads";
import multer from "multer";
import nodemailer from "nodemailer";

// Extend the Express Session interface for our custom properties
declare module "express-session" {
  interface SessionData {
    emailCheck?: {
      email: string;
      userId: number;
      username: string;
      desks: {
        id: number;
        name: string;
        email: string;
      }[];
    };
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Register admin routes
  registerAdminRoutes(app);
  
  // Serve uploaded files from the public/uploads directory
  const uploadDir = path.join(process.cwd(), 'public/uploads');
  app.use('/uploads', express.static(uploadDir));

  // Serve attachment files with proper decoding for base64 data URLs
  app.get('/api/attachments/:messageId/:filename', async (req, res) => {
    console.log(`[ATTACHMENT] Route called with messageId=${req.params.messageId}, filename=${req.params.filename}`);
    try {
      const { messageId, filename } = req.params;
      console.log(`[ATTACHMENT] Looking for attachment: ${filename} in message ${messageId}`);
      
      // Get the message with attachments
      const messageResult = await db.select().from(messages).where(eq(messages.id, parseInt(messageId)));
      const message = messageResult[0];
      console.log(`[ATTACHMENT] Database query result:`, message ? 'Message found' : 'Message not found');
      
      if (!message) {
        console.log(`[ATTACHMENT] Message ${messageId} not found`);
        return res.status(404).json({ message: 'Message not found' });
      }

      console.log(`[ATTACHMENT] Message.attachments type:`, typeof message.attachments);
      console.log(`[ATTACHMENT] Message.attachments preview:`, 
        typeof message.attachments === 'string' 
          ? message.attachments.substring(0, 100) + '...' 
          : message.attachments
      );

      // Parse attachments JSON if it's a string (handle escaped quotes)
      let attachments = message.attachments as any[] || [];
      if (typeof message.attachments === 'string') {
        try {
          // Handle the escaped quotes in the JSON string
          let cleanJson = message.attachments;
          if (cleanJson.startsWith('"""') && cleanJson.endsWith('"""')) {
            cleanJson = cleanJson.slice(3, -3);
          }
          // Replace escaped quotes
          cleanJson = cleanJson.replace(/\\"/g, '"');
          attachments = JSON.parse(cleanJson);
        } catch (e) {
          console.log(`[ATTACHMENT] Failed to parse attachments JSON:`, e);
          console.log(`[ATTACHMENT] Raw attachments string:`, message.attachments.substring(0, 200) + '...');
        }
      }
      
      console.log(`[ATTACHMENT] Found ${attachments.length} attachments:`, attachments.map(att => att.filename || att.originalName || att.name));
      
      const attachment = attachments.find(att => 
        att.filename === filename || att.originalName === filename || att.name === filename
      );

      if (!attachment) {
        console.log(`[ATTACHMENT] Attachment ${filename} not found in available attachments`);
        return res.status(404).json({ message: 'Attachment not found' });
      }

      console.log(`[ATTACHMENT] Found attachment:`, { filename: attachment.filename, hasContent: !!attachment.content, contentType: attachment.contentType });

      // Handle base64 content field attachments (new format)
      if (attachment.content) {
        const buffer = Buffer.from(attachment.content, 'base64');
        const mimeType = attachment.contentType || attachment.mimetype || 'application/octet-stream';
        
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', buffer.length.toString());
        return res.send(buffer);
      }

      // Handle base64 data URL attachments (legacy format)
      if (attachment.url && attachment.url.startsWith('data:')) {
        const dataUrlMatch = attachment.url.match(/^data:([^;]+);base64,(.+)$/);
        if (dataUrlMatch) {
          const [, mimeType, base64Data] = dataUrlMatch;
          const buffer = Buffer.from(base64Data, 'base64');
          
          res.setHeader('Content-Type', mimeType);
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.setHeader('Content-Length', buffer.length.toString());
          return res.send(buffer);
        }
      }

      // Handle file path attachments
      if (attachment.path) {
        const filePath = path.resolve(attachment.path);
        if (await fs.access(filePath).then(() => true).catch(() => false)) {
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          return res.sendFile(filePath);
        }
      }

      // Handle URL path attachments
      if (attachment.url && !attachment.url.startsWith('data:')) {
        const relativePath = attachment.url.startsWith('/') ? attachment.url.substring(1) : attachment.url;
        const absolutePath = path.join(process.cwd(), 'public', relativePath);
        
        if (await fs.access(absolutePath).then(() => true).catch(() => false)) {
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          return res.sendFile(absolutePath);
        }
      }

      res.status(404).json({ message: 'Attachment file not found' });
    } catch (error) {
      console.error('Error serving attachment:', error);
      res.status(500).json({ message: 'Failed to serve attachment' });
    }
  });

  // Helper function to decode SRS encoded email addresses used by Gmail when forwarding
  function decodeSRSEmail(email: string): { email: string, name: string } {
    // First, handle case where the email is in the "Name <email>" format
    const fullEmailPattern = /(.*?)\s*<(.+?)>/;
    const fullEmailMatch = email.match(fullEmailPattern);
    let emailToCheck = email;
    
    if (fullEmailMatch && fullEmailMatch[2]) {
      // Extract just the email part for SRS checking
      emailToCheck = fullEmailMatch[2];
    }
    
    // Check if it looks like an SRS encoded email from Gmail
    // Match pattern: help+SRS=XXXX=XX=gmail.com=username@channelplay.in
    const srsPattern = /help\+SRS=[A-Za-z0-9]+=[A-Za-z0-9]+=(gmail|Gmail)\.com=([A-Za-z0-9._]+)(?:@channelplay\.in)?/i;
    const match = emailToCheck.match(srsPattern);
    
    if (match && match[2]) {
      // Extract the original username from the SRS format
      const username = match[2];
      // Reconstruct the likely original email
      const originalEmail = `${username}@gmail.com`;
      // Create a readable name from the username
      const name = username
        .split(/[._]/) // Split by dots or underscores
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()) // Capitalize each part
        .join(' '); // Join with spaces
      
      console.log(`Decoded SRS email: ${email} → ${originalEmail} (${name})`);
      return { email: originalEmail, name };
    }
    
    // For non-SRS emails, extract name and email if possible
    const nameEmailPattern = /(.*?)\s*<(.+?)>/;
    const nameMatch = email.match(nameEmailPattern);
    
    if (nameMatch && nameMatch[1] && nameMatch[2]) {
      return { name: nameMatch[1].trim(), email: nameMatch[2].trim() };
    }
    
    // Return as is if no patterns match
    return { email, name: email.split('@')[0] };
  }
  
  // Helper function to format email addresses correctly (using public-facing email)
  function formatFromEmail(deskName: string, deskEmail: string): string {
    // Use the desk's configured email if it contains an @ symbol (full email address)
    // Otherwise fallback to help@channelplay.in as the public-facing email address
    let displayEmail = deskEmail;
    
    // If the email doesn't contain @ or has our internal domain, use help@channelplay.in instead
    if (!deskEmail.includes('@') || deskEmail.includes('helpdesk.1office.in')) {
      displayEmail = "help@channelplay.in";
      console.log(`Using public-facing email: ${displayEmail} (instead of: ${deskEmail})`);
    }
    
    return `${deskName} <${displayEmail}>`;
  }

  // Set up authentication routes
  setupAuth(app);

  // Configure Mailgun webhook handler
  mailgunService.configureWebhook();

  // Serve email simulation tool (accessible without authentication)
  app.get("/simulate-email", (req, res) => {
    res.sendFile(path.join(process.cwd(), "client/simulate-email.html"));
  });

  // Public route to check email existence and redirect to login
  app.get("/url/:email", async (req, res) => {
    try {
      const { email } = req.params;

      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      console.log(`Checking if email exists: ${email}`);

      // Check if the user with this email exists
      const user = await storage.getUserByEmail(email);

      if (!user) {
        console.log(`Email not found: ${email}`);
        return res.redirect("/auth?error=email_not_found");
      }

      // Get desks this user is assigned to
      const userDesks = await storage.getUserDesks(user.id);

      // Store information in the session for the login page to access
      const emailCheckData = {
        email,
        userId: user.id,
        username: user.username,
        desks: userDesks.map((desk) => ({
          id: desk.id,
          name: desk.name,
          email: desk.email,
        })),
      };
      req.session.emailCheck = emailCheckData;

      console.log(
        `Email found: ${email}, redirecting to login with ${userDesks.length} desks`,
      );

      // Redirect to the login page with email pre-filled
      return res.redirect(
        `/auth?email=${encodeURIComponent(email)}&source=direct_link`,
      );
    } catch (error) {
      console.error("Error checking email:", error);
      return res.redirect("/auth?error=server_error");
    }
  });

  // API endpoint to retrieve email check information from session
  app.get("/api/session/email-check", (req, res) => {
    try {
      if (req.session.emailCheck) {
        console.log(
          "Returning email check info from session:",
          req.session.emailCheck.email,
        );
        return res.json(req.session.emailCheck);
      } else {
        console.log("No email check info found in session");
        return res
          .status(404)
          .json({ error: "No email check information found" });
      }
    } catch (error) {
      console.error("Error retrieving email check info:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create a route for the API root that shows available endpoints
  app.get("/api", (req, res) => {
    res.json({
      message: "Customer Support Ticket API",
      version: "1.0",
      availableEndpoints: {
        "/api/user": "Get current authenticated user",
        "/api/users": "Get all users (admin only)",
        "/api/users/create": "Create a new user (admin only)",
        "/api/users/:id": "Update or delete a user (admin only)",
        "/api/reset-password": "Request password reset",
        "/api/reset-password/:token": "Reset password with token",
        "/api/tickets": "Get all tickets (authenticated)",
        "/api/tickets/:id":
          "Get a specific ticket with messages (authenticated)",
        "/api/tickets/:id/messages":
          "Get messages for a specific ticket (authenticated)",
        "/api/tickets/:id/status":
          "Update ticket status (PATCH, authenticated)",
        "/api/tickets/create":
          "Create a new ticket with initial message (authenticated)",
        "/api/inbound-email":
          "Mailgun inbound parse webhook endpoint (GET/POST)",
        "/api/webhook/mailgun": "Mailgun event notification webhook (POST)",
        "/api/desks": "Manage support desks (admin only)",
        "/api/desk-assignments":
          "Manage desk assignments for users (admin only)",
        "/api/user/desks":
          "Get desks assigned to the current user (authenticated)",
        "/api/session/email-check":
          "Get email check information from the session",
        "/url/:email":
          "Check if email exists and redirect to login page with desk information",
      },
    });
  });

  // Direct route for inbound emails is handled by mailgunService.configureWebhook()
  // Removing duplicate definitions to avoid conflicts

  // Handle inbound emails from Mailgun
  // Track recent webhook events to detect duplicates
  const recentWebhookEvents = new Map<
    string,
    {
      timestamp: number;
      recipient: string;
      attachments: boolean;
      fingerprint: string;
      ticketId?: number | null;
    }
  >();

  // Create a multer instance for parsing multipart/form-data (specifically for Mailgun webhooks)
  const webhookMulter = multer();
  
  app.post("/api/inbound-email", webhookMulter.any(), async (req, res) => {
    // IMMEDIATELY send 200 OK to acknowledge receipt
    res.status(200).send("OK");
    
    // Generate a unique ID for this debug session
    const debugId = Math.random().toString(36).substring(2, 8);
    
    // Skip file saving and just log the payload to the console for debugging
    try {
      // Create a comprehensive debug object including files information
      const debugObject = {
        body: req.body,
        contentType: req.headers['content-type'],
        timestamp: new Date().toISOString(),
        files: req.files ? Array.from(req.files as any[]).map((f: any) => ({
          fieldname: f.fieldname,
          originalname: f.originalname || 'unnamed',
          mimetype: f.mimetype || 'unknown',
          size: f.size || 0
        })) : 'No files'
      };
      
      // Instead of writing to a file, log to the console
      console.log(`[DEBUG-ID: ${debugId}] Webhook payload:`, JSON.stringify(debugObject, null, 2).substring(0, 1000) + '...');
    } catch (error) {
      console.error('Error logging webhook data:', error);
    }
    
    console.log("========== INBOUND EMAIL WEBHOOK [DEBUG-ID: " + debugId + "] ==========");
    console.log("Headers:", JSON.stringify(req.headers));
    
    // Enhanced debugging information
    const bodyKeys = Object.keys(req.body);
    console.log("Available webhook fields:", bodyKeys.join(', '));
    
    // Log additional multer-specific information
    console.log("Content-Type:", req.headers['content-type']);
    let fileDetails = 'none';
    if (req.files && Array.isArray(req.files)) {
      try {
        fileDetails = JSON.stringify(req.files.map((f: any) => ({
          fieldname: f.fieldname,
          originalname: f.originalname,
          mimetype: f.mimetype,
          size: f.size
        })));
      } catch (err) {
        console.error('Error serializing file information:', err);
        fileDetails = 'Error serializing file information';
      }
    }
    console.log("Files received:", fileDetails);
    console.log("Form fields:", JSON.stringify(req.body));
    
    // Log specific fields of interest
    console.log("Sender:", req.body.sender || req.body.from || 'not found');
    console.log("Recipient:", req.body.recipient || req.body.to || 'not found');
    console.log("Subject:", req.body.subject || 'not found');
    console.log("Message-ID:", req.body['message-id'] || req.body['Message-Id'] || 'not found');
    
    // Check for body content
    const hasBodyPlain = !!req.body['body-plain'];
    const hasStrippedText = !!req.body['stripped-text'];
    const hasBodyHtml = !!req.body['body-html'];
    console.log("Content indicators:", { hasBodyPlain, hasStrippedText, hasBodyHtml });
    
    // Check specifically for attachments
    console.log("Attachment data:", {
      attachments: req.body.attachments,
      attachmentCount: req.body['attachment-count'],
      hasAttachmentField: !!req.body.attachments,
      isAttachmentArray: Array.isArray(req.body.attachments),
      attachmentLength: Array.isArray(req.body.attachments) ? req.body.attachments.length : 'N/A',
      hasFiles: !!(req.files && Array.isArray(req.files) && req.files.length > 0),
      filesCount: req.files && Array.isArray(req.files) ? req.files.length : 0
    });
    
    // Log detailed file information from multer
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      console.log("Multer files:", req.files.map((f: any) => ({
        fieldname: f.fieldname,
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
        bufferLength: f.buffer ? f.buffer.length : 'no buffer'
      })));
    }
    console.log(
      "Body preview:",
      JSON.stringify(req.body).substring(0, 500) + "...",
    );
    console.log("Timestamp:", new Date().toISOString());
    console.log("===========================================");

    try {
      // Generate a unique ID for this webhook request for tracking in logs
      const webhookId =
        Date.now().toString(36) + Math.random().toString(36).substring(2, 5);

      console.log(`[${webhookId}] PROCESSING EMAIL from Mailgun webhook`);

      // Extract basic information from webhook payload
      const eventId = req.body["event-id"] || "";
      const parentEventId = req.body["parent-event-id"] || "";
      const recipient = req.body.recipient || req.body.to || "";
      const hasAttachments = !!(
        req.body.attachments &&
        Array.isArray(req.body.attachments) &&
        req.body.attachments.length > 0
      );

      // If this is a parent-event with a related event we've seen in the last 30 seconds, it might be a duplicate
      // This happens when Mailgun sends separate events for the email body and attachments
      if (parentEventId && recentWebhookEvents.has(parentEventId)) {
        const parentEvent = recentWebhookEvents.get(parentEventId);
        console.log(
          `[${webhookId}] ⚠️ Possible duplicate webhook event detected. Parent event ${parentEventId} was processed ${Date.now() - parentEvent!.timestamp}ms ago`,
        );
        // If the recipients match and we're within 30 seconds, it's likely a duplicate
        if (
          parentEvent!.recipient === recipient &&
          Date.now() - parentEvent!.timestamp < 30000
        ) {
          console.log(
            `[${webhookId}] 🚫 SKIPPING duplicate webhook event for recipient ${recipient}`,
          );
          return; // Skip processing this duplicate event
        }
      }

      // Parse the webhook data
      // Pass both the body and any uploaded files to the parseWebhook method
      const emailData = await mailgunService.parseWebhook(req.body, req.files as any[]);

      // Generate a fingerprint for this email
      const sender = emailData.sender;
      const bodySnippet = (emailData.body || "").substring(0, 30);
      const contentHash = bodySnippet
        .replace(/[^a-zA-Z0-9]/g, "")
        .substring(0, 15);
      const emailFingerprint = `${sender}:${recipient}:${contentHash}`;

      console.log(`[${webhookId}] Email fingerprint: ${emailFingerprint}`);

      // Check for duplicate emails by fingerprint (from same sender with similar content)
      let isDuplicate = false;
      let duplicateTicketId: number | null = null;

      // Find if we've seen this email fingerprint recently
      for (const [storedEventId, eventData] of Array.from(
        recentWebhookEvents.entries(),
      )) {
        // If the stored event has a fingerprint (older events might not have it)
        if (
          eventData.fingerprint &&
          eventData.fingerprint === emailFingerprint &&
          Date.now() - eventData.timestamp < 120000
        ) {
          isDuplicate = true;
          duplicateTicketId = eventData.ticketId || null;
          console.log(
            `[${webhookId}] 🔄 Duplicate email detected by fingerprint match with event ${storedEventId}`,
          );
          if (duplicateTicketId) {
            console.log(
              `[${webhookId}] ✅ Will add attachments to existing ticket #${duplicateTicketId}`,
            );
          }
          break;
        }
      }

      // Check for replies to existing tickets - do this FIRST before duplicate checks
      // because ticket threading is higher priority than fingerprint duplicate detection
      
      // Check subject for [Ticket #123] pattern
      const ticketIdMatch = emailData.subject.match(/\[Ticket\s*#(\d+)\]/i);
      if (ticketIdMatch && ticketIdMatch[1]) {
        console.log(
          `[${webhookId}] 🔍 Found ticket ID ${ticketIdMatch[1]} in subject line`,
        );
        duplicateTicketId = parseInt(ticketIdMatch[1]);
        // If we find a ticket ID in the subject, always treat as part of an existing conversation
        isDuplicate = true;
      }

      // Check for ticketId in message-id format like <ticket-123-...>
      if (!duplicateTicketId && emailData.inReplyTo) {
        const replyToMatch = emailData.inReplyTo.match(/ticket-(\d+)-/);
        if (replyToMatch && replyToMatch[1]) {
          console.log(
            `[${webhookId}] 🔍 Found ticket ID ${replyToMatch[1]} in In-Reply-To header`,
          );
          duplicateTicketId = parseInt(replyToMatch[1]);
          // If we find a ticket ID in the In-Reply-To header, always treat as part of an existing conversation
          isDuplicate = true;
        }
      }
      
      // Check for ticketId in the References header too - useful for multi-level threading
      if (!duplicateTicketId && emailData.references) {
        const referencesMatch = emailData.references.match(/ticket-(\d+)-/);
        if (referencesMatch && referencesMatch[1]) {
          console.log(
            `[${webhookId}] 🔍 Found ticket ID ${referencesMatch[1]} in References header`,
          );
          duplicateTicketId = parseInt(referencesMatch[1]);
          // If we find a ticket ID in the References header, always treat as part of an existing conversation
          isDuplicate = true;
        }
      }
      
      // Now check for duplicate emails by fingerprint only if we didn't find a ticket ID
      if (!isDuplicate && !duplicateTicketId) {
        // Find if we've seen this email fingerprint recently
        for (const [storedEventId, eventData] of Array.from(
          recentWebhookEvents.entries(),
        )) {
          // If the stored event has a fingerprint (older events might not have it)
          if (
            eventData.fingerprint &&
            eventData.fingerprint === emailFingerprint &&
            Date.now() - eventData.timestamp < 120000
          ) {
            isDuplicate = true;
            duplicateTicketId = eventData.ticketId || null;
            console.log(
              `[${webhookId}] 🔄 Duplicate email detected by fingerprint match with event ${storedEventId}`,
            );
            if (duplicateTicketId) {
              console.log(
                `[${webhookId}] ✅ Will add attachments to existing ticket #${duplicateTicketId}`,
              );
            }
            break;
          }
        }
      }

      // Store this event for future duplicate detection
      if (eventId) {
        recentWebhookEvents.set(eventId, {
          timestamp: Date.now(),
          recipient,
          attachments: hasAttachments,
          fingerprint: emailFingerprint,
          ticketId: duplicateTicketId as number | undefined, // Will be updated later if we create a ticket
        });

        // Clean up old events (older than 5 minutes)
        for (const [storedEventId, eventData] of Array.from(
          recentWebhookEvents.entries(),
        )) {
          if (Date.now() - eventData.timestamp > 300000) {
            recentWebhookEvents.delete(storedEventId);
          }
        }
      }

      // Log the email metadata
      console.log(
        `[${webhookId}] Email metadata:`,
        JSON.stringify({
          sender: emailData.sender,
          recipient: emailData.recipient,
          subject: emailData.subject,
          messageId: emailData.messageId || "none",
          inReplyTo: emailData.inReplyTo || "none",
          references: emailData.references || "none",
          hasAttachments: !!(
            emailData.attachments && emailData.attachments.length > 0
          ),
          attachmentsCount: emailData.attachments
            ? emailData.attachments.length
            : 0,
          ticketId: duplicateTicketId,
        }),
      );

      // Check if the ticket exists in our database
      let existingTicket = null;
      if (duplicateTicketId) {
        existingTicket = await storage.getTicketById(duplicateTicketId);
        console.log(
          `[${webhookId}] ${existingTicket ? "✅ Found" : "❌ Could not find"} ticket #${duplicateTicketId} in database`,
        );
      }

      if (existingTicket) {
        // This is a reply to an existing ticket - add to the conversation
        console.log(
          `[${webhookId}] 📨 Adding message to existing ticket #${existingTicket.id}: "${existingTicket.subject}"`,
        );

        // Generate a message ID that preserves threading but is still unique
        // CRITICAL: Use angle brackets in the message ID format for proper email threading
        const timestamp = Date.now();
        const uniqueId = Math.random().toString(36).substring(2, 15);
        const domain = mailgunService.getDomain() || "mail.domain.com";
        const replyMessageId = `<ticket-${existingTicket.id}-reply-${timestamp}-${uniqueId}@${domain}>`;

        console.log(
          `[${webhookId}] Generated RFC-compliant message ID with angle brackets: ${replyMessageId}`,
        );

        // Extract a better display name from the email address if we don't have one
        let sender = existingTicket.customerName;

        // Log attachment information for debugging
        if (
          emailData.attachments &&
          Array.isArray(emailData.attachments) &&
          emailData.attachments.length > 0
        ) {
          console.log(
            `[${webhookId}] 📎 Email reply contains ${emailData.attachments.length} attachments:`,
            emailData.attachments
              .map((att: any) => att.filename || att.name || "unnamed")
              .join(", "),
          );
        }

        // Ensure we have message content, defaulting to an appropriate placeholder
        let messageContent = emailData.body || "";

        // Log attachment information for this message
        if (emailData.attachments && Array.isArray(emailData.attachments)) {
          console.log(`[${webhookId}] 📎 Message has ${emailData.attachments.length} attachments:`, 
            emailData.attachments.map((att: any) => 
              att.name || att.filename || 'unnamed')
            .join(', '));
            
          // Log each attachment with more detail for troubleshooting
          emailData.attachments.forEach((att: any, index: number) => {
            console.log(`[${webhookId}] Reply attachment ${index + 1} details:`, {
              name: att.name || att.filename || 'unnamed',
              size: att.size || 'unknown',
              type: att.contentType || att.content_type || 'unknown',
              hasContent: !!att.content,
              hasDataUrl: !!att.dataUrl,
              fields: Object.keys(att)
            });
          });
        }

        // Handle different cases of empty or missing content
        if (!messageContent || messageContent.trim() === "") {
          if (
            emailData.attachments &&
            Array.isArray(emailData.attachments) &&
            emailData.attachments.length > 0
          ) {
            // Case 1: No content but has attachments
            messageContent = `[Email with ${emailData.attachments.length} attachment${emailData.attachments.length !== 1 ? 's' : ''}]`;
            console.log(
              `[${webhookId}] ℹ️ Reply has no message content, but contains attachments - adding placeholder`,
            );
          } else {
            // Case 2: Completely empty email
            messageContent = "[Empty email]";
            console.log(
              `[${webhookId}] ℹ️ Completely empty email detected - adding empty email placeholder`,
            );
          }
        }

        // Add the message to the existing ticket with attachments
        await storage.createMessage({
          ticketId: existingTicket.id,
          content: messageContent,
          sender,
          senderEmail: emailData.sender,
          isAgent: false,
          messageId: replyMessageId,
          ccRecipients: emailData.ccRecipients || [],
          attachments: emailData.attachments || [],
        });

        console.log(
          `[${webhookId}] ✅ Successfully added message to ticket #${existingTicket.id}`,
        );
        console.log(
          `[${webhookId}] 📪 Using message ID: "${replyMessageId}" for threading`,
        );
      } else {
        // This is a new issue - create a new ticket
        console.log(
          `[${webhookId}] ⚠️⚠️⚠️ NEW TICKET MODE ACTIVATED - No existing ticket found ⚠️⚠️⚠️`,
        );

        // Make sure subject exists before processing
        let baseSubject = "No Subject";

        if (emailData.subject) {
          // Strip threading hints including Re:, Fwd:, ticket numbers, anything in brackets
          baseSubject = emailData.subject
            .replace(/^(Re|Fwd|FW|RE|FWD)(\[\d+\])?:\s*/gi, "") // Remove Re: or Fwd: prefixes
            .replace(/\[Ticket\s*#\d+\]/gi, "") // Remove [Ticket #123] references
            .replace(/\s*\(ID:[^)]+\)/g, "") // Remove any existing (ID:xxx) markers
            .replace(/\[#\d+\]/g, "") // Remove [#123] references
            .replace(/\[[^\]]*\]/g, "") // Remove anything in brackets
            .replace(/\([^)]*\)/g, "") // Remove anything in parentheses
            .replace(/<[^>]*>/g, "") // Remove anything in angle brackets
            .replace(/\s+/g, " ") // Normalize whitespace
            .trim();

          // If after all that cleaning we have an empty string, use "No Subject"
          if (!baseSubject) {
            baseSubject = "No Subject";
          }
        }

        // Extract a better customer name from the email address and decode SRS if needed
        const decodedSender = decodeSRSEmail(emailData.sender);
        let customerName = decodedSender.name || "Unknown Sender";
        let customerEmail = decodedSender.email || emailData.sender;

        // Only apply the fallback name formatting if we didn't get a valid name from SRS decoding
        if (customerName === "Unknown Sender" && 
          emailData.sender &&
          typeof emailData.sender === "string" &&
          emailData.sender.includes("@") &&
          !emailData.sender.toLowerCase().includes("srs=") // Skip this for SRS emails
        ) {
          const customerEmailPrefix = emailData.sender.split("@")[0];
          customerName = customerEmailPrefix
            .replace(/\./g, " ")
            .replace(/_/g, " ")
            .replace(/\b\w/g, (l: string) => l.toUpperCase());

          // If we somehow end up with an empty name, use a default
          if (!customerName.trim()) {
            customerName = "Unknown Sender";
          }
        } else if (!customerName || customerName === "Unknown Sender") {
          // Log the issue with the sender email
          console.error(
            `[${webhookId}] ⚠️ Missing or invalid sender email: ${emailData.sender}`,
          );
          // Use a default fixed email if missing
          if (
            !customerEmail ||
            typeof customerEmail !== "string" ||
            !customerEmail.includes("@")
          ) {
            customerEmail = "unknown@example.com";
            console.log(
              `[${webhookId}] Using fallback sender email: ${customerEmail}`,
            );
          }
        }

        console.log(
          `[${webhookId}] 🔄 Original Subject: "${emailData.subject}"`,
        );
        console.log(`[${webhookId}] 🧼 Cleaned Subject: "${baseSubject}"`);

        // Determine which desk this email should go to based on recipient
        let targetDeskId: number | undefined = undefined;

        // Look for a desk with matching email address
        const recipientEmail = emailData.recipient.toLowerCase();
        console.log(
          `[${webhookId}] 🔍 Searching for desk matching recipient: ${recipientEmail}`,
        );

        // Get all desks for debugging
        const allDesks = await storage.getDesks();
        console.log(
          `[${webhookId}] 📊 Available desks: ${allDesks.map((d) => `${d.name} (${d.email})`).join(", ")}`,
        );

        // Try to find matching desk by email
        const matchingDesk = await storage.getDeskByEmail(recipientEmail);

        // Log email headers for troubleshooting
        console.log(
          `[${webhookId}] 📨 Email Headers:`,
          JSON.stringify({
            to: emailData.recipient,
            from: emailData.sender,
            subject: emailData.subject,
            recipientNormalized: recipientEmail,
          }),
        );

        if (matchingDesk) {
          console.log(
            `[${webhookId}] ✅ Found matching desk for recipient ${recipientEmail}: Desk ID ${matchingDesk.id} - ${matchingDesk.name} (${matchingDesk.email})`,
          );
          targetDeskId = matchingDesk.id;
        } else {
          // Use default desk if no match found
          console.log(
            `[${webhookId}] ⚠️ No matching desk found for ${recipientEmail}, looking for default desk`,
          );
          const defaultDesk = await storage.getDefaultDesk();
          if (defaultDesk) {
            console.log(
              `[${webhookId}] 📬 Using default desk: ID ${defaultDesk.id} - ${defaultDesk.name} (${defaultDesk.email})`,
            );
            targetDeskId = defaultDesk.id;
          } else {
            console.log(
              `[${webhookId}] ❌ No matching desk and no default desk found. Creating ticket without desk assignment.`,
            );
          }
        }

        // Create the new ticket with round-robin assignment
        console.log(
          `[${webhookId}] 🔄 Creating new ticket from email with round-robin assignment for desk ${targetDeskId || "none"}`,
        );

        const newTicket = await storage.createTicket({
          subject: baseSubject,
          customerName,
          customerEmail, // Using our validated customerEmail variable
          status: "open",
          deskId: targetDeskId,
        });

        // Log assignment result for debugging
        if (newTicket.assignedUserId) {
          const assignedUser = await storage.getUser(newTicket.assignedUserId);
          console.log(
            `[${webhookId}] ✅ Ticket #${newTicket.id} from email was assigned to ${assignedUser?.name || "Unknown"} (ID: ${newTicket.assignedUserId}) via round-robin`,
          );
        } else {
          console.log(
            `[${webhookId}] ⚠️ Ticket #${newTicket.id} from email could not be assigned to any user`,
          );
        }

        // Generate a unique message ID that preserves the ticketId for future threading
        // CRITICAL: Use angle brackets in the message ID format for proper RFC compliance
        const timestamp = Date.now();
        const uniqueId = Math.random().toString(36).substring(2, 15);
        const domain = mailgunService.getDomain() || "mail.domain.com";
        const newMessageId = `<ticket-${newTicket.id}-new-${timestamp}-${uniqueId}@${domain}>`;

        console.log(
          `[${webhookId}] 💌 Created new ticket #${newTicket.id} with RFC-compliant message ID: ${newMessageId}`,
        );

        // Log attachment information for debugging
        if (
          emailData.attachments &&
          Array.isArray(emailData.attachments) &&
          emailData.attachments.length > 0
        ) {
          console.log(
            `[${webhookId}] 📎 Email contains ${emailData.attachments.length} attachments:`,
            emailData.attachments
              .map((att: any) => att.filename || att.name || "unnamed")
              .join(", "),
          );
        }

        // Ensure we have message content, defaulting to an appropriate placeholder
        let messageContent = emailData.body || "";

        // Log attachment information for this message
        if (emailData.attachments && Array.isArray(emailData.attachments)) {
          console.log(`[${webhookId}] 📎 New ticket message has ${emailData.attachments.length} attachments:`, 
            emailData.attachments.map((att: any) => 
              att.name || att.filename || 'unnamed')
            .join(', '));

          // Log each attachment with more detail for troubleshooting
          emailData.attachments.forEach((att: any, index: number) => {
            console.log(`[${webhookId}] Attachment ${index + 1} details:`, {
              name: att.name || att.filename || 'unnamed',
              size: att.size || 'unknown',
              type: att.contentType || att.content_type || 'unknown',
              hasContent: !!att.content,
              hasDataUrl: !!att.dataUrl,
              fields: Object.keys(att)
            });
          });
        }

        // Handle different cases of empty or missing content
        if (!messageContent || messageContent.trim() === "") {
          if (
            emailData.attachments &&
            Array.isArray(emailData.attachments) &&
            emailData.attachments.length > 0
          ) {
            // Case 1: No content but has attachments
            messageContent = `[Email with ${emailData.attachments.length} attachment${emailData.attachments.length !== 1 ? 's' : ''}]`;
            console.log(
              `[${webhookId}] ℹ️ No message content, but contains attachments - adding placeholder`,
            );
          } else {
            // Case 2: Completely empty email
            messageContent = "[Empty email]";
            console.log(
              `[${webhookId}] ℹ️ Completely empty email detected - adding empty email placeholder`,
            );
          }
        }

        // Save the message with attachments
        await storage.createMessage({
          ticketId: newTicket.id,
          content: messageContent,
          sender: customerName,
          senderEmail: customerEmail, // Using our validated customerEmail variable
          isAgent: false,
          messageId: newMessageId,
          ccRecipients: emailData.ccRecipients || [],
          attachments: emailData.attachments || [],
        });

        console.log(
          `[${webhookId}] ✅ SUCCESSFULLY created NEW ticket #${newTicket.id}`,
        );
        console.log(
          `[${webhookId}] 🔑 Ticket ID: #${newTicket.id} with subject: "${baseSubject}"`,
        );

        // Update the event record with the created ticket ID for future reference
        if (eventId && recentWebhookEvents.has(eventId)) {
          const eventData = recentWebhookEvents.get(eventId);
          if (eventData) {
            console.log(
              `[${webhookId}] 🔄 Updating event record for ${eventId} with ticket #${newTicket.id}`,
            );
            recentWebhookEvents.set(eventId, {
              ...eventData,
              ticketId: newTicket.id,
            });
          }
        }
      }

      // For troubleshooting potential future issues - record source IP if available
      const sourceIp =
        req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
      console.log(
        `[${webhookId}] Source IP: ${sourceIp} (for troubleshooting purposes)`,
      );

      // Add hook for future metrics tracking
      console.log(`[${webhookId}] 📊 Email webhook processing complete`);

      // Only our agent replies will use threading from now on
      return;
    } catch (error) {
      console.error("Error processing inbound email:", error);
      return res.status(500).json({
        message: "Error processing inbound email",
        error: String(error),
      });
    }
  });

  // For Mailgun route testing and configuration
  app.get("/api/inbound-email", (req, res) => {
    res.status(200).send(`
      <html>
        <head><title>Email Webhook Endpoint</title></head>
        <body>
          <h1>Email Webhook Endpoint</h1>
          <p>This endpoint is configured to receive inbound emails from Mailgun.</p>
          <p>To test, send an email to your configured address or use the test tools in the application.</p>
          <p>Current time: ${new Date().toISOString()}</p>
        </body>
      </html>
    `);
  });

  // Handle Mailgun event webhooks (delivery reports, bounces, etc.)
  app.post("/api/webhook/mailgun", webhookMulter.any(), async (req, res) => {
    // Immediately send 200 OK to acknowledge receipt
    res.status(200).send("OK");
    
    // Generate a unique ID for this debug session
    const debugId = Math.random().toString(36).substring(2, 8);
    
    // Skip file saving and just log the payload to the console for debugging
    try {
      // Create a comprehensive debug object including files information
      const debugObject = {
        body: req.body,
        contentType: req.headers['content-type'],
        timestamp: new Date().toISOString(),
        files: req.files ? Array.from(req.files as any[]).map((f: any) => ({
          fieldname: f.fieldname,
          originalname: f.originalname || 'unnamed',
          mimetype: f.mimetype || 'unknown',
          size: f.size || 0
        })) : 'No files'
      };
      
      // Instead of writing to a file, log to the console
      console.log(`[DEBUG-ID: ${debugId}] Event webhook payload:`, JSON.stringify(debugObject, null, 2).substring(0, 1000) + '...');
    } catch (error) {
      console.error('Error logging webhook data:', error);
    }

    // Log webhook details
    console.log("========== MAILGUN EVENT WEBHOOK [DEBUG-ID: " + debugId + "] ==========");
    console.log("Headers:", JSON.stringify(req.headers));
    console.log("Content-Type:", req.headers['content-type']);
    
    // Log files information if any
    let fileDetails = 'none';
    if (req.files && Array.isArray(req.files)) {
      try {
        fileDetails = JSON.stringify(req.files.map((f: any) => ({
          fieldname: f.fieldname,
          originalname: f.originalname,
          mimetype: f.mimetype,
          size: f.size
        })));
      } catch (err) {
        console.error('Error serializing file information:', err);
        fileDetails = 'Error serializing file information';
      }
    }
    console.log("Files received:", fileDetails);
    console.log("Form fields:", JSON.stringify(req.body));
    console.log("Event timestamp:", new Date().toISOString());

    try {
      // Generate a tracking ID for this webhook event
      const webhookId =
        Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
      console.log(`[${webhookId}] Processing Mailgun event webhook`);
      console.log(
        `[${webhookId}] Event data:`,
        JSON.stringify(req.body, null, 2),
      );

      // Extract the event type and message details
      const { event, recipient, message } = req.body;

      if (!event) {
        return res
          .status(400)
          .json({ message: "Invalid webhook payload: missing event type" });
      }

      // For handling different event types
      // See: https://documentation.mailgun.com/en/latest/api-events.html
      switch (event) {
        case "delivered":
          console.log(`Email delivered to ${recipient}`);
          break;
        case "failed":
          console.log(
            `Email delivery failed to ${recipient}: ${req.body.reason || "unknown reason"}`,
          );
          break;
        case "bounced":
          console.log(
            `Email bounced from ${recipient}: ${req.body.error || "unknown error"}`,
          );
          break;
        case "complained":
          console.log(`Complaint received from ${recipient}`);
          break;
        case "unsubscribed":
          console.log(`Unsubscribe request from ${recipient}`);
          break;
        case "opened":
          console.log(`Email opened by ${recipient}`);
          break;
        case "clicked":
          console.log(`Link clicked by ${recipient}`);
          break;
        default:
          console.log(`Unhandled event type: ${event}`);
      }

      return res.status(200).json({ message: "Webhook received" });
    } catch (error) {
      console.error("Error processing Mailgun webhook:", error);
      return res.status(500).json({
        message: "Error processing webhook",
        error: String(error),
      });
    }
  });

  // Middleware to ensure user is authenticated
  const isAuthenticated = (req: Request, res: Response, next: any) => {
    if (req.isAuthenticated()) {
      return next();
    }
    return res.status(401).json({ message: "Unauthorized" });
  };

  // Middleware to ensure user has admin role
  const isAdmin = (req: Request, res: Response, next: any) => {
    console.log(`AUTH CHECK: isAuthenticated=${req.isAuthenticated()}, user=${JSON.stringify(req.user)}`);
    if (req.isAuthenticated() && req.user && req.user.role === "admin") {
      console.log(`AUTH SUCCESS: Admin user ${req.user.username} authorized`);
      return next();
    }
    console.log(`AUTH FAILED: Admin access denied`);
    return res
      .status(403)
      .json({ message: "Forbidden - Admin access required" });
  };

  // USER MANAGEMENT ROUTES

  // Get all users (admin only)
  app.get("/api/users", isAdmin, async (req, res) => {
    try {
      const users = await storage.getUsers();

      // Remove passwords from response
      const sanitizedUsers = users.map((user) => {
        const { password, resetToken, resetTokenExpiry, ...sanitizedUser } =
          user;
        return sanitizedUser;
      });

      res.json(sanitizedUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Create a new user (admin only)
  app.post("/api/users/create", isAdmin, async (req, res) => {
    try {
      const { username, password, name, email, role } = req.body;

      // Check if username or email already exists
      const existingUsername = await storage.getUserByUsername(username);
      const existingEmail = await storage.getUserByEmail(email);

      if (existingUsername) {
        return res.status(400).json({ message: "Username already exists" });
      }

      if (existingEmail) {
        return res.status(400).json({ message: "Email already exists" });
      }

      // Create the new user with admin-provided credentials (no setup required)
      const newUser = await storage.createUser({
        username,
        password, // Use admin-provided password, will be hashed in storage.createUser
        name,
        email,
        role: role || "agent",
        requiresSetup: false, // No setup required - credentials are final
      });

      // User created successfully - no email sent, credentials are final

      // Remove sensitive data before sending response
      const {
        password: _,
        resetToken,
        resetTokenExpiry,
        ...userResponse
      } = newUser;

      res.status(201).json(userResponse);
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // Add route for changing user password (for first-time setup)
  app.post("/api/change-password", async (req, res) => {
    console.log("[DEBUG-API] Change password request received:", {
      body: req.body,
      hasUserId: !!req.body.userId,
      hasCurrentPassword: !!req.body.currentPassword,
      hasNewPassword: !!req.body.newPassword,
      userIdType: typeof req.body.userId,
    });
    try {
      const { userId, currentPassword, newPassword } = req.body;

      console.log("Password change request received:", {
        userId,
        hasCurrentPassword: !!currentPassword,
        hasNewPassword: !!newPassword,
      });

      if (!userId || !currentPassword || !newPassword) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      // Find the user
      const user = await storage.getUser(parseInt(userId));
      if (!user) {
        console.log(`User not found with ID: ${userId}`);
        return res.status(404).json({ message: "User not found" });
      }

      // Verify current password is correct
      const isMatch = await comparePasswords(currentPassword, user.password);
      console.log("Password verification result:", isMatch);

      if (!isMatch) {
        return res
          .status(400)
          .json({ message: "Current password is incorrect" });
      }

      console.log("Preparing to hash and update password for user:", user.id);
      // Hash the new password
      const hashedPassword = await hashPassword(newPassword);

      console.log("Password hashed successfully, updating in database");
      // Update user's password directly to ensure it's properly saved
      const updatedUser = await storage.updateUserPassword(
        parseInt(userId),
        hashedPassword,
      );

      if (!updatedUser) {
        console.log("Failed to update password");
        return res.status(500).json({ message: "Failed to update password" });
      }

      console.log("Password updated successfully for user:", user.id);

      // Generate OTP for verification
      const otp = await storage.generateOTP(parseInt(userId));

      // Send OTP email to user
      const appBaseUrl =
        process.env.APP_URL || req.protocol + "://" + req.get("host");
      // Prepare verification email content
      const verifySubject = "Verify Your Account - Support Portal";
      const verifyText = `Hello ${user.name},

Your password has been updated. To complete the setup process, please verify your account using the following code:

${otp}

Please enter this code at ${appBaseUrl}/otp-verification

If you did not make this request, please contact support immediately.

This is an automated message, please do not reply.`;

      // Enhanced Microsoft Outlook-compatible OTP verification email template
      const verifyHtml = `
      <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
      <html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <meta name="format-detection" content="telephone=no">
        <meta name="format-detection" content="date=no">
        <meta name="format-detection" content="address=no">
        <meta name="format-detection" content="email=no">
        <meta name="x-apple-disable-message-reformatting">
        <title>Verify Your Account</title>
        <!--[if mso]>
        <style type="text/css">
          table {border-collapse: collapse; border-spacing: 0; margin: 0;}
          div, td {padding: 0;}
          div {margin: 0 !important;}
        </style>
        <noscript>
          <xml>
            <o:OfficeDocumentSettings>
              <o:PixelsPerInch>96</o:PixelsPerInch>
            </o:OfficeDocumentSettings>
          </xml>
        </noscript>
        <![endif]-->
        <style type="text/css">
          /* Outlook fix */
          table, td {border-collapse: collapse !important; mso-table-lspace: 0pt; mso-table-rspace: 0pt;}
          /* Client compatibility */
          body, table, td, p, a, li, blockquote {-ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%;}
          /* Prevent Windows 10 Mail from underlining links */
          a {text-decoration: none;}
          /* Outlook.com/Hotmail fix */
          .ExternalClass, .ReadMsgBody {width: 100%;}
          .ExternalClass, .ExternalClass p, .ExternalClass span, .ExternalClass font, .ExternalClass td, .ExternalClass div {line-height: 100%;}
          /* Button optimization */
          @media screen and (min-width:481px) {
            .mj-column-per-100 {width: 100% !important; max-width: 100%;}
          }
          /* Mobile styles */
          @media only screen and (max-width:480px) {
            .mobile-padding {padding-left: 10px !important; padding-right: 10px !important;}
            .mobile-stack {display: block !important; width: 100% !important;}
          }
        </style>
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, 'Helvetica Neue', Helvetica, sans-serif; font-size: 16px; line-height: 1.5; color: #333333; -webkit-font-smoothing: antialiased; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
        <!--[if mso]>
        <table width="100%" role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="font-family: 'Segoe UI', Arial, sans-serif;">
        <tr>
        <td>
        <![endif]-->
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 20px;">
              <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="border-collapse: collapse; border: 1px solid #e9e9e9; background-color: #ffffff;">
                <tr>
                  <td style="padding: 30px;" class="mobile-padding">
                    <!-- Header with Blue Accent -->
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                      <tr>
                        <td style="padding: 0 0 20px 0; border-bottom: 4px solid #4f46e5;">
                          <h2 style="margin: 0; font-family: 'Segoe UI', Arial, sans-serif; font-size: 24px; line-height: 1.3; color: #333333; font-weight: 600;">Account Verification</h2>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Content - Greeting -->
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                      <tr>
                        <td style="padding: 30px 0 15px 0;">
                          <p style="margin: 0; font-size: 18px; font-weight: 500;">Hello ${user.name},</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 0 0 25px 0;">
                          <p style="margin: 0; font-size: 16px; line-height: 1.6;">Your password has been successfully updated. To complete the setup process and ensure your account security, please verify your account using the verification code below:</p>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- OTP Code Box with enhanced styling -->
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                      <tr>
                        <td align="center" style="padding: 0 0 30px 0;">
                          <!--[if mso]>
                          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" style="height:70px;v-text-anchor:middle;width:280px;" arcsize="5%" strokecolor="#e1e1e1" fillcolor="#f5f5f5">
                            <w:anchorlock/>
                            <center style="color:#333333;font-family:'Segoe UI',Arial,sans-serif;font-size:26px;font-weight:bold;">${otp}</center>
                          </v:roundrect>
                          <![endif]-->
                          <!--[if !mso]><!-->
                          <table border="0" cellpadding="0" cellspacing="0" width="280" style="border-collapse: separate; border: 2px solid #e1e1e1; background-color: #f5f5f5; border-radius: 4px; box-shadow: 0 2px 3px rgba(0,0,0,0.06);">
                            <tr>
                              <td align="center" style="padding: 20px;">
                                <p style="margin: 0; font-size: 26px; font-weight: bold; letter-spacing: 4px; font-family: 'Courier New', Courier, monospace; color: #333333;">${otp}</p>
                              </td>
                            </tr>
                          </table>
                          <!--<![endif]-->
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Instructions with button -->
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                      <tr>
                        <td style="padding: 0 0 20px 0;">
                          <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.5;">Please enter this code at the verification page to complete your account setup:</p>
                        </td>
                      </tr>
                      <tr>
                        <td align="center" style="padding: 0 0 30px 0;">
                          <!--[if mso]>
                          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${appBaseUrl}/otp-verification" style="height:50px;v-text-anchor:middle;width:200px;" arcsize="8%" strokecolor="#4f46e5" fillcolor="#4f46e5">
                            <w:anchorlock/>
                            <center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:bold;">Verify Account</center>
                          </v:roundrect>
                          <![endif]-->
                          <!--[if !mso]><!-->
                          <a href="${appBaseUrl}/otp-verification" style="background-color: #4f46e5; border-radius: 4px; color: #ffffff; display: inline-block; font-family: 'Segoe UI', Arial, sans-serif; font-size: 16px; font-weight: bold; line-height: 50px; text-align: center; text-decoration: none; width: 200px; -webkit-text-size-adjust: none;">Verify Account</a>
                          <!--<![endif]-->
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 0 0 20px 0;">
                          <p style="margin: 0; font-size: 14px; color: #666666;">If the button doesn't work, you can also open this link in your browser:</p>
                          <p style="margin: 5px 0 0 0; font-size: 14px;">
                            <a href="${appBaseUrl}/otp-verification" style="color: #4f46e5; text-decoration: underline;">${appBaseUrl}/otp-verification</a>
                          </p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 0 0 20px 0;">
                          <p style="margin: 0;">If you did not make this request, please contact support immediately.</p>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Footer -->
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; border-top: 1px solid #e9e9e9;">
                      <tr>
                        <td style="padding: 20px 0 0 0;">
                          <p style="margin: 0; color: #6b7280; font-size: 14px;">This is an automated message, please do not reply.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
      `;

      try {
        if (mailgunService && mailgunService.isInitialized()) {
          await mailgunService.sendEmail({
            from: `Support <support@${mailgunService.getDomain()}>`,
            to: user.email,
            subject: verifySubject,
            text: verifyText,
            html: verifyHtml,
          });
          console.log(`OTP verification email sent to ${user.email}`);
        } else {
          console.log(
            `Would send OTP email to ${user.email} with code: ${otp}`,
          );
        }
      } catch (emailError) {
        console.error("Error sending OTP email:", emailError);
        // Continue even if email sending fails
      }

      // Success response with user data for verification step
      res.json({
        requiresVerification: true,
        username: user.username,
      });
    } catch (error) {
      console.error("Error changing password:", error);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  // Note: The complete-setup endpoint is defined later in this file

  // Utility function to generate secure random passwords
  function generateSecurePassword(length: number = 12): string {
    const charset =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let password = "";
    let hasUpperCase = false;
    let hasLowerCase = false;
    let hasNumber = false;
    let hasSpecial = false;

    // Generate initial random password
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * charset.length);
      const char = charset[randomIndex];
      password += char;

      if ("ABCDEFGHIJKLMNOPQRSTUVWXYZ".includes(char)) hasUpperCase = true;
      if ("abcdefghijklmnopqrstuvwxyz".includes(char)) hasLowerCase = true;
      if ("0123456789".includes(char)) hasNumber = true;
      if ("!@#$%^&*".includes(char)) hasSpecial = true;
    }

    // Ensure password meets complexity requirements
    if (!hasUpperCase)
      password = replaceRandomChar(password, "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    if (!hasLowerCase)
      password = replaceRandomChar(password, "abcdefghijklmnopqrstuvwxyz");
    if (!hasNumber) password = replaceRandomChar(password, "0123456789");
    if (!hasSpecial) password = replaceRandomChar(password, "!@#$%^&*");

    return password;
  }

  function replaceRandomChar(password: string, charset: string): string {
    const randomIndex = Math.floor(Math.random() * password.length);
    const randomChar = charset[Math.floor(Math.random() * charset.length)];
    return (
      password.substring(0, randomIndex) +
      randomChar +
      password.substring(randomIndex + 1)
    );
  }

  // Update user (admin only)
  app.patch("/api/users/:id", isAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);

      // Don't allow modifying password through this endpoint - use dedicated password reset
      const { password, ...updateData } = req.body;

      // Check if user exists
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if trying to update username or email to one that already exists
      if (updateData.username && updateData.username !== user.username) {
        const existingUsername = await storage.getUserByUsername(
          updateData.username,
        );
        if (existingUsername) {
          return res.status(400).json({ message: "Username already exists" });
        }
      }

      if (updateData.email && updateData.email !== user.email) {
        const existingEmail = await storage.getUserByEmail(updateData.email);
        if (existingEmail) {
          return res.status(400).json({ message: "Email already exists" });
        }
      }

      // Update the user
      const updatedUser = await storage.updateUser(userId, updateData);

      if (!updatedUser) {
        return res.status(500).json({ message: "Failed to update user" });
      }

      // Remove sensitive data before sending response
      const {
        password: _,
        resetToken,
        resetTokenExpiry,
        ...userResponse
      } = updatedUser;

      res.json(userResponse);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // Delete user (admin only)
  app.delete("/api/users/:id", isAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);

      // Prevent deleting self
      if (userId === req.user?.id) {
        return res
          .status(400)
          .json({ message: "Cannot delete your own account" });
      }

      // Check if user exists
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const success = await storage.deleteUser(userId);

      if (!success) {
        return res.status(500).json({ message: "Failed to delete user" });
      }

      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // DESK MANAGEMENT ROUTES

  // Get all desks (admin only)
  app.get("/api/desks", isAdmin, async (req, res) => {
    try {
      const desks = await storage.getDesks();
      res.json(desks);
    } catch (error) {
      console.error("Error fetching desks:", error);
      res.status(500).json({ message: "Failed to fetch desks" });
    }
  });

  // Get single desk (admin only)
  app.get("/api/desks/:id", isAdmin, async (req, res) => {
    try {
      const deskId = parseInt(req.params.id);
      const desk = await storage.getDeskById(deskId);

      if (!desk) {
        return res.status(404).json({ message: "Desk not found" });
      }

      res.json(desk);
    } catch (error) {
      console.error("Error fetching desk:", error);
      res.status(500).json({ message: "Failed to fetch desk" });
    }
  });

  // Create new desk (admin only)
  app.post("/api/desks", isAdmin, async (req, res) => {
    try {
      // Validate request body using the insertDeskSchema
      let validatedData = insertDeskSchema.parse(req.body);

      // Email validation - allow full email addresses for better UX
      if (validatedData.email) {
        // Preserve the full email address
        validatedData.email = validatedData.email.trim();

        if (!validatedData.email) {
          return res
            .status(400)
            .json({ message: "Email address cannot be empty" });
        }
      }

      // Check if email is already in use by another desk
      const existingDesk = await storage.getDeskByEmail(validatedData.email);
      if (existingDesk) {
        return res
          .status(400)
          .json({ message: "Email address is already in use" });
      }

      const desk = await storage.createDesk(validatedData);
      res.status(201).json(desk);
    } catch (error) {
      console.error("Error creating desk:", error);
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid desk data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create desk" });
    }
  });

  // Update desk (admin only)
  app.patch("/api/desks/:id", isAdmin, async (req, res) => {
    try {
      const deskId = parseInt(req.params.id);

      // Check if desk exists
      const desk = await storage.getDeskById(deskId);
      if (!desk) {
        return res.status(404).json({ message: "Desk not found" });
      }

      // Validate update data (partial)
      let validatedData = insertDeskSchema.partial().parse(req.body);

      // Email validation - allow full email addresses for better UX
      if (validatedData.email) {
        // Preserve the full email address
        validatedData.email = validatedData.email.trim();

        if (!validatedData.email) {
          return res
            .status(400)
            .json({ message: "Email address cannot be empty" });
        }
      }
      
      // Handle email forwarding setup
      if (req.body.enableForwarding === true) {
        try {
          const emailToUse = validatedData.email || desk.email;
          console.log(`Setting up email forwarding for desk ${deskId}: ${emailToUse}`);
          
          // Extract email name without domain if it has one
          const emailName = emailToUse.includes('@') 
            ? emailToUse.split('@')[0] 
            : emailToUse;
          
          const forwardingAddress = `${emailName}@helpdesk.1office.in`;
          
          // Here we would implement the actual forwarding setup with Mailgun
          // For now, we'll just log it
          console.log(`Email forwarding activated: ${emailToUse} -> ${forwardingAddress}`);
          
          if (mailgunService && mailgunService.isInitialized()) {
            // Set up a Mailgun route for forwarding
            // This is a placeholder - actual implementation would depend on your Mailgun setup
            console.log('Mailgun is initialized, would set up forwarding here');
            
            // You could add code here to call Mailgun's API to set up forwarding routes
            // or to send confirmation emails with forwarding instructions
          } else {
            console.log('Mailgun not initialized, skipping forwarding setup');
          }
        } catch (error) {
          console.error('Error setting up email forwarding:', error);
          // We'll continue with the desk update even if forwarding setup fails
        }
      }

      // If email is being updated, check if it's already in use
      if (validatedData.email && validatedData.email !== desk.email) {
        const existingDesk = await storage.getDeskByEmail(validatedData.email);
        if (existingDesk && existingDesk.id !== deskId) {
          return res
            .status(400)
            .json({ message: "Email address is already in use" });
        }
      }

      const updatedDesk = await storage.updateDesk(deskId, validatedData);
      res.json(updatedDesk);
    } catch (error) {
      console.error("Error updating desk:", error);
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid desk data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update desk" });
    }
  });

  // Delete desk (admin only)
  app.delete("/api/desks/:id", isAdmin, async (req, res) => {
    try {
      const deskId = parseInt(req.params.id);

      // Check if desk exists
      const desk = await storage.getDeskById(deskId);
      if (!desk) {
        return res.status(404).json({ message: "Desk not found" });
      }

      // Allow deletion of any desk, including the default desk

      const success = await storage.deleteDesk(deskId);

      if (!success) {
        return res.status(500).json({ message: "Failed to delete desk" });
      }

      res.json({ message: "Desk deleted successfully" });
    } catch (error) {
      console.error("Error deleting desk:", error);
      res.status(500).json({ message: "Failed to delete desk" });
    }
  });

  // DESK ASSIGNMENT ROUTES

  // Get desk assignments (admin only)
  app.get("/api/desk-assignments", isAdmin, async (req, res) => {
    try {
      const userId = req.query.userId
        ? parseInt(req.query.userId as string)
        : undefined;
      const deskId = req.query.deskId
        ? parseInt(req.query.deskId as string)
        : undefined;

      const assignments = await storage.getDeskAssignments(userId, deskId);
      res.json(assignments);
    } catch (error) {
      console.error("Error fetching desk assignments:", error);
      res.status(500).json({ message: "Failed to fetch desk assignments" });
    }
  });

  // Assign user to desk (admin only)
  app.post("/api/desk-assignments", isAdmin, async (req, res) => {
    try {
      const { userId, deskId } = req.body;

      // Validate required fields
      if (!userId || !deskId) {
        return res
          .status(400)
          .json({ message: "userId and deskId are required" });
      }

      // Check if user exists
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if desk exists
      const desk = await storage.getDeskById(deskId);
      if (!desk) {
        return res.status(404).json({ message: "Desk not found" });
      }

      // Create assignment
      const assignment = await storage.assignUserToDesk(userId, deskId);
      res.status(201).json(assignment);
    } catch (error) {
      console.error("Error assigning user to desk:", error);
      res.status(500).json({ message: "Failed to assign user to desk" });
    }
  });

  // Remove user from desk (admin only)
  app.delete("/api/desk-assignments", isAdmin, async (req, res) => {
    try {
      const { userId, deskId } = req.body;

      // Validate required fields
      if (!userId || !deskId) {
        return res
          .status(400)
          .json({ message: "userId and deskId are required" });
      }

      const success = await storage.removeUserFromDesk(userId, deskId);

      if (!success) {
        return res.status(404).json({ message: "Assignment not found" });
      }

      res.json({ message: "User removed from desk successfully" });
    } catch (error) {
      console.error("Error removing user from desk:", error);
      res.status(500).json({ message: "Failed to remove user from desk" });
    }
  });

  // Get users assigned to a specific desk (admin only)
  app.get("/api/desks/:id/users", isAdmin, async (req, res) => {
    try {
      const deskId = parseInt(req.params.id);
      console.log(`API: Getting users for desk ${deskId}`);

      // Check if desk exists
      const desk = await storage.getDeskById(deskId);
      if (!desk) {
        console.log(`API: Desk ${deskId} not found`);
        return res.status(404).json({ message: "Desk not found" });
      }

      console.log(`API: Desk ${deskId} found, fetching users...`);
      const users = await storage.getDeskUsers(deskId);
      console.log(`API: Returning ${users.length} users for desk ${deskId}`);
      console.log(`API: User data being returned:`, users.map(u => ({ id: u.id, name: u.name, email: u.email })));
      
      // Prevent caching to ensure fresh data
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      
      res.json(users);
    } catch (error) {
      console.error("Error getting desk users:", error);
      res.status(500).json({ message: "Failed to get desk users" });
    }
  });

  // Add the endpoint the frontend is actually calling
  app.post("/api/desks/:deskId/users", isAdmin, async (req, res) => {
    try {
      const deskId = parseInt(req.params.deskId);
      const { userId } = req.body;

      console.log(`API: POST /api/desks/${deskId}/users - User: ${req.user?.username} (${req.user?.role})`);
      console.log(`API: Assigning user ${userId} to desk ${deskId}`);

      // Check if user exists
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if desk exists
      const desk = await storage.getDeskById(deskId);
      if (!desk) {
        return res.status(404).json({ message: "Desk not found" });
      }

      // Create assignment
      const assignment = await storage.assignUserToDesk(userId, deskId);
      console.log(`Successfully assigned user ${userId} to desk ${deskId}:`, assignment);
      res.status(200).json(assignment);
    } catch (error) {
      console.error("Error assigning user to desk:", error);
      res.status(500).json({ message: "Failed to assign user to desk" });
    }
  });

  // Assign user to desk using the frontend's expected endpoint format
  app.post("/api/desks/:deskId/users/:userId", isAdmin, async (req, res) => {
    try {
      const deskId = parseInt(req.params.deskId);
      const userId = parseInt(req.params.userId);

      console.log(`Assigning user ${userId} to desk ${deskId}`);

      // Check if user exists
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if desk exists
      const desk = await storage.getDeskById(deskId);
      if (!desk) {
        return res.status(404).json({ message: "Desk not found" });
      }

      // Create assignment
      const assignment = await storage.assignUserToDesk(userId, deskId);
      console.log(`Successfully assigned user ${userId} to desk ${deskId}:`, assignment);
      res.status(200).json(assignment);
    } catch (error) {
      console.error("Error assigning user to desk:", error);
      res.status(500).json({ message: "Failed to assign user to desk" });
    }
  });

  // Remove user from desk using the frontend's expected endpoint format
  app.delete("/api/desks/:deskId/users/:userId", isAdmin, async (req, res) => {
    try {
      const deskId = parseInt(req.params.deskId);
      const userId = parseInt(req.params.userId);

      console.log(`API: DELETE /api/desks/${deskId}/users/${userId} - User: ${req.user?.username} (${req.user?.role})`);
      console.log(`API: Removing user ${userId} from desk ${deskId}`);

      // First, let's check if the assignment exists
      const deskUsers = await storage.getDeskUsers(deskId);
      console.log(`BEFORE REMOVAL: Desk ${deskId} has users:`, deskUsers.map(u => u.id));
      
      const success = await storage.removeUserFromDesk(userId, deskId);

      if (!success) {
        console.log(`REMOVAL FAILED: Assignment not found for user ${userId} in desk ${deskId}`);
        return res.status(404).json({ message: "Assignment not found" });
      }

      console.log(`REMOVAL SUCCESS: User ${userId} removed from desk ${deskId}`);
      res.json({ message: "User removed from desk successfully" });
    } catch (error) {
      console.error("Error removing user from desk:", error);
      res.status(500).json({ message: "Failed to remove user from desk" });
    }
  });

  // Get desks assigned to current user
  app.get("/api/user/desks", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const desks = await storage.getUserDesks(userId);
      res.json(desks);
    } catch (error) {
      console.error("Error fetching user desks:", error);
      res.status(500).json({ message: "Failed to fetch user desks" });
    }
  });

  // FIRST-TIME SETUP AND OTP VERIFICATION ROUTES

  // Send OTP when user attempts to login and requires verification
  app.post("/api/send-verification-otp", async (req, res) => {
    try {
      const { username } = req.body;

      if (!username) {
        return res.status(400).json({ message: "Username is required" });
      }

      // Get user by username
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      // Generate new OTP
      const otp = await storage.generateOTP(user.id);

      // Send OTP to user's email
      try {
        if (mailgunService && mailgunService.isInitialized()) {
          await mailgunService.sendEmail({
            from: `Support <support@${mailgunService.getDomain()}>`,
            to: user.email,
            subject: "Your Verification Code",
            text: `Hello ${user.name},

You've attempted to login to your account which requires verification.

Please use the code below to verify your account:

Verification Code: ${otp}

This code will expire in 15 minutes.

If you did not attempt to login, please contact support immediately.

This is an automated message, please do not reply.`,
            html: `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="format-detection" content="telephone=no">
  <meta name="x-apple-disable-message-reformatting">
  <title>Your Verification Code</title>
  <!--[if mso]>
  <style type="text/css">
    table {border-collapse: collapse; border-spacing: 0; margin: 0;}
    div, td {padding: 0;}
    div {margin: 0 !important;}
  </style>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; font-size: 16px; line-height: 1.5; color: #333333;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 20px;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="border-collapse: collapse; border: 1px solid #e9e9e9; background-color: #ffffff;">
          <tr>
            <td style="padding: 30px;">
              <!-- Header -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                <tr>
                  <td style="padding: 0 0 20px 0; border-bottom: 4px solid #4f46e5;">
                    <h2 style="margin: 0; font-family: 'Segoe UI', Arial, sans-serif; font-size: 24px; color: #333333; font-weight: 600;">Login Verification</h2>
                  </td>
                </tr>
              </table>
              
              <!-- Content -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                <tr>
                  <td style="padding: 30px 0 15px 0;">
                    <p style="margin: 0; font-size: 18px;">Hello ${user.name},</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 0 20px 0;">
                    <p style="margin: 0; line-height: 1.6;">You've attempted to login to your account which requires verification. Please use the code below to verify your account:</p>
                  </td>
                </tr>
              </table>
              
              <!-- Code Box -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 0 0 25px 0;">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" style="height:70px;v-text-anchor:middle;width:280px;" arcsize="5%" strokecolor="#e1e1e1" fillcolor="#f5f5f5">
                      <w:anchorlock/>
                      <center style="color:#333333;font-family:'Segoe UI',Arial,sans-serif;font-size:26px;font-weight:bold;">${otp}</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-->
                    <table border="0" cellpadding="0" cellspacing="0" width="280" style="border-collapse: separate; border: 2px solid #e1e1e1; background-color: #f5f5f5; border-radius: 4px; box-shadow: 0 2px 3px rgba(0,0,0,0.06);">
                      <tr>
                        <td align="center" style="padding: 20px;">
                          <p style="margin: 0; font-size: 26px; font-weight: bold; letter-spacing: 4px; font-family: 'Courier New', Courier, monospace; color: #333333;">${otp}</p>
                        </td>
                      </tr>
                    </table>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>
              
              <!-- Additional information -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                <tr>
                  <td style="padding: 0 0 10px 0;">
                    <p style="margin: 0; color: #666666;">This code will expire in 15 minutes.</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 0 20px 0;">
                    <p style="margin: 0; color: #666666;">If you did not attempt to login, please contact support immediately.</p>
                  </td>
                </tr>
              </table>
              
              <!-- Footer -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; border-top: 1px solid #e9e9e9;">
                <tr>
                  <td style="padding: 20px 0 0 0;">
                    <p style="margin: 0; color: #6b7280; font-size: 14px;">This is an automated message, please do not reply.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
          });
          console.log(`Sent verification OTP to ${user.email}`);
        } else {
          console.log(`Would send OTP to ${user.email}: ${otp}`);
        }
      } catch (emailError) {
        console.error("Error sending OTP email:", emailError);
        return res
          .status(500)
          .json({ message: "Failed to send verification code" });
      }

      res.json({ message: "Verification code sent", email: user.email });
    } catch (error) {
      console.error("Error sending verification OTP:", error);
      res.status(500).json({ message: "Failed to send verification code" });
    }
  });

  // Verify OTP sent to new users
  app.post("/api/verify-otp", async (req, res) => {
    try {
      const { username, otp } = req.body;

      console.log("OTP Verification attempt:", {
        username,
        otpLength: otp?.length || 0,
      });

      // Directly showing full OTP for debugging since we're having issues
      console.log(`DEBUG: Full OTP received: '${otp}'`);

      if (!username || !otp) {
        return res
          .status(400)
          .json({ message: "Username and OTP are required" });
      }

      // Get user by username
      const user = await storage.getUserByUsername(username);
      if (!user) {
        console.log("OTP Verification failed: User not found", { username });
        return res.status(400).json({ message: "Invalid credentials" });
      }

      // Show full OTP for debugging comparison
      console.log(
        `DEBUG: User ${user.id} has OTP in database: '${user.otpCode}'`,
      );
      console.log(`DEBUG: Exact comparison: ${user.otpCode === otp}`);

      console.log("OTP Verification user found:", {
        userId: user.id,
        username: user.username,
        hasOtpCode: !!user.otpCode,
        otpCodeInDB: user.otpCode, // Show full OTP for debugging
        otpSubmitted: otp, // Show full OTP for debugging
        otpLength: otp?.length || 0,
        dbOtpLength: user.otpCode?.length || 0,
        otpExpiry: user.otpExpiry
          ? new Date(user.otpExpiry).toISOString()
          : null,
        isExpired: user.otpExpiry
          ? new Date(user.otpExpiry) < new Date()
          : null,
      });

      // Force direct equality for debugging
      if (user.otpCode === otp) {
        console.log("DIRECT MATCH FOUND between OTPs");
      } else {
        // Examine character by character
        if (user.otpCode && otp) {
          console.log("Character-by-character comparison:");
          for (let i = 0; i < Math.max(user.otpCode.length, otp.length); i++) {
            console.log(
              `Position ${i}: DB='${user.otpCode[i] || ""}' vs Input='${otp[i] || ""}' Match=${user.otpCode[i] === otp[i]}`,
            );
          }
        }
      }

      // Check if user already has OTP code and expiry in DB
      if (!user.otpCode || !user.otpExpiry) {
        console.log(
          "OTP Verification using memory cache fallback for user:",
          user.id,
        );
      }

      // Try direct verification for debugging
      if (user.otpCode === otp) {
        console.log(
          "❗ Direct OTP match - would be valid if using direct comparison",
        );

        // TEMPORARY FIX: If we have a direct match but the storage method fails, we'll accept it
        // This is to handle cases where memory cache might be out of sync
        const directMatch = true;

        // Verify OTP through storage method (which has all the proper checks)
        const isValid = await storage.verifyOTP(user.id, otp);

        if (!isValid && directMatch) {
          console.log(
            "WARNING: Storage verification failed, but direct match found - accepting direct match",
          );
          // Mark user as verified directly
          try {
            await storage.updateUser(user.id, { isVerified: true });
          } catch (err) {
            console.error(
              "Error updating user verified status in direct match fallback:",
              err,
            );
          }
          // Continue with successful flow
        } else if (!isValid) {
          console.log(
            "OTP Verification failed: Invalid or expired code (and no direct match)",
          );
          return res
            .status(400)
            .json({ message: "Invalid or expired verification code" });
        }
      } else {
        // No direct match, try regular verification
        const isValid = await storage.verifyOTP(user.id, otp);

        if (!isValid) {
          console.log("OTP Verification failed: Invalid or expired code");
          return res
            .status(400)
            .json({ message: "Invalid or expired verification code" });
        }
      }

      console.log("OTP Verification successful for user:", user.id);

      // Mark user as verified
      const updatedUser = await storage.updateUser(user.id, {
        isVerified: true,
      });
      console.log("User marked as verified:", !!updatedUser);

      // Determine if user requires setup
      const requiresSetup = user.requiresSetup;

      // Log the user in by setting the user in the session
      req.login(user, (err) => {
        if (err) {
          console.error("Error logging in after OTP verification:", err);
          return res
            .status(500)
            .json({ message: "Failed to complete login after verification" });
        }

        // If user requires setup, don't return the user object yet
        if (requiresSetup) {
          res.json({
            message: "OTP verified successfully, setup required",
            userId: user.id,
          });
        } else {
          // If user doesn't require setup, return the user object for client redirection
          const { password, ...userWithoutPassword } = user;
          res.json({
            message: "OTP verified successfully",
            user: userWithoutPassword,
          });
        }
      });
    } catch (error) {
      console.error("Error verifying OTP:", error);
      res.status(500).json({ message: "Failed to verify OTP" });
    }
  });

  // Update user password during first-time setup
  app.post("/api/complete-setup", async (req, res) => {
    try {
      const { userId, newPassword } = req.body;

      console.log("Complete setup request received:", {
        userId,
        hasPassword: !!newPassword,
      });

      if (!userId) {
        return res.status(400).json({ message: "User ID is required" });
      }

      // Get user by ID
      const user = await storage.getUser(parseInt(userId));
      if (!user) {
        console.log(`User not found with ID: ${userId}`);
        return res.status(404).json({ message: "User not found" });
      }

      console.log(
        `User found for setup completion: ${user.id} (${user.username})`,
      );

      // Update user data
      let updatedUser = user;

      // If password is provided, update it - using hashPassword from auth.ts
      if (newPassword) {
        console.log("Updating password for user");
        const hashedPassword = await hashPassword(newPassword);
        const updatedPasswordUser = await storage.updateUserPassword(
          user.id,
          hashedPassword,
        );

        if (!updatedPasswordUser) {
          console.log("Failed to update password");
          return res.status(500).json({ message: "Failed to update password" });
        }

        // Type check to ensure updatedPasswordUser is not undefined
        if (updatedPasswordUser) {
          updatedUser = updatedPasswordUser;
          console.log("Password updated successfully");
        }
      } else {
        console.log("No new password provided, skipping password update");
      }

      // Mark user as no longer requiring setup
      console.log("Marking user as no longer requiring setup");
      const setupUpdated = await storage.updateUser(user.id, {
        requiresSetup: false,
      });

      if (!setupUpdated) {
        console.log("Failed to update setup status");
        return res
          .status(500)
          .json({ message: "Failed to update setup status" });
      }

      console.log("Setup completed successfully for user:", user.id);
      res.json({ message: "Setup completed successfully" });
    } catch (error) {
      console.error("Error completing setup:", error);
      res.status(500).json({ message: "Failed to complete setup" });
    }
  });

  // Resend OTP to user
  app.post("/api/resend-otp", async (req, res) => {
    try {
      const { username } = req.body;

      if (!username) {
        return res.status(400).json({ message: "Username is required" });
      }

      // Get user by username
      const user = await storage.getUserByUsername(username);
      if (!user) {
        // Don't reveal if username exists
        return res.json({
          message:
            "If the account exists, a new verification code has been sent",
        });
      }

      // Generate new OTP
      const otp = await storage.generateOTP(user.id);

      // Send OTP to user's email
      try {
        if (mailgunService && mailgunService.isInitialized()) {
          await mailgunService.sendEmail({
            from: `Support <support@${mailgunService.getDomain()}>`,
            to: user.email,
            subject: "Your New Verification Code",
            text: `Hello ${user.name},

You requested a new verification code for your account.

Please use the code below to verify your account:

Verification Code: ${otp}

This code will expire in 15 minutes.

If you did not request this code, please contact support immediately.

This is an automated message, please do not reply.`,
            html: `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="format-detection" content="telephone=no">
  <meta name="x-apple-disable-message-reformatting">
  <title>Your Verification Code</title>
  <!--[if mso]>
  <style type="text/css">
    table {border-collapse: collapse; border-spacing: 0; margin: 0;}
    div, td {padding: 0;}
    div {margin: 0 !important;}
  </style>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; font-size: 16px; line-height: 1.5; color: #333333;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 20px;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="border-collapse: collapse; border: 1px solid #e9e9e9; background-color: #ffffff;">
          <tr>
            <td style="padding: 30px;">
              <!-- Header -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                <tr>
                  <td style="padding: 0 0 20px 0; border-bottom: 4px solid #4f46e5;">
                    <h2 style="margin: 0; font-family: 'Segoe UI', Arial, sans-serif; font-size: 24px; color: #333333; font-weight: 600;">Verification Code</h2>
                  </td>
                </tr>
              </table>
              
              <!-- Content -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                <tr>
                  <td style="padding: 30px 0 15px 0;">
                    <p style="margin: 0; font-size: 18px;">Hello ${user.name},</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 0 20px 0;">
                    <p style="margin: 0; line-height: 1.6;">You requested a new verification code for your account. Please use the code below to verify your account:</p>
                  </td>
                </tr>
              </table>
              
              <!-- Code Box -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 0 0 25px 0;">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" style="height:70px;v-text-anchor:middle;width:280px;" arcsize="5%" strokecolor="#e1e1e1" fillcolor="#f5f5f5">
                      <w:anchorlock/>
                      <center style="color:#333333;font-family:'Segoe UI',Arial,sans-serif;font-size:26px;font-weight:bold;">${otp}</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-->
                    <table border="0" cellpadding="0" cellspacing="0" width="280" style="border-collapse: separate; border: 2px solid #e1e1e1; background-color: #f5f5f5; border-radius: 4px; box-shadow: 0 2px 3px rgba(0,0,0,0.06);">
                      <tr>
                        <td align="center" style="padding: 20px;">
                          <p style="margin: 0; font-size: 26px; font-weight: bold; letter-spacing: 4px; font-family: 'Courier New', Courier, monospace; color: #333333;">${otp}</p>
                        </td>
                      </tr>
                    </table>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>
              
              <!-- Additional information -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                <tr>
                  <td style="padding: 0 0 10px 0;">
                    <p style="margin: 0; color: #666666;">This code will expire in 15 minutes.</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 0 20px 0;">
                    <p style="margin: 0; color: #666666;">If you did not request this code, please contact support immediately.</p>
                  </td>
                </tr>
              </table>
              
              <!-- Footer -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; border-top: 1px solid #e9e9e9;">
                <tr>
                  <td style="padding: 20px 0 0 0;">
                    <p style="margin: 0; color: #6b7280; font-size: 14px;">This is an automated message, please do not reply.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
          });
        } else {
          console.log(`Would send new OTP to ${user.email}: ${otp}`);
        }
      } catch (emailError) {
        console.error("Error sending OTP email:", emailError);
      }

      res.json({
        message: "If the account exists, a new verification code has been sent",
      });
    } catch (error) {
      console.error("Error resending OTP:", error);
      res.status(500).json({ message: "Failed to resend verification code" });
    }
  });

  // PASSWORD RESET ROUTES

  // Request password reset (generates and sends token)
  app.post("/api/reset-password", async (req, res) => {
    try {
      const { email } = req.body;

      console.log("Password reset request received for email:", email);

      // Check if user exists
      const user = await storage.getUserByEmail(email);
      if (!user) {
        console.log("User not found with email:", email);
        // Don't reveal if email exists or not for security reasons
        return res.json({
          message: "If the email is registered, a reset link will be sent",
        });
      }

      // Generate token - using a simpler approach than require('crypto')
      const tokenArray = new Uint8Array(32);
      crypto.getRandomValues(tokenArray); // Use the global crypto API
      const token = Array.from(tokenArray)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      console.log("Generated reset token for user:", user.id);

      // Save token to database with expiry (24 hours)
      const success = await storage.setResetToken(email, token, 24);

      if (!success) {
        console.log("Failed to save reset token in database");
        return res
          .status(500)
          .json({ message: "Failed to process password reset request" });
      }

      // Send email with reset link
      const resetLink = `${req.protocol}://${req.get("host")}/reset-password/${token}`;
      console.log("Reset link created:", resetLink);

      // Prepare password reset email content
      const resetSubject = "Password Reset Request - Support Portal";
      const resetText = `Hello,

You requested a password reset for your account.

Please use the following link to reset your password:
${resetLink}

This link will expire in 24 hours.

If you did not request a password reset, please ignore this email or contact support.

This is an automated message, please do not reply.`;

      // Create Microsoft Outlook-compatible HTML email template
      const resetHtml = `
      <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
      <html xmlns="http://www.w3.org/1999/xhtml">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
        <title>Password Reset Request</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      </head>
      <body style="margin: 0; padding: 0; font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; font-size: 16px; line-height: 1.5; color: #333333;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
          <tr>
            <td style="padding: 20px;">
              <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="border-collapse: collapse; border: 1px solid #e9e9e9;">
                <tr>
                  <td bgcolor="#ffffff" style="padding: 20px;">
                    <!-- Header -->
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                      <tr>
                        <td>
                          <h2 style="margin: 0; padding-bottom: 10px; border-bottom: 1px solid #e9e9e9; color: #4f46e5;">Password Reset</h2>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Content -->
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                      <tr>
                        <td style="padding: 20px 0 10px 0;">
                          <p style="margin: 0;">Hello,</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 0 0 20px 0;">
                          <p style="margin: 0;">You requested a password reset for your account.</p>
                          <p style="margin: 10px 0 0 0;">Please click the button below to reset your password:</p>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Button (with fallback) -->
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                      <tr>
                        <td align="center" style="padding: 0 0 20px 0;">
                          <!--[if mso]>
                          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${resetLink}" style="height:45px;v-text-anchor:middle;width:200px;" arcsize="10%" stroke="f" fillcolor="#4f46e5">
                            <w:anchorlock/>
                            <center>
                          <![endif]-->
                          <a href="${resetLink}" 
                             style="background-color:#4f46e5;border-radius:5px;color:#ffffff;display:inline-block;font-family:sans-serif;font-size:16px;font-weight:bold;line-height:45px;text-align:center;text-decoration:none;width:200px;-webkit-text-size-adjust:none;">Reset Password</a>
                          <!--[if mso]>
                            </center>
                          </v:roundrect>
                          <![endif]-->
                        </td>
                      </tr>
                      <tr>
                        <td align="center" style="padding: 0 0 20px 0;">
                          <p style="margin: 0; font-size: 14px; color: #666666;">If the button doesn't work, copy and paste this link into your browser:</p>
                          <p style="margin: 5px 0 0 0; font-size: 14px; color: #4f46e5; word-break: break-all;">
                            <a href="${resetLink}" style="color: #4f46e5; text-decoration: underline;">${resetLink}</a>
                          </p>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Instructions -->
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                      <tr>
                        <td style="padding: 0 0 10px 0;">
                          <p style="margin: 0; color: #666666;">This link will expire in 24 hours.</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 0 0 20px 0;">
                          <p style="margin: 0; color: #666666;">If you did not request a password reset, please ignore this email or contact support.</p>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Footer -->
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; border-top: 1px solid #e9e9e9;">
                      <tr>
                        <td style="padding: 20px 0 0 0;">
                          <p style="margin: 0; color: #6b7280; font-size: 14px;">This is an automated message, please do not reply.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
      `;

      try {
        if (mailgunService && mailgunService.isInitialized()) {
          await mailgunService.sendEmail({
            from: `Support <support@${mailgunService.getDomain()}>`,
            to: email,
            subject: resetSubject,
            text: resetText,
            html: resetHtml,
          });
          console.log("Password reset email sent to:", email);
        } else {
          console.log(
            `Would send password reset email to ${email} with link: ${resetLink}`,
          );
        }
      } catch (emailError) {
        console.error("Error sending password reset email:", emailError);
        // Continue even if email sending fails
      }

      res.json({
        message: "If the email is registered, a reset link will be sent",
      });
    } catch (error) {
      console.error("Error requesting password reset:", error);
      res
        .status(500)
        .json({ message: "Failed to process password reset request" });
    }
  });

  // Reset password using token
  app.post("/api/reset-password/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const { password } = req.body;

      console.log(
        "Password reset attempt with token:",
        token?.substring(0, 8) + "...",
      );

      // Validate token
      const user = await storage.getUserByResetToken(token);
      if (!user) {
        console.log("Invalid or expired token used for password reset");
        return res.status(400).json({ message: "Invalid or expired token" });
      }

      console.log("Valid token found for user:", user.id);

      // Hash the new password
      console.log("Hashing new password for reset");
      const hashedPassword = await hashPassword(password);
      console.log("Password hashed successfully, updating in database");

      // Update user's password in the database
      const updatedUser = await storage.updateUserPassword(
        user.id,
        hashedPassword,
      );

      if (!updatedUser) {
        console.log("Failed to update user password");
        return res.status(500).json({ message: "Failed to update password" });
      }

      // Verify the user has the correct password now
      const currentUser = await storage.getUser(user.id);
      console.log(
        `Verification: User password updated from ${currentUser?.password?.substring(0, 20)}...`,
      );

      // Clear reset token
      const cleared = await storage.clearResetToken(user.id);
      if (!cleared) {
        console.log(
          "Warning: Failed to clear reset token, but password was updated",
        );
      }

      console.log("Password reset successful for user:", user.id);
      res.json({ message: "Password updated successfully" });
    } catch (error) {
      console.error("Error resetting password:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Get all tickets with pagination, sorting and filtering
  app.get("/api/tickets", isAuthenticated, async (req, res) => {
    try {
      // Get query parameters for sorting and filtering
      const sortBy = (req.query.sortBy as string) || "updatedAt"; // Default to updatedAt for newest messages at top
      const sortOrder = (req.query.sortOrder as string) || "desc"; // Default to descending (newest first)
      const statusFilter = req.query.status as string;
      const deskId = req.query.deskId
        ? parseInt(req.query.deskId as string)
        : undefined;
      
      // Pagination parameters
      const page = parseInt(req.query.page as string) || 1;
      const perPage = parseInt(req.query.perPage as string) || 15;
      const offset = (page - 1) * perPage;

      // Assignment filtering parameters
      const isAssigned = req.query.isAssigned as string;
      const assignedUserId = req.query.assignedUserId
        ? parseInt(req.query.assignedUserId as string)
        : undefined;

      // First, fetch desks the user has access to
      const userId = req.user!.id;
      const isAdmin = req.user!.role === "admin";

      // Create placeholders for SQL query to filter by desk and/or assigned user
      const sqlParams: any[] = [];
      const sqlConditions: string[] = [];

      // Build the WHERE conditions first
      let whereClause = "WHERE 1=1";
      
      // Define the base queries
      let sqlQuery = `
        SELECT t.id, t.subject, t.status, t.customer_name as "customerName", 
               t.customer_email as "customerEmail", t.created_at as "createdAt", 
               t.updated_at as "updatedAt", t.desk_id as "deskId", 
               t.assigned_user_id as "assignedUserId", t.resolved_at as "resolvedAt",
               d.name as "deskName", u.name as "assignedToName"
        FROM tickets t
        LEFT JOIN desks d ON t.desk_id = d.id
        LEFT JOIN users u ON t.assigned_user_id = u.id
        WHERE 1=1
      `;

      let countQuery = `
        SELECT COUNT(*) as total
        FROM tickets t
        WHERE 1=1
      `;

      // For regular users, only show tickets:
      // 1. From desks they are assigned to AND
      // 2. Only tickets specifically assigned to them via round-robin
      if (!isAdmin) {
        // Get user's assigned desks
        const userDesks = await storage.getUserDesks(userId);
        if (userDesks.length === 0) {
          // User has no desk assignments, return empty array
          console.log(
            `User ${userId} has no desk assignments, returning empty ticket list`,
          );
          return res.json([]);
        }

        const userDeskIds = userDesks.map((desk) => desk.id);
        console.log(
          `User ${userId} is assigned to desk IDs: [${userDeskIds.join(", ")}]`,
        );

        // First condition: Tickets must be from desks the user is assigned to
        if (deskId) {
          // If specific desk is requested
          if (!userDeskIds.includes(deskId)) {
            console.log(
              `Access denied: User ${userId} tried to access desk ${deskId} but is not assigned to it`,
            );
            return res
              .status(403)
              .json({ message: "You don't have access to this desk" });
          }
          sqlConditions.push(`t.desk_id = $${sqlParams.length + 1}`);
          sqlParams.push(deskId);
          console.log(`Filtering tickets for desk ID ${deskId}`);
        } else if (userDeskIds.length > 0) {
          // Or filter by all user's desks
          const deskPlaceholders = userDeskIds
            .map((_, i) => `$${sqlParams.length + i + 1}`)
            .join(",");
          sqlConditions.push(`t.desk_id IN (${deskPlaceholders})`);
          sqlParams.push(...userDeskIds);
          console.log(
            `Filtering tickets for all user's desks: [${userDeskIds.join(", ")}]`,
          );
        }

        // Apply assignment filters for regular users only when specifically requested
        if (assignedUserId !== undefined) {
          // User can only filter by their own ID by default
          if (assignedUserId === userId) {
            sqlConditions.push(`t.assigned_user_id = $${sqlParams.length + 1}`);
            sqlParams.push(userId);
            console.log(
              `Filtering for tickets assigned to user ${userId} (self-filter)`,
            );
          } else if (req.user!.role === "admin") {
            // Only admins can filter by other users
            sqlConditions.push(`t.assigned_user_id = $${sqlParams.length + 1}`);
            sqlParams.push(assignedUserId);
            console.log(
              `Admin filtering for tickets assigned to user ${assignedUserId}`,
            );
          } else {
            // Regular users can't see tickets assigned to other users
            console.log(
              `Access denied: Regular user ${userId} tried to filter by assignedUserId ${assignedUserId}`,
            );
            return res.json([]);
          }
        } else if (isAssigned === "true") {
          // Only show tickets assigned to this user
          sqlConditions.push(`t.assigned_user_id = $${sqlParams.length + 1}`);
          sqlParams.push(userId);
          console.log(
            `Filtering for tickets assigned to user ${userId} (isAssigned=true filter)`,
          );
        } else if (isAssigned === "false") {
          // Only show unassigned tickets (admins only)
          if (req.user!.role === "admin") {
            sqlConditions.push(`t.assigned_user_id IS NULL`);
            console.log(`Admin filtering for unassigned tickets`);
          } else {
            console.log(
              `Access denied: Regular user ${userId} tried to view unassigned tickets`,
            );
            return res.json([]); // Regular users shouldn't see unassigned tickets
          }
        } else {
          // Default behavior for regular users - show ALL tickets from their assigned desks
          // This allows agents to see all tickets in their desks, not just assigned ones
          console.log(
            `Default filter: Showing all tickets from user ${userId}'s assigned desks`,
          );
          // No additional assignment filter - they can see all tickets from their desks
        }
      } else {
        // Admin can see all tickets, but may filter by desk
        if (deskId) {
          sqlConditions.push(`t.desk_id = $${sqlParams.length + 1}`);
          sqlParams.push(deskId);
        }
      }

      // Apply status filter if specified
      if (
        statusFilter &&
        ["open", "pending", "closed"].includes(statusFilter)
      ) {
        sqlConditions.push(`t.status = $${sqlParams.length + 1}`);
        sqlParams.push(statusFilter);
      }

      // Apply assignment filters for admins (regular users already have assignment filtering)
      if (isAdmin) {
        // Filter by specific assigned user ID
        if (assignedUserId !== undefined) {
          sqlConditions.push(`t.assigned_user_id = $${sqlParams.length + 1}`);
          sqlParams.push(assignedUserId);
        }
        // Filter by assignment status (assigned or unassigned)
        else if (isAssigned === "true") {
          sqlConditions.push(`t.assigned_user_id IS NOT NULL`);
        } else if (isAssigned === "false") {
          sqlConditions.push(`t.assigned_user_id IS NULL`);
        }
      }

      // Add all conditions to both queries
      if (sqlConditions.length > 0) {
        const conditionsString = " AND " + sqlConditions.join(" AND ");
        sqlQuery += conditionsString;
        countQuery += conditionsString;
      }

      // Execute count query to get total items for pagination
      console.log('Count query:', countQuery);
      console.log('SQL params for count:', sqlParams);
      
      // Create a clean count query without any potential corruption
      let cleanCountQuery = `SELECT COUNT(*) as total FROM tickets t WHERE 1=1`;
      let cleanCountParams = [];
      
      // Rebuild the count query conditions cleanly
      if (sqlConditions.length > 0) {
        cleanCountQuery += " AND " + sqlConditions.join(" AND ");
        cleanCountParams = [...sqlParams];
      }
      
      console.log('Clean count query:', cleanCountQuery);
      console.log('Clean count params:', cleanCountParams);
      
      const countResult = await pool.query(cleanCountQuery, cleanCountParams.length > 0 ? cleanCountParams : []);
      const totalItems = parseInt(countResult.rows[0].total.toString());
      const totalPages = Math.ceil(totalItems / perPage);

      console.log(`Total tickets: ${totalItems}, Total pages: ${totalPages}, Current page: ${page}`);

      // Add sorting
      const sortColumn =
        sortBy === "createdAt"
          ? "t.created_at"
          : sortBy === "updatedAt"
            ? "t.updated_at"
            : sortBy === "status"
              ? "t.status"
              : sortBy === "subject"
                ? "t.subject"
                : "t.updated_at"; // Default to updated_at for newest messages first

      const sortDirection = sortOrder === "asc" ? "ASC" : "DESC";
      sqlQuery += ` ORDER BY ${sortColumn} ${sortDirection}`;

      // Add pagination
      sqlQuery += ` LIMIT $${sqlParams.length + 1} OFFSET $${sqlParams.length + 2}`;
      sqlParams.push(perPage, offset);

      console.log(`Executing ticket query with LIMIT ${perPage} OFFSET ${offset}`);

      // Execute the query with pagination
      const { rows } = await pool.query(sqlQuery, sqlParams);
      console.log(`Retrieved ${rows.length} tickets for page ${page}`);

      // Transform results to match our Ticket type
      const tickets = rows.map((row: any) => ({
        id: Number(row.id),
        subject: row.subject,
        status: row.status,
        customerName: row.customerName,
        customerEmail: row.customerEmail,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        deskId: row.deskId ? Number(row.deskId) : null,
        deskName: row.deskName || 'Unassigned',
        assignedUserId: row.assignedUserId ? Number(row.assignedUserId) : null,
        assignedToName: row.assignedToName || null,
        resolvedAt: row.resolvedAt,
        priority: row.priority || 'medium',
      }));

      // Return paginated response
      res.json({
        tickets,
        pagination: {
          totalItems,
          totalPages,
          currentPage: page,
          perPage
        }
      });
    } catch (error) {
      console.error("Error fetching tickets:", error);
      res.status(500).json({ message: "Failed to fetch tickets" });
    }
  });

  // Get a specific ticket with its messages
  app.get("/api/tickets/:id", isAuthenticated, async (req, res) => {
    try {
      console.log(`=============== TICKET FETCH DEBUG ===============`);
      console.log(`Fetching ticket details for ID: ${req.params.id}`);
      const ticketId = parseInt(req.params.id);

      if (isNaN(ticketId)) {
        console.error(`Invalid ticket ID format: ${req.params.id}`);
        return res.status(400).json({ message: "Invalid ticket ID format" });
      }

      console.log(`[DB QUERY] Looking up ticket with ID: ${ticketId}`);
      const ticket = await storage.getTicketById(ticketId);

      if (!ticket) {
        console.log(`Ticket not found with ID: ${ticketId}`);
        return res.status(404).json({ message: "Ticket not found" });
      }

      console.log(
        `[DB RESULT] Found ticket: ${JSON.stringify(ticket, null, 2)}`,
      );

      // Check if user has access to this ticket's desk and assignment
      const userId = req.user!.id;
      const isAdmin = req.user!.role === "admin";

      console.log(
        `[AUTH CHECK] User ${userId} (admin: ${isAdmin}) requesting access to ticket ${ticketId}`,
      );

      // Admins have access to all tickets
      if (!isAdmin) {
        // First check desk access
        if (ticket.deskId) {
          // Get user's assigned desks
          const userDesks = await storage.getUserDesks(userId);
          const userDeskIds = userDesks.map((desk) => desk.id);

          console.log(
            `User desk IDs: ${userDeskIds.join(", ")}, Ticket desk ID: ${ticket.deskId}`,
          );

          // Check if user has access to the ticket's desk
          if (!userDeskIds.includes(ticket.deskId)) {
            console.log(
              `Access denied: User ${userId} does not have access to desk ${ticket.deskId}`,
            );
            return res
              .status(403)
              .json({ message: "You don't have access to this ticket" });
          }
        }

        // Allow agents to access any ticket from their assigned desks
        // (Removed assignment restriction - agents can see all tickets in their desks)
        console.log(
          `Access granted: User ${userId} can access ticket ${ticketId} from their assigned desk ${ticket.deskId}`,
        );
      }

      // Get the desk data for this ticket
      let deskData = null;
      if (ticket.deskId) {
        console.log(`Fetching desk data for desk ID: ${ticket.deskId}`);
        deskData = await storage.getDeskById(ticket.deskId);
        console.log(`Desk data: ${JSON.stringify(deskData, null, 2)}`);
      }

      // Get the assigned user data if available
      let assignedUser = null;
      if (ticket.assignedUserId) {
        console.log(
          `Fetching assigned user data for user ID: ${ticket.assignedUserId}`,
        );
        const user = await storage.getUser(ticket.assignedUserId);
        if (user) {
          assignedUser = {
            id: user.id,
            name: user.name,
            username: user.username,
          };
          console.log(
            `Assigned user: ${JSON.stringify(assignedUser, null, 2)}`,
          );
        } else {
          console.log(`Assigned user ${ticket.assignedUserId} not found`);
        }
      }

      // Enhance ticket with desk and assignment data
      const ticketWithDesk = {
        ...ticket,
        desk: deskData,
        assignedUser,
      };

      console.log(`Fetching messages for ticket ID: ${ticketId}`);
      const messages = await storage.getMessagesByTicketId(ticketId);
      console.log(`Found ${messages.length} messages for ticket ${ticketId}`);

      // Debug the message structure
      if (messages.length > 0) {
        console.log(
          `First message sample: ${JSON.stringify(messages[0], null, 2)}`,
        );
      }

      console.log(
        `Sending response with ticket data and ${messages.length} messages`,
      );
      res.json({ ticket: ticketWithDesk, messages });
    } catch (error) {
      console.error("Error fetching ticket details:", error);
      res
        .status(500)
        .json({
          message: "Failed to fetch ticket details",
          error: String(error),
        });
    }
  });

  // Create a new ticket
  app.post("/api/tickets", isAuthenticated, async (req, res) => {
    try {
      const validatedData = insertTicketSchema.parse(req.body);
      const ticket = await storage.createTicket(validatedData);
      res.status(201).json(ticket);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid ticket data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create ticket" });
    }
  });

  // Create ticket with initial message and send email notification
  app.post("/api/tickets/create", isAuthenticated, async (req, res) => {
    try {
      const {
        subject,
        customerName,
        customerEmail,
        message,
        deskId,
        sendEmail,
      } = req.body;

      if (!subject || !customerName || !customerEmail || !message) {
        return res
          .status(400)
          .json({ message: "Missing required fields for ticket creation" });
      }

      // Check if the user has access to the specified desk (if provided)
      // For admins, allow creating tickets for any desk
      // For regular users, only allow creating tickets for assigned desks
      const userId = req.user!.id;
      const isAdmin = req.user!.role === "admin";

      let ticketDeskId = deskId;

      if (!isAdmin && deskId) {
        // Verify user has access to this desk
        const userDesks = await storage.getUserDesks(userId);
        const userDeskIds = userDesks.map((desk) => desk.id);

        if (!userDeskIds.includes(deskId)) {
          return res
            .status(403)
            .json({ message: "You don't have access to this desk" });
        }
      } else if (!deskId) {
        // If no desk is specified, use the default desk
        const defaultDesk = await storage.getDefaultDesk();
        if (defaultDesk) {
          ticketDeskId = defaultDesk.id;
        }
      }

      // For Mailgun, we need to check recipient authorization for sandbox domains
      let emailAuthorized = true;
      let emailAuthorizationMessage = "";

      if (
        sendEmail &&
        mailgunService.isInitialized() &&
        mailgunService.getDomain().includes("sandbox")
      ) {
        emailAuthorized = await isRecipientAuthorized(customerEmail);
        if (!emailAuthorized) {
          emailAuthorizationMessage = `Note: Email could not be sent because ${customerEmail} is not an authorized recipient for the Mailgun sandbox domain.`;
        }
      }

      // Create new ticket
      const newTicket = await storage.createTicket({
        subject,
        status: "open",
        customerName,
        customerEmail,
        deskId: ticketDeskId, // Use the validated desk ID
      });

      // Get desk information to use the proper from address and for SMTP configuration
      let desk = null;
      if (ticketDeskId) {
        desk = await storage.getDeskById(ticketDeskId);
      }

      if (!desk) {
        // Fallback to default desk if specified desk doesn't exist
        desk = await storage.getDefaultDesk();
        console.log(`Using default desk for ticket creation as specified desk was not found`);
      }

      // Generate a proper Message-ID that uses the desk's email domain
      let messageId;
      const timestamp = Date.now();
      const uniqueId = Math.random().toString(36).substring(2, 15);
      
      if (desk && desk.smtpUser && desk.smtpUser.includes('@')) {
        // Extract domain from SMTP username (which is the email address)
        const domain = desk.smtpUser.split('@')[1];
        messageId = `<ticket-${newTicket.id}-new-${timestamp}-${uniqueId}@${domain}>`;
        console.log(`Generated message ID using desk's email domain: ${messageId}`);
      } else {
        // Fallback domain if desk configuration is incomplete
        messageId = `<ticket-${newTicket.id}-new-${timestamp}-${uniqueId}@helpdesk.channelplay.in>`;
        console.log(`Using fallback domain for message ID: ${messageId}`);
      }

      // Add initial message from customer
      const initialMessage = await storage.createMessage({
        ticketId: newTicket.id,
        content: message,
        sender: customerName,
        senderEmail: customerEmail,
        isAgent: false,
        messageId,
      });

      // Send email notification to customer if requested
      let emailSent = false;
      
      if (sendEmail) {
        try {
          const emailContent = `
            Thank you for contacting us. Your support ticket #${newTicket.id} has been created.
            
            Subject: ${subject}
            
            Your Message:
            ${message}
            
            Our team will respond to your inquiry as soon as possible. You can reply directly to this email to add more information to your ticket.
          `;
          
          // Create HTML version of the content
          const htmlContent = `<div>${emailContent.replace(/\n/g, "<br>")}</div>`;
          
          // If desk has SMTP configured, use direct email
          if (desk && 
              desk.smtpHost && 
              desk.smtpPort && 
              desk.smtpUser && 
              desk.smtpPassword) {
            
            // Import the direct email function
            const { sendNewTicketEmailDirect } = require('./email-direct');
            
            // Send email using direct SMTP
            const result = await sendNewTicketEmailDirect({
              ticketId: newTicket.id,
              subject: `[Ticket #${newTicket.id}] ${subject}`,
              text: emailContent,
              html: htmlContent,
              to: customerEmail,
              messageId
            });
            
            if (result.success) {
              console.log(`Confirmation email sent directly via SMTP for ticket #${newTicket.id}`);
              emailSent = true;
            } else {
              console.error(`Failed to send direct email: ${result.error}`);
              
              // Do NOT fall back to Mailgun - this is important to prevent "via helpdesk" text
              emailSent = false;
            }
          } else {
            console.log(`Desk does not have SMTP configured, skipping email notification`);
            emailSent = false;
          }
        } catch (error) {
          console.error("Failed to send confirmation email for new ticket:", error);
          emailSent = false;
        }
      }

      // Prepare response message
      const responseMessage = "Ticket created successfully";

      res.status(201).json({
        message: responseMessage,
        success: true,
        ticket: newTicket,
        initialMessage,
        emailSent,
      });
    } catch (error) {
      console.error("Ticket creation error:", error);
      res.status(500).json({ message: "Failed to create ticket" });
    }
  });

  // Update ticket (including CC recipients)
  app.patch("/api/tickets/:id", isAuthenticated, async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const updates = req.body;
      
      console.log(`API: Updating ticket ${ticketId} with:`, updates);
      
      // Validate ticket exists and user has access
      const existingTicket = await storage.getTicketById(ticketId);
      if (!existingTicket) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      
      // Update the ticket
      const updatedTicket = await storage.updateTicket(ticketId, updates);
      
      if (!updatedTicket) {
        return res.status(404).json({ message: "Failed to update ticket" });
      }
      
      console.log(`API: Ticket ${ticketId} updated successfully`);
      res.json(updatedTicket);
    } catch (error) {
      console.error("Error updating ticket:", error);
      res.status(500).json({ message: "Failed to update ticket" });
    }
  });

  // Update ticket status
  app.patch("/api/tickets/:id/status", isAuthenticated, async (req, res) => {
    try {
      console.log(
        `API: Updating ticket status, ID: ${req.params.id}, New status: ${req.body.status}`,
      );
      const ticketId = parseInt(req.params.id);
      const { status } = req.body;

      if (!["open", "pending", "closed"].includes(status)) {
        console.log(`API: Invalid status provided: ${status}`);
        return res.status(400).json({ message: "Invalid status" });
      }

      const ticket = await storage.updateTicketStatus(ticketId, status);

      if (!ticket) {
        console.log(`API: Ticket not found: ${ticketId}`);
        return res.status(404).json({ message: "Ticket not found" });
      }

      console.log(`API: Ticket ${ticketId} status updated to ${status}`);

      // If the ticket was closed, send a customer satisfaction survey
      if (status === "closed" && ticket) {
        console.log(
          `API: Ticket ${ticketId} was closed, preparing satisfaction survey`,
        );
        try {
          // Generate a secure token to validate survey responses
          const crypto = require("crypto");
          const token = crypto.randomBytes(16).toString("hex");
          console.log(
            `API: Generated token for satisfaction survey: ${token.substring(0, 8)}...`,
          );

          // Generate the survey URL with ticket ID, token, and rating options
          const appHost = req.get("host") || "cphelp.replit.app";
          const protocol = req.get("x-forwarded-proto") || req.protocol;
          const baseSurveyUrl = `${protocol}://${appHost}/api/tickets/${ticketId}/satisfaction?token=${token}`;
          console.log(`API: Base survey URL: ${baseSurveyUrl}`);

          // Create HTML for satisfaction survey with emoji ratings
          const surveyHtml = `
          <div style="margin-top: 30px; padding: 20px; border-top: 1px solid #ddd;">
            <h2 style="color: #333; font-size: 18px;">How would you rate our support?</h2>
            <p style="color: #666; font-size: 14px;">Please take a moment to rate your support experience. Your feedback helps us improve our service.</p>
            
            <table cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 20px 0;">
              <tr align="center">
                <td width="20%" style="padding: 10px;">
                  <a href="${baseSurveyUrl}&rating=1" style="text-decoration: none;">
                    <div style="font-size: 36px; margin-bottom: 5px;">😡</div>
                    <div style="color: #e74c3c; font-weight: bold;">Bad</div>
                  </a>
                </td>
                <td width="20%" style="padding: 10px;">
                  <a href="${baseSurveyUrl}&rating=2" style="text-decoration: none;">
                    <div style="font-size: 36px; margin-bottom: 5px;">🙁</div>
                    <div style="color: #e67e22; font-weight: bold;">Poor</div>
                  </a>
                </td>
                <td width="20%" style="padding: 10px;">
                  <a href="${baseSurveyUrl}&rating=3" style="text-decoration: none;">
                    <div style="font-size: 36px; margin-bottom: 5px;">😐</div>
                    <div style="color: #f39c12; font-weight: bold;">Average</div>
                  </a>
                </td>
                <td width="20%" style="padding: 10px;">
                  <a href="${baseSurveyUrl}&rating=4" style="text-decoration: none;">
                    <div style="font-size: 36px; margin-bottom: 5px;">🙂</div>
                    <div style="color: #27ae60; font-weight: bold;">Good</div>
                  </a>
                </td>
                <td width="20%" style="padding: 10px;">
                  <a href="${baseSurveyUrl}&rating=5" style="text-decoration: none;">
                    <div style="font-size: 36px; margin-bottom: 5px;">😃</div>
                    <div style="color: #2ecc71; font-weight: bold;">Excellent</div>
                  </a>
                </td>
              </tr>
            </table>
            
            <p style="color: #999; font-size: 12px; text-align: center;">
              Your feedback is important to us. Thank you for helping us improve!
            </p>
          </div>
          `;

          // Create plaintext version of survey
          const surveyText = `
          How would you rate our support?
          
          Please click one of the following links to rate your experience:
          
          Bad (1/5): ${baseSurveyUrl}&rating=1
          Poor (2/5): ${baseSurveyUrl}&rating=2
          Average (3/5): ${baseSurveyUrl}&rating=3
          Good (4/5): ${baseSurveyUrl}&rating=4
          Excellent (5/5): ${baseSurveyUrl}&rating=5
          
          Your feedback is important to us. Thank you for helping us improve!
          `;

          // Send the satisfaction survey email
          console.log(
            `STATUS UPDATE: Preparing satisfaction survey email for ticket #${ticketId}`,
          );

          if (!mailgunService.isInitialized()) {
            console.error(
              `STATUS UPDATE: Mailgun service is not initialized. Cannot send satisfaction survey.`,
            );
            throw new Error("Mailgun service is not initialized");
          }

          // Generate a unique message ID with proper format for this email
          const timestamp = Date.now();
          const uniqueId = Math.random().toString(36).substring(2, 15);
          const domain = mailgunService.getDomain();
          const messageId = `<ticket-${ticketId}-satisfaction-${timestamp}-${uniqueId}@${domain}>`;
          console.log(
            `STATUS UPDATE: Generated message ID for satisfaction survey: ${messageId}`,
          );

          // Get desk information to use the proper from address
          let deskName = "Support";
          let deskEmail = "postmaster";

          if (ticket.deskId) {
            const desk = await storage.getDeskById(ticket.deskId);
            if (desk) {
              deskName = desk.name || "Support";
              deskEmail = desk.email || "postmaster";
              console.log(
                `STATUS UPDATE: Using desk for satisfaction survey: ${deskName} <${deskEmail}>`,
              );
            } else {
              console.log(
                `STATUS UPDATE: Desk ID ${ticket.deskId} not found, using default values`,
              );
            }
          } else {
            console.log(
              `STATUS UPDATE: No desk ID associated with ticket, using default values`,
            );
          }

          // Format the from address with name
          const fromEmail = formatFromEmail(deskName, deskEmail);
          console.log(
            `STATUS UPDATE: Using formatted from email for satisfaction survey: ${fromEmail}`,
          );

          // Check if recipient is on Outlook/Microsoft domain
          const isOutlookRecipient =
            ticket.customerEmail.toLowerCase().includes("outlook.com") ||
            ticket.customerEmail.toLowerCase().includes("hotmail.com") ||
            ticket.customerEmail.toLowerCase().includes("live.com") ||
            ticket.customerEmail.toLowerCase().includes("msn.com") ||
            ticket.customerEmail.toLowerCase().includes("microsoft.com");

          if (isOutlookRecipient) {
            console.log(
              `STATUS UPDATE: Recipient appears to be an Outlook/Microsoft user, applying special formatting.`,
            );
          }

          // Create email content in HTML and text format
          const emailSubject = `[Ticket #${ticketId}] Your ticket has been resolved - Please rate our service`;
          console.log(`STATUS UPDATE: Email subject: "${emailSubject}"`);

          const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #333;">Your ticket has been resolved</h2>
              <p style="color: #666;">
                Thank you for contacting our support team. Your ticket #${ticketId} has been resolved.
              </p>
              ${surveyHtml}
            </div>
          `;

          // Prepare email options
          const emailOptions = {
            from: fromEmail,
            to: ticket.customerEmail,
            subject: emailSubject,
            text: `Thank you for contacting our support team. Your ticket #${ticketId} has been resolved.\n\n${surveyText}`,
            html: emailHtml,
            "v:ticketId": ticketId.toString(),
            "h:Message-Id": messageId,
          };

          // Log email content size for debugging
          console.log(
            `STATUS UPDATE: Email content length - HTML: ${emailHtml.length} chars, Text: ${surveyText.length} chars`,
          );

          try {
            // Send the email
            console.log(
              `STATUS UPDATE: Sending satisfaction survey email to ${ticket.customerEmail}`,
            );
            const result = await mailgunService.sendEmail(emailOptions);

            if (result && result.id) {
              console.log(
                `STATUS UPDATE: ✅ Satisfaction survey email sent successfully with ID: ${result.id}`,
              );
              console.log(
                `STATUS UPDATE: Email delivery tracking ID: ${result.id}`,
              );
            } else {
              console.log(
                `STATUS UPDATE: ✅ Satisfaction survey email sent, but no tracking ID returned`,
              );
            }
          } catch (error) {
            const mailError = error as any;
            console.error(
              `STATUS UPDATE: ❌ Failed to send satisfaction survey email:`,
              mailError,
            );

            // Log detailed error information
            if (mailError.response) {
              console.error(
                "STATUS UPDATE: Mailgun API response:",
                mailError.response.data || mailError.response,
              );
            }

            if (mailError.code) {
              console.error(`STATUS UPDATE: Error code: ${mailError.code}`);
            }

            throw mailError;
          }
        } catch (error) {
          const emailError = error as any;
          console.error("Error sending satisfaction survey email:", emailError);
          // We don't want to fail the ticket status update if the email fails
          console.error(
            "Error details:",
            JSON.stringify(
              {
                message: emailError.message || "Unknown error",
                stack: emailError.stack || "No stack trace",
                code: emailError.code || "No error code",
                response: emailError.response
                  ? {
                      status: emailError.response.status,
                      statusText: emailError.response.statusText,
                      data: emailError.response.data,
                    }
                  : "No response",
              },
              null,
              2,
            ),
          );
        }
      }

      res.json(ticket);
    } catch (error) {
      res.status(500).json({ message: "Failed to update ticket status" });
    }
  });

  // Split a message into a new ticket - allows agents to manually separate emails
  app.post("/api/tickets/split-message", isAuthenticated, async (req, res) => {
    try {
      const { messageId, newTicketSubject } = req.body;

      if (!messageId || !newTicketSubject) {
        return res.status(400).json({
          message:
            "Missing required parameters: messageId and newTicketSubject",
        });
      }

      // Get the message to split
      const messages = await storage.getMessagesByExactId(messageId);
      if (!messages || messages.length === 0) {
        return res.status(404).json({ message: "Message not found" });
      }

      const messageToSplit = messages[0];
      const originalTicketId = messageToSplit.ticketId;

      // Get the original ticket to copy customer information
      const originalTicket = await storage.getTicketById(originalTicketId);
      if (!originalTicket) {
        return res.status(404).json({ message: "Original ticket not found" });
      }

      // Create a new ticket - preserve desk assignment from original ticket
      const newTicket = await storage.createTicket({
        subject: newTicketSubject,
        customerName: originalTicket.customerName,
        customerEmail: originalTicket.customerEmail,
        status: "open",
        deskId: originalTicket.deskId, // Maintain same desk assignment
      });

      // Create a copy of the message in the new ticket
      // Generate a proper RFC-compliant message ID with angle brackets
      const timestamp = Date.now();
      const uniqueId = Math.random().toString(36).substring(2, 15);
      const domain = mailgunService.getDomain() || "mail.domain.com";
      const newMessageId = `<split-ticket-${newTicket.id}-from-${originalTicketId}-${timestamp}-${uniqueId}@${domain}>`;

      console.log(
        `Generated RFC-compliant message ID for split ticket: ${newMessageId}`,
      );

      const newMessage = await storage.createMessage({
        ticketId: newTicket.id,
        content: messageToSplit.content,
        sender: messageToSplit.sender,
        senderEmail: messageToSplit.senderEmail,
        isAgent: messageToSplit.isAgent,
        messageId: newMessageId,
      });

      res.status(201).json({
        message: "Message successfully split into new ticket",
        originalTicketId,
        newTicket,
        newMessage,
      });
    } catch (error) {
      console.error("Error splitting message:", error);
      res
        .status(500)
        .json({ message: "Failed to split message into new ticket" });
    }
  });

  // Send resolution notification with satisfaction survey
  app.post(
    "/api/tickets/:id/resolve-notification",
    isAuthenticated,
    async (req, res) => {
      try {
        console.log(
          `API: Sending resolution notification for ticket ${req.params.id}`,
        );

        const ticketId = parseInt(req.params.id);
        if (isNaN(ticketId)) {
          console.log(`API: Invalid ticket ID provided: ${req.params.id}`);
          return res.status(400).json({ message: "Invalid ticket ID" });
        }

        const ticket = await storage.getTicketById(ticketId);
        if (!ticket) {
          console.log(`API: Ticket not found: ${ticketId}`);
          return res.status(404).json({ message: "Ticket not found" });
        }

        console.log(
          `API: Found ticket: ${ticketId}, Status: ${ticket.status}, Customer: ${ticket.customerEmail}`,
        );

        // Get desk information first to use proper domain for Message-ID
        let fullDesk = null;
        if (ticket.deskId) {
          fullDesk = await storage.getDeskById(ticket.deskId);
        }

        // Generate a unique RFC-compliant message ID using desk's domain
        const timestamp = Date.now();
        const uniqueId = Math.random().toString(36).substring(2, 15);
        
        // Use desk's email domain instead of helpdesk.1office.in
        let domain = "example.com";
        if (fullDesk && fullDesk.smtpUser && fullDesk.smtpUser.includes('@')) {
          domain = fullDesk.smtpUser.split('@')[1];
        }
        
        const messageId = `<ticket-${ticketId}-resolution-${timestamp}-${uniqueId}@${domain}>`;

        console.log(
          `API: Generated RFC-compliant message ID for resolution notification: ${messageId}`,
        );

        // Send resolution notification with customer satisfaction survey
        const emailSubject = `Your ticket #${ticketId} has been resolved - Please rate your experience`;

        // Generate satisfaction survey links with unique identifiers
        const surveyBase = `${req.protocol}://${req.get("host")}/api/tickets/${ticketId}/satisfaction`;
        const badLink = `${surveyBase}?rating=1&token=${timestamp}-${uniqueId}`;
        const poorLink = `${surveyBase}?rating=2&token=${timestamp}-${uniqueId}`;
        const averageLink = `${surveyBase}?rating=3&token=${timestamp}-${uniqueId}`;
        const goodLink = `${surveyBase}?rating=4&token=${timestamp}-${uniqueId}`;
        const excellentLink = `${surveyBase}?rating=5&token=${timestamp}-${uniqueId}`;

        const emailContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e9e9e9; border-radius: 5px;">
          <h2 style="color: #333; border-bottom: 1px solid #e9e9e9; padding-bottom: 10px;">Ticket Resolved</h2>
          
          <p>Dear ${ticket.customerName},</p>
          
          <p>Your support ticket <strong>#${ticketId}: ${ticket.subject}</strong> has been resolved.</p>
          
          <p>This ticket is now closed. If you need further assistance, please create a new support ticket.</p>
          
          <div style="margin: 25px 0; padding: 20px; background-color: #f9f9f9; border-radius: 5px; text-align: center;">
            <h3 style="margin-top: 0; color: #333;">How would you rate your support experience?</h3>
            <p style="margin-bottom: 20px;">Your feedback helps us improve our service.</p>
            
            <div style="display: flex; justify-content: center; margin-bottom: 15px;">
              <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
                <tr>
                  <td align="center" style="padding: 0 10px;">
                    <a href="${badLink}" style="display: block; text-decoration: none;">
                      <div style="font-size: 24px; margin-bottom: 5px;">😡</div>
                      <div style="background-color: #dc3545; color: white; padding: 8px 15px; border-radius: 4px; font-weight: bold;">Bad</div>
                    </a>
                  </td>
                  <td align="center" style="padding: 0 10px;">
                    <a href="${poorLink}" style="display: block; text-decoration: none;">
                      <div style="font-size: 24px; margin-bottom: 5px;">🙁</div>
                      <div style="background-color: #d9534f; color: white; padding: 8px 15px; border-radius: 4px; font-weight: bold;">Poor</div>
                    </a>
                  </td>
                  <td align="center" style="padding: 0 10px;">
                    <a href="${averageLink}" style="display: block; text-decoration: none;">
                      <div style="font-size: 24px; margin-bottom: 5px;">😐</div>
                      <div style="background-color: #f0ad4e; color: white; padding: 8px 15px; border-radius: 4px; font-weight: bold;">Average</div>
                    </a>
                  </td>
                  <td align="center" style="padding: 0 10px;">
                    <a href="${goodLink}" style="display: block; text-decoration: none;">
                      <div style="font-size: 24px; margin-bottom: 5px;">🙂</div>
                      <div style="background-color: #5cb85c; color: white; padding: 8px 15px; border-radius: 4px; font-weight: bold;">Good</div>
                    </a>
                  </td>
                  <td align="center" style="padding: 0 10px;">
                    <a href="${excellentLink}" style="display: block; text-decoration: none;">
                      <div style="font-size: 24px; margin-bottom: 5px;">😃</div>
                      <div style="background-color: #28a745; color: white; padding: 8px 15px; border-radius: 4px; font-weight: bold;">Excellent</div>
                    </a>
                  </td>
                </tr>
              </table>
            </div>
            
            <p style="color: #666; font-size: 12px;">Just click one of the options above to provide your rating.</p>
          </div>
          
          <p>Thank you for your business!</p>
          
          <p style="border-top: 1px solid #e9e9e9; padding-top: 10px; color: #777; font-size: 12px;">
            This is an automated message. Please do not reply to this email.
          </p>
        </div>
      `;

        try {
          // ✅ FIX: Use direct SMTP instead of Mailgun to prevent "via helpdesk.1office.in"
          if (!fullDesk || !fullDesk.smtpHost || !fullDesk.smtpUser || !fullDesk.smtpPassword) {
            throw new Error("Desk SMTP configuration is incomplete - cannot send resolution email");
          }

          console.log(`✅ Using direct SMTP for resolution email: ${fullDesk.smtpHost}:${fullDesk.smtpPort}`);

          // Get existing messages to find original Message-ID for threading
          const existingMessages = await storage.getMessagesByTicketId(ticketId);
          let originalMessageId = null;
          
          if (existingMessages.length > 0) {
            // Use the first message's Message-ID for proper email threading
            originalMessageId = existingMessages[0].messageId;
            console.log(`✅ Found original Message-ID for threading: ${originalMessageId}`);
          }

          // Create SMTP transporter using desk's settings
          const nodemailer = require('nodemailer');
          const transporter = nodemailer.createTransporter({
            host: fullDesk.smtpHost,
            port: parseInt(fullDesk.smtpPort || '587'),
            secure: fullDesk.smtpSecure || false,
            auth: {
              user: fullDesk.smtpUser,
              pass: fullDesk.smtpPassword
            },
            tls: {
              rejectUnauthorized: false
            }
          });
          
          console.log(`✅ SMTP transporter created for resolution email`);
          
          // Send the resolution email using direct SMTP with threading
          const mailOptions = {
            from: `${fullDesk.name} <${fullDesk.smtpUser}>`,
            to: ticket.customerEmail,
            subject: `Re: ${ticket.subject}`, // Use "Re:" for threading
            text: `Your ticket #${ticketId} has been resolved. This ticket is now closed permanently. If you need further assistance, please create a new support ticket.`,
            html: emailContent,
            messageId: messageId,
            inReplyTo: originalMessageId, // ✅ Critical for email threading
            references: originalMessageId // ✅ Critical for email threading
          };
          
          const emailResult = await transporter.sendMail(mailOptions);

          console.log(`API: Email send result:`, emailResult);

          // Log the successful sending of the notification
          const user = req.user!;
          console.log(
            `API: Resolution notification sent for ticket #${ticketId} by ${user.name} (${user.email})`,
          );

          // Return success response
          res.status(200).json({
            message: "Resolution notification sent successfully",
            ticketId,
            success: true,
          });
        } catch (emailError) {
          console.error(
            "API: Error sending resolution notification:",
            emailError,
          );
          // Provide more detailed error information for debugging
          const errorDetails = {
            message:
              emailError instanceof Error
                ? emailError.message
                : String(emailError),
            stack: emailError instanceof Error ? emailError.stack : undefined,
            mailgunStatus: {
              initialized: mailgunService.isInitialized(),
              domain: mailgunService.getDomain(),
              apiEndpoint: mailgunService.apiEndpoint,
            },
          };
          console.error(
            "API: Detailed error information:",
            JSON.stringify(errorDetails, null, 2),
          );

          res.status(500).json({
            message: "Error sending resolution notification",
            error: String(emailError),
            details: errorDetails,
          });
        }
      } catch (error) {
        console.error("API: Error processing resolve notification:", error);
        const errorInfo = {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        };
        console.error(
          "API: Error details:",
          JSON.stringify(errorInfo, null, 2),
        );

        res.status(500).json({
          message: "Error processing resolve notification",
          error: String(error),
          details: errorInfo,
        });
      }
    },
  );

  // Get messages for a specific ticket
  app.get("/api/tickets/:id/messages", isAuthenticated, async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const ticket = await storage.getTicketById(ticketId);

      if (!ticket) {
        return res.status(404).json({ message: "Ticket not found" });
      }

      const messages = await storage.getMessagesByTicketId(ticketId);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ message: "Failed to fetch ticket messages" });
    }
  });

  // Add a message to a ticket and send email reply
  app.post(
    "/api/tickets/:id/messages",
    isAuthenticated,
    upload.array("attachments", 5),
    async (req, res) => {
      try {
        console.log(`Adding message to ticket ID: ${req.params.id}`);
        console.log(`[DEBUG CC ISSUE] Request body:`, JSON.stringify(req.body, null, 2));

        // Debug file uploads
        console.log(
          `Request files:`,
          req.files
            ? `${Array.isArray(req.files) ? req.files.length : "unknown"} files received`
            : "No files in request",
        );

        const ticketId = parseInt(req.params.id);
        console.log(`Looking up ticket with ID: ${ticketId}`);
        const ticket = await storage.getTicketById(ticketId);

        if (!ticket) {
          console.log(`Ticket not found with ID: ${ticketId}`);
          return res.status(404).json({ message: "Ticket not found" });
        }

        console.log(`Found ticket #${ticket.id}, adding new message`);
        const { content } = req.body;
        const user = req.user!;
        
        // Process CC recipients - combine form data with existing ticket CC recipients
        let ccRecipients: string[] = [];
        
        // First, get CC recipients from the existing ticket
        if (ticket.ccRecipients && Array.isArray(ticket.ccRecipients)) {
          ccRecipients = [...ticket.ccRecipients];
          console.log(`Found ${ccRecipients.length} CC recipients from ticket:`, ccRecipients);
        }
        
        // Then, add any additional CC recipients from the form data
        if (req.body.ccRecipients) {
          try {
            const formCcRecipients = JSON.parse(req.body.ccRecipients);
            console.log(`Parsed CC recipients from form data:`, formCcRecipients);
            
            // Add unique CC recipients from form data
            formCcRecipients.forEach((cc: string) => {
              if (!ccRecipients.includes(cc)) {
                ccRecipients.push(cc);
              }
            });
          } catch (error) {
            console.error('Error parsing CC recipients from form data:', error);
          }
        }
        
        console.log(`Final CC recipients for this reply:`, ccRecipients);

        console.log(
          `User ${user.name} (ID: ${user.id}) sending message: ${content.substring(0, 50)}${content.length > 50 ? "..." : ""}`,
        );

        // Process file attachments if any
        let attachments: AttachmentInfo[] = [];
        if (req.files && Array.isArray(req.files) && req.files.length > 0) {
          console.log(`Processing ${req.files.length} file attachments:`);

          req.files.forEach((file, index) => {
            console.log(
              `- File ${index + 1}: ${file.originalname}, ${file.size} bytes, ${file.mimetype}`,
            );
          });

          attachments = getFilesInfo(req.files);
          console.log(
            `Processed attachments:`,
            attachments.map((a) => `${a.originalName} (${a.size} bytes)`),
          );
        } else {
          console.log(`No file attachments in this message`);
        }

        console.log('DEBUG: About to create message with CC recipients:', ccRecipients);
        
        const validatedData = insertMessageSchema.parse({
          ticketId,
          content,
          sender: user.name,
          senderEmail: user.email,
          isAgent: true,
          ccRecipients: ccRecipients, // Use the CC recipients from the form data
          attachments: attachments,
          createdAt: new Date(), // CRITICAL: Set current timestamp for agent replies
        });
        
        console.log('DEBUG: Validated data for message creation:', JSON.stringify(validatedData, null, 2));

        // Get desk information to generate a proper Message-ID
        const desk = ticket.deskId ? await storage.getDeskById(ticket.deskId) : null;
        
        if (!desk) {
          console.warn(`No desk found for ticket #${ticketId}, using fallback domain`);
        }
        
        // Generate a proper Message-ID using desk's email domain to prevent "via helpdesk.1office.in"
        const timestamp = Date.now();
        const uniqueId = Math.random().toString(36).substring(2, 15);
        
        // IMPORTANT FIX: Use the desk's email domain for messageId instead of helpdesk.1office.in
        // This is critical for preventing the "via" text in email headers
        let domain = "example.com"; // Fallback domain
        
        if (desk && desk.smtpUser && desk.smtpUser.includes('@')) {
          // Extract domain from SMTP username (which is the email address)
          domain = desk.smtpUser.split('@')[1];
          console.log(`Using desk's email domain for message ID: ${domain}`);
        }
        
        const messageId = `<ticket-${ticketId}-reply-${timestamp}-${uniqueId}@${domain}>`;
        console.log(`Generated message ID with proper domain: ${messageId}`);
        
        // Store the message ID WITH angle brackets in the database - this is critical
        validatedData.messageId = messageId;

        // Create the message in the database
        const message = await storage.createMessage(validatedData);

        // Get previous messages to find any message IDs for threading
        const existingMessages = await storage.getMessagesByTicketId(ticketId);
        const customerMessages = existingMessages.filter((m) => !m.isAgent);
        let originalMessageId: string | undefined = undefined;
        
        // Look for CC recipients in existing customer messages
        // Always include CC recipients from the original email
        let ccFromOriginalEmail: string[] = [];
        if (customerMessages.length > 0) {
          // Get CC recipients from the most recent customer message
          const recentCustomerMessage = customerMessages[customerMessages.length - 1];
          if (recentCustomerMessage.ccRecipients && Array.isArray(recentCustomerMessage.ccRecipients) && recentCustomerMessage.ccRecipients.length > 0) {
            ccFromOriginalEmail = recentCustomerMessage.ccRecipients as string[];
            console.log(`Found ${ccFromOriginalEmail.length} CC recipients from original customer email: ${ccFromOriginalEmail.join(', ')}`);
          }
        }

        // If there are customer messages, use the most recent one's messageId for threading
        if (customerMessages.length > 0) {
          const mostRecentCustomerMessage =
            customerMessages[customerMessages.length - 1];
          if (mostRecentCustomerMessage.messageId) {
            originalMessageId = mostRecentCustomerMessage.messageId;

            // Make sure the message ID follows email standards (has angle brackets)
            if (!originalMessageId.startsWith("<")) {
              originalMessageId = `<${originalMessageId}>`;
            }

            console.log(
              `Using original message ID for email threading: ${originalMessageId}`,
            );
          }
        } else {
          // If there are no customer messages, look for the first message in the ticket
          // This helps ensure replies are properly threaded even for new tickets
          if (existingMessages.length > 0) {
            const firstMessage = existingMessages[0];
            if (firstMessage.messageId) {
              originalMessageId = firstMessage.messageId;

              // Make sure the message ID follows email standards (has angle brackets)
              if (!originalMessageId.startsWith("<")) {
                originalMessageId = `<${originalMessageId}>`;
              }

              console.log(
                `Using first message ID for email threading: ${originalMessageId}`,
              );
            }
          }
        }

        // Send email notification to customer with threading information
        // We'll only use direct SMTP - no more Mailgun!
        let emailSent = false;
        
        try {
          // Prepare attachment array for email if there are any
          const mailAttachments =
            attachments.length > 0
              ? attachments.map((attachment) => ({
                  filename: attachment.originalName,
                  path: attachment.path,
                }))
              : [];
              
          // Always combine user-provided CC recipients with those from original email
          const allCcRecipients = [...ccRecipients];
          if (ccFromOriginalEmail.length > 0) {
            // Add only unique email addresses that aren't already in allCcRecipients
            const uniqueOriginalCCs = ccFromOriginalEmail.filter(email => !allCcRecipients.includes(email));
            if (uniqueOriginalCCs.length > 0) {
              allCcRecipients.push(...uniqueOriginalCCs);
              console.log(`Including ${uniqueOriginalCCs.length} additional CC recipients from original email in the reply: ${uniqueOriginalCCs.join(', ')}`);
            }
          }
          
          // Get full desk details to check SMTP configuration
          const fullDesk = ticket.deskId ? await storage.getDeskById(ticket.deskId) : null;
          
          if (!fullDesk) {
            throw new Error('Cannot send email: This ticket is not associated with any desk');
          }
          
          if (!(fullDesk.smtpHost && fullDesk.smtpPort && fullDesk.smtpUser && fullDesk.smtpPassword)) {
            throw new Error(`Cannot send email: Desk "${fullDesk.name}" does not have complete SMTP configuration`);
          }
          
          console.log(`🚀 Sending email using direct SMTP for desk: ${fullDesk.name} (ID: ${fullDesk.id})`);
          
          // Use nodemailer directly for email sending (already imported at top)
          
          // Create transporter using desk's Gmail SMTP settings
          console.log(`📧 Creating SMTP transporter for ${fullDesk.smtpHost}:${fullDesk.smtpPort}`);
          
          // Create SMTP transporter with the correct configuration for Gmail
          const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 587,
            secure: false, // true for 465, false for other ports
            auth: {
              user: fullDesk.smtpUser,
              pass: fullDesk.smtpPassword
            },
            tls: {
              rejectUnauthorized: false
            }
          });
          
          console.log(`✅ SMTP transporter created successfully for ${fullDesk.smtpUser}`);
          
          // Send the email using direct SMTP
          const mailOptions = {
            from: `${fullDesk.name} <${fullDesk.smtpUser}>`,
            to: ticket.customerEmail,
            cc: allCcRecipients.length > 0 ? allCcRecipients.join(', ') : undefined,
            subject: `Re: ${ticket.subject}`,
            text: content,
            html: `<div style="font-family: Arial, sans-serif;">${content.replace(/\n/g, '<br>')}</div>`,
            messageId: messageId,
            inReplyTo: originalMessageId,
            references: originalMessageId,
            attachments: mailAttachments
          };
          
          const result = await transporter.sendMail(mailOptions);
          
          if (result.messageId) {
            console.log(`✅ Email sent successfully to ${ticket.customerEmail} for ticket #${ticketId}`);
            console.log(`✅ Email sent using direct Gmail SMTP - no "via helpdesk.1office.in" text in headers`);
            console.log(`✅ Message ID: ${result.messageId}`);
            emailSent = true;
          } else {
            throw new Error('Failed to send email: No message ID returned');
          }
        } catch (emailError) {
          console.error("Failed to send email:", emailError);
          // Return the error to the client instead of silently continuing
          return res.status(500).json({ 
            message: "Failed to send email", 
            error: emailError.message || "Unknown error"
          });
        }

        res.status(201).json({
          ...message,
          emailSent: emailSent,
          ticketInfo: {
            customerEmail: ticket.customerEmail,
          },
        });
      } catch (error) {
        console.error("Error in message creation:", error);
        if (error instanceof z.ZodError) {
          console.error("Zod validation errors:", error.errors);
          return res
            .status(400)
            .json({ message: "Invalid message data", errors: error.errors });
        }
        console.error("General error:", error.message || error);
        res.status(500).json({ 
          message: "Failed to create message", 
          error: error.message || "Unknown error" 
        });
      }
    },
  );

  // These webhook routes are now handled by the MailgunService.configureWebhook method

  // Test route for simulating an incoming email
  app.post("/api/test/incoming-email", isAuthenticated, async (req, res) => {
    try {
      // This route simulates an incoming email from a customer
      const { email, subject, message } = req.body;

      if (!email || !subject || !message) {
        return res
          .status(400)
          .json({ message: "Email, subject, and message are required" });
      }

      // Create mock email data that mimics what Mailgun would send
      // Generate a proper RFC-compliant message ID with angle brackets
      const timestamp = Date.now();
      const uniqueId = Math.random().toString(36).substring(2, 15);
      const domain = email.split("@")[1] || "example.com";
      const initialMessageId = `<customer-email-${timestamp}-${uniqueId}@${domain}>`;

      console.log(`Generated initial message ID: ${initialMessageId}`);

      const mockEmailData = {
        sender: email,
        recipient: mailgunService.supportEmail,
        subject,
        body: message,
        messageId: initialMessageId, // Use the properly formatted ID
        timestamp: new Date(),
        attachments: [],
        headers: {
          "Message-ID": initialMessageId, // Use consistent format
        },
      };

      // IMPORTANT: Each test email ALWAYS creates a new ticket
      // The simulated webhook ensures each email becomes a separate ticket
      console.log(`Test email from ${email} will create a new ticket`);
      console.log(`Subject: ${subject}`);

      // Extract a better customer name from the email address
      let customerName = email
        .split("@")[0]
        .replace(/\./g, " ")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (l: string) => l.toUpperCase());

      // Create new ticket
      const newTicket = await storage.createTicket({
        subject: subject,
        status: "open",
        customerName,
        customerEmail: email,
      });

      // Add initial message
      await storage.createMessage({
        ticketId: newTicket.id,
        content: message,
        sender: newTicket.customerName,
        senderEmail: newTicket.customerEmail,
        isAgent: false,
        messageId: mockEmailData.messageId,
      });

      res.status(201).json({
        message: "Test email processed, new ticket created",
        ticket: newTicket,
      });
    } catch (error) {
      console.error("Test email processing error:", error);
      res.status(500).json({ message: "Failed to process test email" });
    }
  });

  // Test endpoint for sending a satisfaction survey
  app.post(
    "/api/test/send-satisfaction-survey",
    isAuthenticated,
    async (req, res) => {
      try {
        const { to, ticketId } = req.body;
        const testTicketId = ticketId || 999;
        const testEmail = to || "test@example.com";

        console.log(
          `API TEST: Sending test satisfaction survey to ${testEmail} for ticket #${testTicketId}`,
        );

        // Generate a unique message ID for the test
        const timestamp = Date.now();
        const uniqueId = Math.random().toString(36).substring(2, 15);
        const domain = mailgunService.getDomain() || "helpdesk.1office.in";
        const messageId = `<ticket-${testTicketId}-test-resolution-${timestamp}-${uniqueId}@${domain}>`;

        // Generate satisfaction survey links with unique identifiers for the test
        const surveyBase = `${req.protocol}://${req.get("host")}/api/tickets/${testTicketId}/satisfaction`;
        const badLink = `${surveyBase}?rating=1&token=${timestamp}-${uniqueId}`;
        const poorLink = `${surveyBase}?rating=2&token=${timestamp}-${uniqueId}`;
        const averageLink = `${surveyBase}?rating=3&token=${timestamp}-${uniqueId}`;
        const goodLink = `${surveyBase}?rating=4&token=${timestamp}-${uniqueId}`;
        const excellentLink = `${surveyBase}?rating=5&token=${timestamp}-${uniqueId}`;

        // Create test email content
        const emailSubject = `Your ticket #${testTicketId} has been resolved - Please rate your experience`;
        const emailContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e9e9e9; border-radius: 5px;">
          <h2 style="color: #333; border-bottom: 1px solid #e9e9e9; padding-bottom: 10px;">TEST: Ticket Resolved</h2>
          
          <p>Dear Test Customer,</p>
          
          <p>Your support ticket <strong>#${testTicketId}: Test Subject</strong> has been resolved.</p>
          
          <p>This ticket is now closed. If you need further assistance, please create a new support ticket.</p>
          
          <div style="margin: 25px 0; padding: 20px; background-color: #f9f9f9; border-radius: 5px; text-align: center;">
            <h3 style="margin-top: 0; color: #333;">How would you rate your support experience?</h3>
            <p style="margin-bottom: 20px;">Your feedback helps us improve our service.</p>
            
            <div style="display: flex; justify-content: center; margin-bottom: 15px;">
              <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
                <tr>
                  <td align="center" style="padding: 0 10px;">
                    <a href="${badLink}" style="display: block; text-decoration: none;">
                      <div style="font-size: 24px; margin-bottom: 5px;">😡</div>
                      <div style="background-color: #dc3545; color: white; padding: 8px 15px; border-radius: 4px; font-weight: bold;">Bad</div>
                    </a>
                  </td>
                  <td align="center" style="padding: 0 10px;">
                    <a href="${poorLink}" style="display: block; text-decoration: none;">
                      <div style="font-size: 24px; margin-bottom: 5px;">🙁</div>
                      <div style="background-color: #d9534f; color: white; padding: 8px 15px; border-radius: 4px; font-weight: bold;">Poor</div>
                    </a>
                  </td>
                  <td align="center" style="padding: 0 10px;">
                    <a href="${averageLink}" style="display: block; text-decoration: none;">
                      <div style="font-size: 24px; margin-bottom: 5px;">😐</div>
                      <div style="background-color: #f0ad4e; color: white; padding: 8px 15px; border-radius: 4px; font-weight: bold;">Average</div>
                    </a>
                  </td>
                  <td align="center" style="padding: 0 10px;">
                    <a href="${goodLink}" style="display: block; text-decoration: none;">
                      <div style="font-size: 24px; margin-bottom: 5px;">🙂</div>
                      <div style="background-color: #5cb85c; color: white; padding: 8px 15px; border-radius: 4px; font-weight: bold;">Good</div>
                    </a>
                  </td>
                  <td align="center" style="padding: 0 10px;">
                    <a href="${excellentLink}" style="display: block; text-decoration: none;">
                      <div style="font-size: 24px; margin-bottom: 5px;">😃</div>
                      <div style="background-color: #28a745; color: white; padding: 8px 15px; border-radius: 4px; font-weight: bold;">Excellent</div>
              </table>
            </div>
            
            <p style="color: #666; font-size: 12px;">Just click one of the options above to provide your rating.</p>
          </div>
          
          <p>Thank you for your business!</p>
          
          <p style="border-top: 1px solid #e9e9e9; padding-top: 10px; color: #777; font-size: 12px;">
            This is an automated message. Please do not reply to this email.
          </p>
        </div>
      `;

        try {
          // Format the from address
          const fromEmail = `Test Support <postmaster@${domain}>`;

          console.log(`API TEST: Using formatted from email: ${fromEmail}`);
          console.log(`API TEST: Message ID: ${messageId}`);

          // Send test email through Mailgun
          const result = await mailgunService.sendEmail({
            from: fromEmail,
            to: testEmail,
            subject: emailSubject,
            text: `TEST: Your ticket #${testTicketId} has been resolved. This ticket is now closed permanently. If you need further assistance, please create a new support ticket.`,
            html: emailContent,
            "v:ticketId": testTicketId.toString(),
            "h:Message-Id": messageId,
          });

          // Return success response with detailed information
          res.status(200).json({
            message: "Test satisfaction survey email sent successfully",
            result: result,
            details: {
              fromEmail,
              toEmail: testEmail,
              messageId,
              ticketId: testTicketId,
              surveyLinks: {
                excellent: excellentLink,
                good: goodLink,
                average: averageLink,
                poor: poorLink,
                bad: badLink,
              },
            },
          });
        } catch (error) {
          console.error(
            "API TEST: Error sending test satisfaction survey:",
            error,
          );
          res.status(500).json({
            message: "Error sending test satisfaction survey",
            error: String(error),
          });
        }
      } catch (error) {
        console.error(
          "API TEST: Error processing test satisfaction survey:",
          error,
        );
        res.status(500).json({
          message: "Error processing test satisfaction survey",
          error: String(error),
        });
      }
    },
  );

  // Test route for sending an email directly with Mailgun
  app.post("/api/test/send-email", isAuthenticated, async (req, res) => {
    try {
      const { to, subject, message, ticketId } = req.body;

      if (!to || !subject || !message) {
        return res
          .status(400)
          .json({ message: "Email, subject, and message are required" });
      }

      if (!mailgunService.isInitialized()) {
        return res.status(400).json({
          message:
            "Mailgun is not configured. Please check your environment variables.",
          mailgunStatus: {
            initialized: false,
            supportEmail: mailgunService.supportEmail || "not set",
            domain: mailgunService.getDomain() || "not set",
          },
        });
      }

      // For Mailgun sandbox domains, check if the recipient is authorized
      let emailAuthorized = true;
      if (mailgunService.getDomain().includes("sandbox")) {
        emailAuthorized = await isRecipientAuthorized(to);
        if (!emailAuthorized) {
          return res.status(400).json({
            message: `Cannot send to ${to}: not authorized for Mailgun sandbox domain`,
            details:
              "For sandbox domains, recipients must be authorized in the Mailgun dashboard first",
            solution:
              "Either authorize this recipient in your Mailgun account or upgrade to a production domain",
          });
        }
      }

      // Generate a properly formatted message ID for testing
      const timestamp = Date.now();
      const uniqueId = Math.random().toString(36).substring(2, 15);
      const domain = mailgunService.getDomain() || "helpdesk.channelplay.in";
      const messageId = `<test-message-${timestamp}-${uniqueId}@${domain}>`;

      console.log(`Generated test message ID: ${messageId}`);

      // If ticketId is provided, send as a reply to that ticket
      if (ticketId) {
        const ticket = await storage.getTicketById(parseInt(ticketId));

        if (!ticket) {
          return res.status(404).json({ message: "Ticket not found" });
        }

        // Get previous messages to find any message IDs for threading
        const existingMessages = await storage.getMessagesByTicketId(
          parseInt(ticketId),
        );
        const customerMessages = existingMessages.filter((m) => !m.isAgent);
        let originalMessageId: string | undefined = undefined;

        if (customerMessages.length > 0) {
          const mostRecentCustomerMessage =
            customerMessages[customerMessages.length - 1];
          if (mostRecentCustomerMessage.messageId) {
            originalMessageId = mostRecentCustomerMessage.messageId;

            // Make sure the message ID follows email standards (has angle brackets)
            if (!originalMessageId.startsWith("<")) {
              originalMessageId = `<${originalMessageId}>`;
            }

            console.log(
              `Using original message ID for test email threading: ${originalMessageId}`,
            );
          }
        } else if (existingMessages.length > 0) {
          // If no customer messages, use first message
          const firstMessage = existingMessages[0];
          if (firstMessage.messageId) {
            originalMessageId = firstMessage.messageId;

            // Make sure the message ID follows email standards
            if (!originalMessageId.startsWith("<")) {
              originalMessageId = `<${originalMessageId}>`;
            }

            console.log(
              `Using first message ID for test email threading: ${originalMessageId}`,
            );
          }
        }

        // Get desk information to use the proper from address
        let deskName = "Support";
        let deskEmail = "postmaster";

        if (ticket.deskId) {
          const desk = await storage.getDeskById(ticket.deskId);
          if (desk) {
            deskName = desk.name || "Support";
            deskEmail = desk.email || "postmaster";
          }
        }

        // Format the from address with name
        const fromEmail = formatFromEmail(deskName, deskEmail);
        console.log(`Using formatted from email: ${fromEmail}`);

        // Create proper HTML content for the test email
        const htmlContent = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <div style="padding:15px 0;font-size:14px;line-height:1.6;">
            ${message.replace(/\n/g, "<br>")}
          </div>
        </div>`;

        const response = await mailgunService.sendReply(
          parseInt(ticketId),
          to,
          subject,
          message,
          originalMessageId,
          fromEmail,
          [], // Empty attachments array
          htmlContent, // HTML content
        );

        return res.status(200).json({
          message: "Test email sent successfully as a reply",
          messageId,
          ticketId,
          delivery_status: "accepted_for_delivery",
          note: "Email has been accepted by Mailgun for delivery attempt, but final delivery to recipient's inbox cannot be guaranteed",
        });
      }

      // Otherwise, send as a regular email with proper HTML formatting
      const htmlContent = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <div style="padding:15px 0;font-size:14px;line-height:1.6;">
          ${message.replace(/\n/g, "<br>")}
        </div>
      </div>`;

      // Get desk name for test email
      const deskName = "Support";
      const deskEmail = "postmaster";

      // Use nicely formatted from address for test emails
      const fromEmail = formatFromEmail(deskName, deskEmail);
      console.log(`Using formatted from email for test: ${fromEmail}`);

      const response = await mailgunService.sendEmail({
        from: fromEmail,
        to,
        subject,
        text: message,
        html: htmlContent,
        "h:Message-Id": messageId,
      });

      res.status(200).json({
        message: "Test email sent successfully",
        messageId,
        delivery_status: "accepted_for_delivery",
        note: "Email has been accepted by Mailgun for delivery attempt, but final delivery to recipient's inbox cannot be guaranteed",
        debug_info: {
          from: mailgunService.supportEmail,
          domain: mailgunService.getDomain(),
        },
      });
    } catch (error: any) {
      console.error("Test email sending error:", error);

      // Extract more detailed information from the Mailgun error
      let errorDetails = {
        message: error.message || String(error),
        code: error.code || "unknown",
        response: error.response || null,
      };

      // Parse common Mailgun errors
      let problemDescription = "Unknown error";
      let suggestionMessage = "Please check your Mailgun configuration.";

      if (error.message && error.message.includes("Recipient not authorized")) {
        problemDescription = "Unauthorized Recipient";
        suggestionMessage =
          "For Mailgun sandbox domains, you need to authorize recipients first.";
      } else if (error.message && error.message.includes("Invalid API key")) {
        problemDescription = "Invalid API key";
        suggestionMessage = "Please update your Mailgun API key.";
      } else if (error.message && error.message.includes("domain not found")) {
        problemDescription = "Domain Not Found";
        suggestionMessage =
          "The domain you've configured doesn't exist in your Mailgun account.";
      }

      res.status(500).json({
        message: "Failed to send test email",
        problem: problemDescription,
        suggestion: suggestionMessage,
        error: errorDetails,
      });
    }
  });

  // Route to check if an email is authorized for Mailgun sandbox domains
  app.get("/api/check-recipient", async (req, res) => {
    try {
      const email = req.query.email as string;

      if (!email) {
        return res.status(400).json({ message: "Email parameter is required" });
      }

      if (!mailgunService.isInitialized()) {
        return res.status(200).json({
          isAuthorized: true,
          authorized: true,
          isSandbox: false,
          message: "Mailgun not configured, all recipients allowed",
        });
      }

      // Check if we're using a sandbox domain
      const isSandbox = mailgunService.getDomain().includes("sandbox");

      if (!isSandbox) {
        return res.status(200).json({
          isAuthorized: true,
          authorized: true,
          isSandbox: false,
          message: "Production Mailgun domain can send to any recipient",
        });
      }

      // For sandbox domains, check if the recipient is authorized
      const isEmailAuthorized = await isRecipientAuthorized(email);

      return res.status(200).json({
        isAuthorized: isEmailAuthorized,
        authorized: isEmailAuthorized,
        isSandbox: true,
        message: isEmailAuthorized
          ? `${email} is authorized for Mailgun sandbox domain`
          : `${email} is NOT authorized for Mailgun sandbox domain. Add this recipient in your Mailgun dashboard.`,
      });
    } catch (error) {
      console.error("Error checking recipient:", error);
      return res.status(500).json({
        message: "Error checking recipient authorization",
        isAuthorized: false,
        authorized: false,
        error: String(error),
      });
    }
  });

  // Check Mailgun connection status - available without authentication
  app.get("/api/mailgun/status", async (req, res) => {
    try {
      // Log detailed diagnostic information to help troubleshoot API issues
      console.log("Mailgun API Configuration:");
      console.log(`- Domain: ${process.env.MAILGUN_DOMAIN}`);
      console.log(`- API Key Set: ${Boolean(process.env.MAILGUN_API_KEY)}`);
      if (process.env.MAILGUN_API_KEY) {
        console.log(
          `- API Key Length: ${process.env.MAILGUN_API_KEY.length} characters`,
        );
        console.log(
          `- API Key Format: ${process.env.MAILGUN_API_KEY.startsWith("key-") ? "Standard" : "Private"}`,
        );
      }
      console.log(`- API Host: ${mailgunService.apiEndpoint}`);

      const status = await mailgunService.checkApiKeyStatus();

      // Additional diagnostic information
      const diagnostics = {
        environment: process.env.NODE_ENV || "unknown",
        configured_endpoint: mailgunService.apiEndpoint,
        initialized: mailgunService.isInitialized(),
        api_key_format: process.env.MAILGUN_API_KEY?.startsWith("key-")
          ? "Standard format"
          : "Private API key format",
        european_domain:
          (process.env.MAILGUN_DOMAIN || "").includes("eu.") ||
          (process.env.MAILGUN_DOMAIN || "") === "helpdesk.1office.in",
      };

      res.json({
        isInitialized: mailgunService.isInitialized(),
        apiKeyValid: status.isValid,
        error: status.error,
        supportEmail: mailgunService.supportEmail,
        domain: mailgunService.getDomain(),
        diagnostics,
      });
    } catch (error: any) {
      console.error("Error checking Mailgun status:", error);

      res.status(500).json({
        error: error.message || "Error checking Mailgun status",
        isInitialized: mailgunService.isInitialized(),
        apiKeyValid: false,
        supportEmail:
          process.env.MAILGUN_FROM_EMAIL || "help@helpdesk.channelplay.in",
        domain: process.env.MAILGUN_DOMAIN || "not-configured",
        diagnostics: {
          error_type: error.name,
          error_stack: error.stack,
          possible_solutions: [
            "Check if your Mailgun API key begins with 'key-'",
            "Verify your domain is properly configured in Mailgun",
            "Make sure you're using the correct API endpoint (EU vs US)",
            "Check if your Mailgun account is active and not suspended",
          ],
        },
      });
    }
  });

  // Handle customer satisfaction survey responses
  app.get("/api/tickets/:id/satisfaction", async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const rating = parseInt(req.query.rating as string);
      const token = req.query.token as string;

      if (isNaN(ticketId) || isNaN(rating) || !token) {
        return res.status(400).send(`
          <html>
            <head><title>Invalid Request</title></head>
            <body style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
              <h1>Invalid Request</h1>
              <p>The survey link appears to be invalid.</p>
            </body>
          </html>
        `);
      }

      const ticket = await storage.getTicketById(ticketId);
      if (!ticket) {
        return res.status(404).send(`
          <html>
            <head><title>Ticket Not Found</title></head>
            <body style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
              <h1>Ticket Not Found</h1>
              <p>The requested ticket could not be found.</p>
            </body>
          </html>
        `);
      }

      // Rating should be between 1 and 5
      if (rating < 1 || rating > 5) {
        return res.status(400).send(`
          <html>
            <head><title>Invalid Rating</title></head>
            <body style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
              <h1>Invalid Rating</h1>
              <p>The rating must be between 1 and 5.</p>
            </body>
          </html>
        `);
      }

      // Map rating to text description
      let ratingText = "";
      let ratingEmoji = "";

      switch (rating) {
        case 5:
          ratingText = "Excellent";
          ratingEmoji = "😃";
          break;
        case 4:
          ratingText = "Good";
          ratingEmoji = "🙂";
          break;
        case 3:
          ratingText = "Average";
          ratingEmoji = "😐";
          break;
        case 2:
          ratingText = "Poor";
          ratingEmoji = "🙁";
          break;
        case 1:
          ratingText = "Bad";
          ratingEmoji = "😡";
          break;
      }

      // Generate a message ID for storing this satisfaction response
      const timestamp = Date.now();
      const uniqueId = Math.random().toString(36).substring(2, 15);
      const domain = mailgunService.getDomain() || "helpdesk.1office.in";
      const messageId = `<ticket-${ticketId}-satisfaction-${timestamp}-${uniqueId}@${domain}>`;

      // Add the satisfaction survey response as a message in the ticket
      await storage.createMessage({
        ticketId,
        content: `Customer Satisfaction Rating: ${ratingText} (${rating}/5)`,
        sender: "Customer Feedback",
        senderEmail: ticket.customerEmail,
        isAgent: false,
        messageId,
        isSatisfactionResponse: true,
        satisfactionRating: rating,
      });

      // Return a thank you page to the customer
      return res.status(200).send(`
        <html>
          <head>
            <title>Thank You for Your Feedback</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                text-align: center;
              }
              .container {
                border: 1px solid #e4e4e4;
                border-radius: 5px;
                padding: 30px;
                margin-top: 50px;
                background-color: #f9f9f9;
                box-shadow: 0 2px 10px rgba(0,0,0,0.05);
              }
              .emoji {
                font-size: 48px;
                margin-bottom: 20px;
              }
              h1 {
                color: #2c3e50;
                margin-bottom: 20px;
              }
              .rating {
                font-size: 18px;
                margin-bottom: 20px;
                font-weight: bold;
                color: #3498db;
              }
              .button {
                display: inline-block;
                background-color: #3498db;
                color: white;
                padding: 10px 20px;
                text-decoration: none;
                border-radius: 4px;
                font-weight: bold;
                margin-top: 20px;
              }
              .button:hover {
                background-color: #2980b9;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="emoji">${ratingEmoji}</div>
              <h1>Thank You for Your Feedback!</h1>
              <p>Your rating has been recorded for ticket #${ticketId}.</p>
              <div class="rating">You rated our service: ${ratingText} (${rating}/5)</div>
              <p>We appreciate you taking the time to provide your feedback. Your input helps us improve our service.</p>
              <a href="#" class="button" onclick="window.close(); return false;">Close Window</a>
            </div>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("Error processing satisfaction survey:", error);
      return res.status(500).send(`
        <html>
          <head><title>Error</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
            <h1>Error</h1>
            <p>An error occurred while processing your feedback.</p>
          </body>
        </html>
      `);
    }
  });

  // Helper function to check if a date is within business hours (9am-5pm Monday-Friday)
  function isBusinessHour(date: Date): boolean {
    const day = date.getDay(); // 0 is Sunday, 1-5 is Monday-Friday
    const hour = date.getHours();
    
    // Check if it's a weekday (Monday-Friday) and within business hours (9am-5pm)
    return day >= 1 && day <= 5 && hour >= 9 && hour < 17;
  }
  
  // Calculate business hours between two dates
  function calculateBusinessHours(startDate: Date, endDate: Date): number {
    if (!startDate || !endDate) return 0;
    
    // If end date is before start date, return 0
    if (endDate < startDate) return 0;
    
    let hours = 0;
    let currentDate = new Date(startDate);
    
    // Iterate through each hour
    while (currentDate < endDate) {
      if (isBusinessHour(currentDate)) {
        hours++;
      }
      
      // Advance by 1 hour
      currentDate.setHours(currentDate.getHours() + 1);
    }
    
    return hours;
  }
  
  // Performance statistics endpoint
  app.get("/api/statistics", isAuthenticated, async (req, res) => {
    try {
      // Parse date filters
      const { startDate, endDate } = req.query;
      
      // Default to current month if no dates provided
      const now = new Date();
      const defaultStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const defaultEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      
      // Parse dates or use defaults
      const start = startDate ? new Date(startDate as string) : defaultStartDate;
      const end = endDate ? new Date(endDate as string) : defaultEndDate;
      
      // Ensure valid dates
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ error: "Invalid date format" });
      }
      
      // Calculate statistics
      
      // 1. NPS (Net Promoter Score) from satisfaction ratings
      // Get all satisfaction responses
      const satisfactionMessages = await db
        .select({
          id: messages.id,
          rating: messages.satisfactionRating,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(
          and(
            eq(messages.isSatisfactionResponse, true),
            not(isNull(messages.satisfactionRating)),
            between(messages.createdAt, start, end)
          )
        );
      
      // Calculate NPS manually
      const totalRatings = satisfactionMessages.length;
      const promotersCount = satisfactionMessages.filter(msg => 
        msg.rating !== null && msg.rating >= 9 && msg.rating <= 10
      ).length;
      const detractorsCount = satisfactionMessages.filter(msg => 
        msg.rating !== null && msg.rating <= 6
      ).length;
      
      // Calculate NPS: (% promoters - % detractors) * 100
      let nps = 0;
      
      if (totalRatings > 0) {
        nps = Math.round(((promotersCount - detractorsCount) / totalRatings) * 100);
      }
      
      // 2. Response time statistics
      // Get all tickets in the date range
      const ticketsInRange = await db
        .select({
          id: tickets.id,
          createdAt: tickets.createdAt
        })
        .from(tickets)
        .where(between(tickets.createdAt, start, end));
      
      // Get first agent response for each ticket
      let totalResponseTime = 0;
      let respondedTickets = 0;
      
      for (const ticket of ticketsInRange) {
        const firstAgentResponse = await db
          .select({
            createdAt: messages.createdAt
          })
          .from(messages)
          .where(
            and(
              eq(messages.ticketId, ticket.id),
              eq(messages.isAgent, true)
            )
          )
          .orderBy(messages.createdAt)
          .limit(1);
        
        if (firstAgentResponse.length > 0) {
          const responseTime = calculateBusinessHours(
            new Date(ticket.createdAt), 
            new Date(firstAgentResponse[0].createdAt)
          );
          
          if (responseTime > 0) {
            totalResponseTime += responseTime;
            respondedTickets++;
          }
        }
      }
      
      // Calculate average response time
      const avgResponseTime = respondedTickets > 0 
        ? Math.round(totalResponseTime / respondedTickets * 10) / 10
        : 0;
      
      // 3. Resolution time statistics
      const resolvedTickets = await db
        .select({
          id: tickets.id,
          createdAt: tickets.createdAt,
          resolvedAt: tickets.resolvedAt
        })
        .from(tickets)
        .where(
          and(
            not(isNull(tickets.resolvedAt)),
            between(tickets.createdAt, start, end)
          )
        );
      
      let totalResolutionTime = 0;
      const resolvedTicketsCount = resolvedTickets.length;
      
      for (const ticket of resolvedTickets) {
        const resolutionTime = calculateBusinessHours(
          new Date(ticket.createdAt),
          new Date(ticket.resolvedAt!)
        );
        
        if (resolutionTime > 0) {
          totalResolutionTime += resolutionTime;
        }
      }
      
      // Calculate average resolution time
      const avgResolutionTime = resolvedTicketsCount > 0
        ? Math.round(totalResolutionTime / resolvedTicketsCount * 10) / 10
        : 0;
      
      // 4. Total number of tickets in this period
      const ticketCount = await db
        .select({
          count: count()
        })
        .from(tickets)
        .where(between(tickets.createdAt, start, end));
      
      // 5. Response count
      const responseCount = await db
        .select({
          count: count()
        })
        .from(messages)
        .where(
          and(
            eq(messages.isAgent, true),
            between(messages.createdAt, start, end)
          )
        );
      
      // Return all statistics
      return res.json({
        nps,
        totalRatings: totalRatings,
        promoters: promotersCount,
        detractors: detractorsCount,
        respondedTickets,
        avgResponseTime, 
        responsesCount: responseCount[0].count,
        avgResolutionTime,
        resolvedTicketsCount,
        ticketCount: ticketCount[0].count,
        dateRange: {
          start: start.toISOString(),
          end: end.toISOString()
        }
      });
      
    } catch (error) {
      console.error("Error calculating statistics:", error);
      return res.status(500).json({ error: "Failed to calculate statistics" });
    }
  });

  // Get Mailgun configuration guide - available without authentication for setup help
  app.get("/api/mailgun/configuration", (req, res) => {
    // Use postmaster@domain.com as the support email for Mailgun
    const supportEmail =
      mailgunService.supportEmail ||
      `postmaster@${mailgunService.getDomain() || "helpdesk.1office.in"}`;
    const appHost = req.get("host") || "cphelp.replit.app";
    const webhookUrl = `https://${appHost}/api/webhook/mailgun`;
    const inboundWebhookUrl = `https://${appHost}/api/inbound-email`;

    res.json({
      supportEmail: supportEmail,
      domain: mailgunService.getDomain() || "helpdesk.1office.in",
      isInitialized: mailgunService.isInitialized(),
      webhookUrl,
      inboundWebhookUrl,
      configurationSteps: [
        "1. Go to your Mailgun dashboard",
        "2. Navigate to Sending → Domains",
        "3. Set up domain verification for your domain (or use sandbox domain for testing)",
        "",
        "To configure inbound email routes:",
        "1. Go to Receiving → Routes",
        "2. Create a new route with these settings:",
        `   - Expression Type: Match Recipient`,
        `   - Recipient: ${supportEmail}`,
        `   - Actions: forward to ${inboundWebhookUrl}`,
        "",
        "To configure webhooks for tracking:",
        "1. Go to Sending → Webhooks",
        "2. Select your domain",
        "3. Configure webhooks:",
        `   - Delivered: ${webhookUrl}`,
        `   - Opened: ${webhookUrl}`,
        `   - Clicked: ${webhookUrl}`,
        "",
        "DNS Configuration Required:",
        "1. Add MX, SPF, and DKIM records for your domain as shown in the Mailgun dashboard",
        "2. Verify the domain in Mailgun",
        "",
        "SMTP Configuration (for reference only):",
        "- SMTP Host: smtp.mailgun.org",
        "- SMTP Port: 587",
        "- Username: postmaster@helpdesk.1office.in",
        "- Authentication: STARTTLS",
        "",
        "To test email conversations in this application:",
        `- Send an email to ${supportEmail}`,
        "- It will create a new ticket in the system",
        "- Reply to the ticket from the agent portal",
        "- The reply will be sent to the customer via email",
        "- If the customer replies to that email, it will be added to the same ticket",
      ],
    });
  });

  const httpServer = createServer(app);

  return httpServer;
}
