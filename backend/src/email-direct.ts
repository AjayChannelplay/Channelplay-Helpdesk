/**
 * Direct Email Sender Module
 * 
 * This file provides direct email sending capabilities using the desk's
 * configured SMTP settings, completely bypassing Mailgun.
 */

import { sendDirectEmail } from './smtp-helper';
import { storage } from './storage';

/**
 * Generate a proper Message-ID that won't show "via helpdesk.1office.in"
 * 
 * @param ticketId The ticket ID
 * @param type The type of message (new, reply, etc.)
 * @param domain The domain to use (should match the SMTP user domain)
 * @returns A properly formatted Message-ID
 */
export function generateMessageId(ticketId: number, type: string, domain: string): string {
  const timestamp = Date.now();
  const uniqueId = Math.random().toString(36).substring(2, 15);
  return `<ticket-${ticketId}-${type}-${timestamp}-${uniqueId}@${domain}>`;
}

/**
 * Send a new ticket confirmation email using the desk's configured SMTP settings
 * 
 * @param options Options for the email
 * @returns Success status and any error message
 */
export async function sendNewTicketEmailDirect({
  ticketId,
  subject,
  text,
  html,
  to,
  messageId,
  ccRecipients = []
}: {
  ticketId: number;
  subject: string;
  text: string;
  html?: string;
  to: string | string[];
  messageId?: string;
  ccRecipients?: string[];
}): Promise<{ success: boolean; error?: string; messageId?: string }> {
  try {
    console.log(`🚀 Sending direct email for new ticket #${ticketId}`);
    
    // Get the ticket to find the associated desk
    const ticket = await storage.getTicketById(ticketId);
    
    if (!ticket) {
      return { 
        success: false, 
        error: `Ticket #${ticketId} not found` 
      };
    }
    
    // Get the desk to use its SMTP configuration
    const deskId = ticket.deskId || 8; // Default to desk ID 8 if none set
    const desk = await storage.getDeskById(deskId);
    
    if (!desk) {
      return { 
        success: false, 
        error: `Desk ID ${deskId} not found` 
      };
    }
    
    // Verify SMTP is configured for this desk
    if (!desk.smtpHost || !desk.smtpPort || !desk.smtpUser || !desk.smtpPassword) {
      console.log(`❌ Desk ${desk.name} (ID: ${deskId}) does not have SMTP configured`);
      return {
        success: false,
        error: `SMTP not configured for desk: ${desk.name}`
      };
    }
    
    console.log(`✉️ Using SMTP configuration from desk: ${desk.name} (ID: ${deskId})`);
    
    // Format the from address correctly
    const fromName = desk.smtpFromName || desk.name;
    const fromEmail = desk.smtpUser; // Use the SMTP username which is the actual sender email
    
    // Check that fromEmail is set and valid
    if (!fromEmail || !fromEmail.includes('@')) {
      console.error(`❌ Invalid sender email: ${fromEmail}`);
      return {
        success: false,
        error: `Invalid sender email configuration for desk ${desk.name}`
      };
    }
    
    // Use an object with name and address properties for proper email formatting
    const fromObject = {
      name: fromName,
      address: fromEmail
    };
    
    // Create email headers for proper identification
    const headers: Record<string, string> = {};
    
    // Generate a message ID if not provided
    const domain = fromEmail.split('@')[1] || 'example.com';
    const actualMessageId = messageId || generateMessageId(ticketId, 'new', domain);
    
    // Add critical headers for email deliverability
    headers['Message-ID'] = actualMessageId;
    headers['X-Mailer'] = 'ChannelPlay Help Desk';
    headers['Precedence'] = 'bulk';
    headers['Auto-Submitted'] = 'auto-generated';
    headers['X-Auto-Response-Suppress'] = 'OOF, DR, RN, NRN, AutoReply';
    headers['Sender'] = fromEmail;
    
    console.log(`📋 Message-ID for new ticket: ${actualMessageId}`);
    
    // Prepare CC recipients if any
    const cc = ccRecipients?.length > 0 ? ccRecipients : undefined;
    
    // Send the email using direct SMTP
    const result = await sendDirectEmail({
      from: fromObject,
      to,
      cc,
      subject,
      text,
      html: html || text.replace(/\n/g, '<br>'),
      headers,
      attachments: [], // No attachments for automated confirmation emails
      smtpConfig: {
        host: desk.smtpHost,
        port: parseInt(desk.smtpPort || '587'),
        secure: desk.smtpSecure,
        auth: {
          user: desk.smtpUser,
          pass: desk.smtpPassword
        }
      }
    });
    
    console.log(`✅ New ticket email sent successfully, messageId: ${result.messageId}`);
    
    return {
      success: true,
      messageId: result.messageId || actualMessageId
    };
    
  } catch (error) {
    console.error('❌ Error sending new ticket email:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Send a ticket reply email using the desk's configured SMTP settings
 * 
 * @param options Options for the email
 * @returns Success status and any error message
 */
export async function sendTicketReplyDirect({
  ticketId,
  subject,
  text,
  html,
  to,
  cc,
  attachments,
  inReplyTo,
  references
}: {
  ticketId: number;
  subject: string;
  text: string;
  html?: string;
  to: string | string[];
  cc?: string | string[];
  attachments?: any[];
  inReplyTo?: string;
  references?: string;
}): Promise<{ success: boolean; error?: string; messageId?: string }> {
  try {
    console.log(`🚀 Sending direct email for ticket #${ticketId}`);
    
    // Get the ticket to find the associated desk
    const ticket = await storage.getTicketById(ticketId);
    
    if (!ticket) {
      return { 
        success: false, 
        error: `Ticket #${ticketId} not found` 
      };
    }
    
    // Get the desk to use its SMTP configuration
    const deskId = ticket.deskId || 8; // Default to desk ID 8 if none set
    const desk = await storage.getDeskById(deskId);
    
    if (!desk) {
      return { 
        success: false, 
        error: `Desk ID ${deskId} not found` 
      };
    }
    
    // Verify SMTP is configured for this desk
    if (!desk.smtpHost || !desk.smtpPort || !desk.smtpUser || !desk.smtpPassword) {
      console.log(`❌ Desk ${desk.name} (ID: ${deskId}) does not have SMTP configured`);
      return {
        success: false,
        error: `SMTP not configured for desk: ${desk.name}`
      };
    }
    
    console.log(`✉️ Using SMTP configuration from desk: ${desk.name} (ID: ${deskId})`);
    
    // Format the from address correctly - USING THE EXACT SAME FORMAT AS test-email-route.ts
    // This is critical for preventing the "via helpdesk.1office.in" text
    const fromName = desk.smtpFromName || desk.name;
    
    // CRITICAL FIX: SMTP username MUST be used as the sender email
    // This is the key to proper delivery and preventing "via helpdesk" text
    const fromEmail = desk.smtpUser; // Use the SMTP username which is the actual sender email
    
    // Check that fromEmail is set and valid, as this is critical for delivery
    if (!fromEmail || !fromEmail.includes('@')) {
      console.error(`❌ Invalid sender email: ${fromEmail}`);
      return {
        success: false,
        error: `Invalid sender email configuration for desk ${desk.name}`
      };
    }
    
    // Instead of string formatting, use an object with name and address properties
    // This exact format is what prevents the "via helpdesk.1office.in" text in emails
    const fromObject = {
      name: fromName,
      address: fromEmail
    };
    
    console.log(`📣 IMPORTANT: Using sender format that prevents "via helpdesk" text`);
    console.log(`📣 Sender Name: "${fromName}"`);
    console.log(`📣 Sender Email: ${fromEmail}`);
    console.log(`📣 This must match SMTP username: ${desk.smtpUser}`);
    
    console.log(`📧 From address: ${fromName} <${fromEmail}>`);
    
    // Create email headers for proper threading
    const headers: Record<string, string> = {};
    
    // CRITICAL FIX: For proper email threading, we need to handle In-Reply-To and References
    if (inReplyTo) {
      // Make sure In-Reply-To has proper angle brackets format
      const formattedInReplyTo = inReplyTo.startsWith('<') ? inReplyTo : `<${inReplyTo}>`;
      headers['In-Reply-To'] = formattedInReplyTo;
      console.log(`📋 Setting In-Reply-To header: ${formattedInReplyTo}`);
    }
    
    if (references) {
      // Format references properly - this is critical for threading in Gmail, Outlook etc.
      let formattedReferences = references;
      if (!references.startsWith('<')) {
        formattedReferences = `<${references}>`;
      }
      
      // If we have both inReplyTo and references, combine them for better threading
      if (inReplyTo && !formattedReferences.includes(inReplyTo)) {
        const formattedInReplyTo = inReplyTo.startsWith('<') ? inReplyTo : `<${inReplyTo}>`;
        formattedReferences = `${formattedReferences} ${formattedInReplyTo}`;
      }
      
      headers['References'] = formattedReferences;
      console.log(`📋 Setting References header: ${formattedReferences}`);
    } else if (inReplyTo) {
      // If we only have inReplyTo but no references, use inReplyTo as references too
      const formattedInReplyTo = inReplyTo.startsWith('<') ? inReplyTo : `<${inReplyTo}>`;
      headers['References'] = formattedInReplyTo;
      console.log(`📋 Setting References header from In-Reply-To: ${formattedInReplyTo}`);
    }
    
    // Add ticket identification in message ID
    const timestamp = Date.now();
    const uniqueId = Math.random().toString(36).substring(2, 15);
    
    // CRITICAL FIX: Use the sender email domain for the message ID
    // This helps improve deliverability and avoids DMARC issues
    const domain = fromEmail.split('@')[1];
    const messageId = `<ticket-${ticketId}-reply-${timestamp}-${uniqueId}@${domain}>`;
    
    // Add critical headers for email deliverability
    headers['Message-ID'] = messageId;
    headers['X-Mailer'] = 'ChannelPlay Help Desk';
    headers['X-Priority'] = '1';
    
    // Additional headers to improve deliverability
    headers['Precedence'] = 'bulk';
    headers['Auto-Submitted'] = 'auto-replied';
    headers['X-Auto-Response-Suppress'] = 'OOF, DR, RN, NRN, AutoReply';
    
    // Make sure the Sender header matches the From email address
    // This is critical for passing DMARC checks
    headers['Sender'] = fromEmail;
    
    console.log(`📋 Setting enhanced email headers for better deliverability`);
    console.log(`📋 Message-ID: ${messageId}`);
    
    // Enhanced logging for debugging
    console.log(`📧 Sending email with the following data:`);
    console.log(`   To: ${typeof to === 'string' ? to : to.join(', ')}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   CC Recipients: ${cc ? (typeof cc === 'string' ? cc : cc.join(', ')) : 'none'}`);
    console.log(`   Attachments: ${attachments ? attachments.length : 0}`);
    console.log(`   From: ${fromObject.name} <${fromObject.address}>`);
    
    // Add reply-to header matching the from address
    headers['Reply-To'] = fromObject.address;
    
    // Use the object format that works correctly in test emails 
    // This is the key to preventing "via helpdesk.1office.in" in the emails
    const result = await sendDirectEmail(
      {
        from: fromObject, // Use the object format that works in test emails
        to,
        cc,
        subject,
        text,
        html,
        headers,
        attachments
      },
      deskId
    );
    
    if (result.success) {
      console.log(`✅ Email sent successfully via direct SMTP for ticket #${ticketId}`);
    } else {
      console.error(`❌ Failed to send email via direct SMTP: ${result.error}`);
    }
    
    return result;
  } catch (error: any) {
    console.error('Error in sendTicketReplyDirect:', error);
    return {
      success: false,
      error: error.message || 'Unknown error sending direct email'
    };
  }
}