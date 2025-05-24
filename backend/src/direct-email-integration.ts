/**
 * Direct Email Integration
 * 
 * This file handles the integration of direct SMTP/IMAP email functionality
 * as a replacement for Mailgun.
 */

import { Express, Request, Response } from "express";
import { emailService } from "./email";
import { smtpService } from "./smtp";
import { imapService } from "./imap";
import { pool } from "./db";
import { 
  SMTP_CONFIG, 
  IMAP_CONFIG, 
  EMAIL_POLL_FREQUENCY,
  isSMTPConfigured,
  isIMAPConfigured,
  EMAIL_DOMAIN
} from "./config";

/**
 * Configure the email services with necessary credentials
 */
export function configureEmailServices() {
  // Configure SMTP if credentials are available in environment
  if (isSMTPConfigured()) {
    console.log('Configuring SMTP from environment settings:');
    console.log(`- Host: ${SMTP_CONFIG.host}`);
    console.log(`- Port: ${SMTP_CONFIG.port}`);
    console.log(`- User: ${SMTP_CONFIG.user}`);
    console.log(`- Secure: ${SMTP_CONFIG.secure}`);
    
    smtpService.configure({
      host: SMTP_CONFIG.host,
      port: SMTP_CONFIG.port,
      secure: SMTP_CONFIG.secure,
      auth: { 
        user: SMTP_CONFIG.user, 
        pass: SMTP_CONFIG.pass 
      },
      tls: { 
        rejectUnauthorized: false 
      }
    } as any);
  }
  else {
    console.log('No SMTP configuration found. Direct email sending will be unavailable.');
  }
  
  // Configure IMAP if credentials are available in environment
  if (isIMAPConfigured()) {
    console.log('Configuring IMAP from environment settings:');
    console.log(`- Host: ${IMAP_CONFIG.host}`);
    console.log(`- Port: ${IMAP_CONFIG.port}`);
    console.log(`- User: ${IMAP_CONFIG.user}`);
    console.log(`- TLS: ${IMAP_CONFIG.tls}`);
    
    imapService.configure({
      host: IMAP_CONFIG.host,
      port: IMAP_CONFIG.port,
      user: IMAP_CONFIG.user,
      password: IMAP_CONFIG.password,
      tls: IMAP_CONFIG.tls,
      tlsOptions: {
        rejectUnauthorized: false
      },
      authTimeout: 30000
    });
  }
  else {
    console.log('No IMAP configuration found. Email fetching will be unavailable.');
  }
  
  // Initialize the email service
  emailService.initialize();
}

/**
 * Start the email poller to automatically fetch incoming emails
 */
export async function startEmailPolling(frequency: number = 60000): Promise<boolean> {
  return emailService.startPolling(frequency);
}

/**
 * Send an email with our direct SMTP implementation
 */
export async function sendEmail(options: {
  from?: string;
  fromName?: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: any[];
  headers?: any;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
}): Promise<{ success: boolean; error?: string; messageId?: string }> {
  return emailService.sendEmail(options);
}

/**
 * Send a reply to a ticket with proper threading support
 */
export async function sendTicketReply({
  deskName,
  deskEmail,
  to,
  cc = [],
  subject,
  text,
  html,
  attachments = [],
  ticketId,
  inReplyTo,
  references = []
}: {
  deskName: string;
  deskEmail: string;
  to: string | string[];
  cc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: any[];
  ticketId: number;
  inReplyTo?: string;
  references?: string[];
}): Promise<{ success: boolean; error?: string; messageId?: string }> {
  // Use the exact email address from the desk configuration
  // This prevents "on behalf of" issues and ensures the correct sender
  const from = deskEmail.includes('@')
    ? `${deskName} <${deskEmail}>`
    : `${deskName} <${deskEmail}@${EMAIL_DOMAIN}>`;

  console.log(`📧 Using exact desk email in sendTicketReply: ${from}`);
  
  return emailService.sendTicketReply({
    from,
    to,
    cc,
    subject,
    text,
    html,
    attachments,
    ticketId,
    inReplyTo,
    references
  });
}

/**
 * Register API routes for email service management
 */
export function registerEmailRoutes(app: Express): void {
  // API route to check email service status
  app.get('/api/email/status', (req: Request, res: Response) => {
    const status = {
      smtp: smtpService.getStatus(),
      imap: imapService.getStatus(),
      email: emailService.getStatus()
    };
    
    res.json(status);
  });
  
  // API route to configure SMTP
  app.post('/api/email/smtp/configure', (req: Request, res: Response) => {
    try {
      const { host, port, secure, user, pass } = req.body;
      
      if (!host || !user || !pass) {
        return res.status(400).json({
          success: false,
          error: 'Missing required SMTP configuration parameters'
        });
      }
      
      // Configure SMTP service
      smtpService.configure({
        host,
        port: port || 587,
        secure: secure || false,
        auth: { user, pass },
        tls: { rejectUnauthorized: false }
      });
      
      // Initialize email service if needed
      if (!emailService.getStatus().initialized) {
        emailService.initialize();
      }
      
      res.json({
        success: true,
        message: 'SMTP service configured successfully',
        status: smtpService.getStatus()
      });
    } catch (error: any) {
      console.error('Error configuring SMTP service:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Unknown error configuring SMTP service'
      });
    }
  });
  
  // API route to configure IMAP
  app.post('/api/email/imap/configure', async (req: Request, res: Response) => {
    try {
      const { host, port, user, password, tls, deskId } = req.body;
      
      if (!host || !user || !password) {
        return res.status(400).json({
          success: false,
          error: 'Missing required IMAP configuration parameters'
        });
      }
      
      // Configure IMAP service
      imapService.configure({
        host,
        port: port || 993,
        user,
        password,
        tls: tls !== false,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 30000
      });
      
      // Initialize email service if needed
      if (!emailService.getStatus().initialized) {
        emailService.initialize();
      }
      
      // If a desk ID is provided, update its IMAP settings in the database
      if (deskId) {
        try {
          await pool.query(
            `UPDATE desks SET 
             imap_host = $1, 
             imap_port = $2, 
             imap_user = $3, 
             imap_password = $4, 
             imap_tls = $5
             WHERE id = $6`,
            [host, port || 993, user, password, tls !== false, deskId]
          );
          console.log(`Updated IMAP configuration for desk ID ${deskId}`);
        } catch (dbError: any) {
          console.error('Error updating desk IMAP settings:', dbError);
          // Continue even if DB update fails, as we've already configured the service in memory
        }
      }
      
      res.json({
        success: true,
        message: 'IMAP service configured successfully',
        status: imapService.getStatus()
      });
    } catch (error: any) {
      console.error('Error configuring IMAP service:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Unknown error configuring IMAP service'
      });
    }
  });
  
  // API route to control email polling
  app.post('/api/email/polling', async (req: Request, res: Response) => {
    try {
      const { action, frequency } = req.body;
      
      if (action === 'start') {
        // Use a much longer poll frequency if specified to reduce background activity
        const pollFrequency = frequency || EMAIL_POLL_FREQUENCY;
        console.log(`Starting email polling with ${pollFrequency/1000} second interval`);
        
        const success = emailService.startPolling(pollFrequency);
        
        if (success) {
          res.json({
            success: true,
            message: `Email polling started with frequency: ${pollFrequency/1000} seconds`,
            status: emailService.getStatus()
          });
        } else {
          res.status(400).json({
            success: false,
            error: 'Failed to start email polling. Make sure IMAP is configured.',
            status: emailService.getStatus()
          });
        }
      } 
      else if (action === 'stop') {
        console.log('Stopping email polling per user request');
        const success = emailService.stopPolling();
        
        if (success) {
          res.json({
            success: true,
            message: 'Email polling stopped',
            status: emailService.getStatus()
          });
        } else {
          res.status(400).json({
            success: false,
            error: 'Email polling was not running',
            status: emailService.getStatus()
          });
        }
      }
      else if (action === 'check_now') {
        // Immediate check without waiting for the polling interval
        console.log('Performing immediate email check per user request');
        
        // Check if a specific desk ID was provided
        const deskId = req.body.deskId;
        if (deskId) {
          try {
            console.log(`Using IMAP configuration from desk ID: ${deskId}`);
            // Get the desk's IMAP configuration from the database
            const { rows } = await pool.query(
              `SELECT 
                imap_host, imap_port, imap_user, imap_password, 
                imap_tls, imap_mailbox
               FROM desks WHERE id = $1`, 
               [deskId]
            );
            
            if (rows.length > 0 && rows[0].imap_host && rows[0].imap_user && rows[0].imap_password) {
              const desk = rows[0];
              
              // Configure IMAP with the desk's settings
              imapService.configure({
                host: desk.imap_host,
                port: desk.imap_port || 993,
                user: desk.imap_user,
                password: desk.imap_password,
                tls: desk.imap_tls !== false,
                mailbox: desk.imap_mailbox || 'INBOX'
              });
              
              console.log(`IMAP configured successfully for desk ID ${deskId}`);
            } else {
              console.log(`No IMAP configuration found for desk ID ${deskId}`);
              return res.status(400).json({
                success: false,
                error: `No IMAP configuration found for this help desk. Please set up IMAP first in the Email Server settings for this desk.`
              });
            }
          } catch (error: any) {
            console.error('Error getting desk IMAP configuration:', error);
            return res.status(500).json({
              success: false, 
              error: `Could not retrieve IMAP settings for this desk: ${error.message}`
            });
          }
        } else {
          // No desk ID provided
          return res.status(400).json({
            success: false,
            error: "No desk selected. Please select a desk to fetch emails from."
          });
        }
        
        try {
          // Run a one-time check without affecting polling schedule
          console.log("Starting immediate IMAP check with configured settings");
          const result = await emailService.checkEmailsNow();
          
          console.log("IMAP check completed successfully:", result);
          res.json({
            success: true,
            message: `Email check complete. Found ${result.newEmails} new messages.`,
            newEmails: result.newEmails,
            status: emailService.getStatus()
          });
          
          // Refresh is handled by the client, which will invalidate its queries
        } catch (err: any) {
          console.error("Error during IMAP check:", err);
          res.status(500).json({
            success: false,
            error: `Error checking emails: ${err.message}`,
            status: emailService.getStatus()
          });
        }
      }
      else {
        res.status(400).json({
          success: false,
          error: 'Invalid action. Must be "start", "stop", or "check_now".'
        });
      }
    } catch (error: any) {
      console.error('Error managing email polling:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Unknown error managing email polling'
      });
    }
  });
  
  // API route to test connections
  app.post('/api/email/test-connection', async (req: Request, res: Response) => {
    try {
      const { service } = req.body;
      
      if (service === 'smtp') {
        const result = await smtpService.verifyConnection();
        res.json({
          success: result.success,
          message: result.success ? 'SMTP connection successful' : `SMTP connection failed: ${result.error}`,
          error: result.error
        });
      } 
      else {
        res.status(400).json({
          success: false,
          error: 'Invalid service. Must be "smtp".'
        });
      }
    } catch (error: any) {
      console.error('Error testing connection:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Unknown error testing connection'
      });
    }
  });

  // Direct email import endpoint
  app.post('/api/email/import-now', async (req: Request, res: Response) => {
    try {
      const { imapHost, imapPort, imapUser, imapPassword, imapSecure, deskId } = req.body;

      if (!imapHost || !imapUser || !imapPassword) {
        return res.status(400).json({
          success: false,
          error: 'Missing required IMAP credentials'
        });
      }

      console.log(`Starting direct email import for ${imapUser}...`);

      // Import the IMAP fetcher directly
      const { fetchEmailsFromIMAP } = await import('./imap-fetcher');

      // Create a temporary desk configuration for import
      const tempDeskConfig = {
        id: deskId || 1,
        name: 'Direct Import',
        email: imapUser,
        imapHost,
        imapPort: imapPort.toString(),
        imapUser,
        imapPassword,
        imapSecure: imapSecure !== false,
        imapMailbox: 'INBOX'
      };

      const result = await fetchEmailsFromIMAP([tempDeskConfig]);
      
      res.json({
        success: true,
        message: 'Emails imported successfully',
        newTickets: result.newTickets || 0,
        emailsProcessed: result.emailsProcessed || 0
      });

    } catch (error: any) {
      console.error('Direct email import error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to import emails'
      });
    }
  });
}