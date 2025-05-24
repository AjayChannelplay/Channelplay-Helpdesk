import { Express, Request, Response, NextFunction } from "express";
import { Server } from "http";
import { smtpService } from "./smtp";
import { imapService } from "./imap";
import { emailService } from "./email";
import { db } from "./db";
import { tickets, messages } from "../shared/schema";
import { eq } from "drizzle-orm";

// Define function to integrate the email services into the Express app
export function integrateEmailServices(app: Express) {
  // Add endpoint to check email service status
  app.get("/api/email/status", async (req, res) => {
    const status = {
      smtp: smtpService.getStatus(),
      imap: imapService.getStatus(),
      email: emailService.getStatus(),
    };
    
    res.json(status);
  });
  
  // Add endpoint to configure SMTP service
  app.post("/api/email/smtp/configure", async (req, res) => {
    try {
      const { host, port, secure, user, pass } = req.body;
      
      if (!host || !user || !pass) {
        return res.status(400).json({
          success: false,
          error: "Missing required SMTP configuration parameters"
        });
      }
      
      // Configure SMTP service
      smtpService.configure({
        host,
        port: port || 587,
        secure: secure || false,
        auth: {
          user,
          pass
        },
        tls: {
          rejectUnauthorized: false
        }
      });
      
      // Verify connection
      const verification = await smtpService.verifyConnection();
      
      if (!verification.success) {
        return res.status(400).json({
          success: false,
          error: `Failed to connect to SMTP server: ${verification.error}`
        });
      }
      
      res.json({
        success: true,
        message: "SMTP service configured successfully",
        status: smtpService.getStatus()
      });
    } catch (error: any) {
      console.error("Error configuring SMTP service:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Unknown error configuring SMTP service"
      });
    }
  });
  
  // Add endpoint to configure IMAP service
  app.post("/api/email/imap/configure", async (req, res) => {
    try {
      const { host, port, user, password, tls } = req.body;
      
      if (!host || !user || !password) {
        return res.status(400).json({
          success: false,
          error: "Missing required IMAP configuration parameters"
        });
      }
      
      // Configure IMAP service
      imapService.configure({
        host,
        port: port || 993,
        user,
        password,
        tls: tls !== false,
        tlsOptions: {
          rejectUnauthorized: false
        },
        authTimeout: 30000,
        keepalive: true
      });
      
      // Test connection
      const testResult = await imapService.testConnection();
      
      if (!testResult.success) {
        return res.status(400).json({
          success: false,
          error: `Failed to connect to IMAP server: ${testResult.error}`
        });
      }
      
      res.json({
        success: true,
        message: "IMAP service configured successfully",
        status: imapService.getStatus()
      });
    } catch (error: any) {
      console.error("Error configuring IMAP service:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Unknown error configuring IMAP service"
      });
    }
  });
  
  // Add endpoint to start email processing
  app.post("/api/email/processing/start", async (req, res) => {
    try {
      const { frequency } = req.body;
      
      // Start processing emails
      const result = await emailService.startProcessingEmails(frequency || 60000);
      
      if (!result) {
        return res.status(500).json({
          success: false,
          error: "Failed to start email processing"
        });
      }
      
      res.json({
        success: true,
        message: "Email processing started successfully",
        status: emailService.getStatus()
      });
    } catch (error: any) {
      console.error("Error starting email processing:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Unknown error starting email processing"
      });
    }
  });
  
  // Add endpoint to stop email processing
  app.post("/api/email/processing/stop", (req, res) => {
    try {
      // Stop processing emails
      emailService.stopProcessingEmails();
      
      res.json({
        success: true,
        message: "Email processing stopped successfully",
        status: emailService.getStatus()
      });
    } catch (error: any) {
      console.error("Error stopping email processing:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Unknown error stopping email processing"
      });
    }
  });
  
  // Add endpoint to send a test email
  app.post("/api/email/test", async (req, res) => {
    try {
      const { to, subject, content } = req.body;
      
      if (!to || !subject || !content) {
        return res.status(400).json({
          success: false,
          error: "Missing required email parameters"
        });
      }
      
      // Send test email
      const result = await emailService.sendEmail({
        from: "ChannelPlay Help Desk <channelplay@helpdesk.1office.in>",
        to,
        subject,
        text: content,
        html: `<div style="font-family: Arial, sans-serif; color: #333;">${content.replace(/\n/g, "<br>")}</div>`
      });
      
      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: `Failed to send test email: ${result.error}`
        });
      }
      
      res.json({
        success: true,
        message: "Test email sent successfully",
        messageId: result.messageId
      });
    } catch (error: any) {
      console.error("Error sending test email:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Unknown error sending test email"
      });
    }
  });

  // Helper function to send ticket replies using the direct SMTP service
  async function sendTicketReply({
    ticketId,
    content,
    sender,
    senderEmail,
    originalMessageId,
    references,
    customerEmail,
    subject,
    ccRecipients,
    deskName,
    deskEmail,
    attachments
  }: {
    ticketId: number;
    content: string;
    sender: string;
    senderEmail: string;
    originalMessageId?: string;
    references?: string;
    customerEmail: string;
    subject: string;
    ccRecipients?: string[];
    deskName: string;
    deskEmail: string;
    attachments?: any[];
  }) {
    try {
      // Prepare HTML content
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; color: #333;">
          ${content.replace(/\n/g, "<br>")}
        </div>
      `;
      
      // Send reply using the direct SMTP/IMAP email service
      const result = await emailService.sendReply({
        to: customerEmail,
        subject,
        content,
        htmlContent,
        ticketId,
        originalMessageId,
        references,
        ccRecipients,
        fromName: deskName,
        deskEmail,
        attachments
      });
      
      if (!result.success) {
        console.error(`Failed to send ticket reply: ${result.error}`);
        throw new Error(`Failed to send ticket reply: ${result.error}`);
      }
      
      return {
        success: true,
        messageId: result.messageId
      };
    } catch (error: any) {
      console.error("Error sending ticket reply:", error);
      throw error;
    }
  }
  
  // Export the sendTicketReply function for use in other modules
  return {
    sendTicketReply
  };
}