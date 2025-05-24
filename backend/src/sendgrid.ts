import { MailService } from '@sendgrid/mail';
import { Express, Request, Response } from 'express';
import { storage } from './storage';
import { InsertTicket, InsertMessage } from '@shared/schema';

// Type definition for email data
interface ParsedEmail {
  from?: { email?: string; name?: string } | string;
  to?: Array<{ email?: string; name?: string }> | string[];
  subject?: string;
  text?: string;
  html?: string;
  headers?: Record<string, any>;
  attachments?: any[];
  content?: Array<{type: string, value: string}>;
  messageId?: string;
}

interface SendGridConfig {
  apiKey: string;
  fromEmail: string;
  fromName?: string;
}

interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyToMessageId?: string;
  ticketId?: number;
}

export interface EmailData {
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  messageId: string;
  references?: string;
  inReplyTo?: string;
  timestamp: Date;
  attachments: any[];
  headers: any;
  ticketId?: number;
  strippedText?: string;
}

export class SendGridService {
  private mailService: MailService = new MailService();
  private initialized: boolean = false;
  public supportEmail: string = '';
  private fromName: string = 'Support Team';

  constructor(config: SendGridConfig) {
    try {
      this.mailService.setApiKey(config.apiKey);
      this.supportEmail = config.fromEmail;
      if (config.fromName) {
        this.fromName = config.fromName;
      }
      this.initialized = true;
      console.log('SendGrid service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize SendGrid service:', error);
    }
  }

  /**
   * Send an email with proper threading information
   */
  async sendEmail(options: EmailOptions): Promise<any> {
    if (!this.initialized) {
      throw new Error('SendGrid service not initialized');
    }

    try {
      const msg = {
        to: options.to,
        from: {
          email: this.supportEmail,
          name: this.fromName
        },
        subject: options.subject,
        text: options.text,
        html: options.html || this.convertTextToHtml(options.text),
        headers: {} as Record<string, string>
      };

      // Add message ID related headers for threading if available
      if (options.replyToMessageId) {
        msg.headers = {
          ...msg.headers,
          'References': options.replyToMessageId,
          'In-Reply-To': options.replyToMessageId
        };
      }

      // Add custom field for tracking ticket ID
      if (options.ticketId) {
        msg.headers = {
          ...msg.headers,
          'X-Ticket-ID': options.ticketId.toString()
        };
      }

      const response = await this.mailService.send(msg);
      return response;
    } catch (error) {
      console.error('SendGrid email error:', error);
      throw error;
    }
  }

  /**
   * Send an email reply as part of an existing thread
   */
  async sendReply(ticketId: number, to: string, subject: string, content: string, replyToMessageId?: string): Promise<any> {
    // Ensure subject has Re: prefix for replies
    if (!subject.startsWith('Re:')) {
      subject = 'Re: ' + subject;
    }

    const replyOptions: EmailOptions = {
      to,
      subject,
      text: content,
      replyToMessageId,
      ticketId
    };

    return this.sendEmail(replyOptions);
  }

  /**
   * Parse webhook data from SendGrid
   */
  async parseWebhook(req: Request): Promise<EmailData> {
    try {
      // For SendGrid, the email data is typically in req.body
      const emailData: ParsedEmail = req.body || {};
      
      // Extract headers from the email data
      const headers: Record<string, string> = emailData.headers || {};
      
      // Get email ID information for threading
      const messageId = emailData.messageId || headers['message-id'] || 
                        `sg-${Date.now()}@${this.supportEmail.split('@')[1] || 'example.com'}`;
      const references = headers['references'] || '';
      const inReplyTo = headers['in-reply-to'] || '';
      
      // Extract ticket ID if present in custom headers
      let ticketId: number | undefined;
      if (headers['x-ticket-id']) {
        ticketId = parseInt(headers['x-ticket-id'], 10);
      }
      
      // Get sender information
      let sender = '';
      let senderName = '';
      
      if (emailData.from) {
        if (typeof emailData.from === 'string') {
          sender = emailData.from;
        } else if (typeof emailData.from === 'object' && emailData.from.email) {
          sender = emailData.from.email;
          senderName = emailData.from.name || '';
        }
      }
      
      // Get recipient information
      let recipient = this.supportEmail;
      if (emailData.to) {
        if (typeof emailData.to === 'string') {
          recipient = emailData.to;
        } else if (Array.isArray(emailData.to) && emailData.to.length > 0) {
          const firstTo = emailData.to[0];
          if (typeof firstTo === 'string') {
            recipient = firstTo;
          } else if (typeof firstTo === 'object' && firstTo.email) {
            recipient = firstTo.email;
          }
        }
      }
      
      // Get subject
      const subject = emailData.subject || '(No Subject)';
      
      // Get email content
      let text = '';
      let html = '';
      
      if (emailData.text) {
        text = emailData.text;
      } else if (emailData.content && Array.isArray(emailData.content)) {
        // SendGrid may provide content as an array of content objects
        const textContent = emailData.content.find(c => c.type === 'text/plain');
        const htmlContent = emailData.content.find(c => c.type === 'text/html');
        
        if (textContent && textContent.value) {
          text = textContent.value;
        }
        
        if (htmlContent && htmlContent.value) {
          html = htmlContent.value;
        }
      }
      
      // Handle attachments
      const attachments = emailData.attachments || [];
      
      // Build the email data object
      const result: EmailData = {
        sender,
        recipient,
        subject,
        body: text || this.convertHtmlToText(html),
        messageId: messageId.replace(/[<>]/g, ''),
        references: references.replace(/[<>]/g, ''),
        inReplyTo: inReplyTo.replace(/[<>]/g, ''),
        timestamp: new Date(),
        attachments,
        headers,
        ticketId,
        strippedText: text
      };
      
      return result;
    } catch (error) {
      console.error('Error parsing SendGrid webhook:', error);
      throw error;
    }
  }

  /**
   * Set up route for receiving SendGrid webhooks
   */
  configureWebhook(app: Express) {
    // Standard webhook path for events
    app.post('/api/webhook/sendgrid', async (req: Request, res: Response) => {
      try {
        console.log("Received webhook from SendGrid:", JSON.stringify(req.body, null, 2));
        
        // Check if this is a test webhook
        if (req.body.event === 'test') {
          console.log("Received test webhook from SendGrid");
          return res.status(200).json({ success: true, message: "Test webhook received" });
        }
        
        return res.status(200).json({ success: true, message: "Webhook received" });
      } catch (error) {
        console.error("Error processing SendGrid webhook:", error);
        return res.status(200).send("Processed with errors");
      }
    });
    
    // Inbound parse webhook for incoming emails
    // Handle GET requests for verification
    app.get('/api/inbound-email', (req: Request, res: Response) => {
      console.log('GET request to /api/inbound-email (from SendGrid service)');
      res.status(200).json({ 
        message: "SendGrid inbound email endpoint is working",
        initialized: this.initialized,
        supportEmail: this.supportEmail
      });
    });
    
    // Handle POST requests for actual webhooks
    app.post('/api/inbound-email', async (req: Request, res: Response) => {
      try {
        console.log('POST request to /api/inbound-email (from SendGrid service)');
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        
        const emailData = await this.parseWebhook(req);
        console.log('Processed inbound email:', {
          from: emailData.sender,
          subject: emailData.subject,
          messageId: emailData.messageId,
          inReplyTo: emailData.inReplyTo
        });

        // Check if this is a reply to an existing ticket
        let ticketId: number | null = null;
        
        // First method: Check if the subject contains a ticket number reference: [Ticket #123]
        const ticketIdMatch = emailData.subject.match(/\[Ticket #(\d+)\]/i);
        if (ticketIdMatch && ticketIdMatch[1]) {
          const extractedId = parseInt(ticketIdMatch[1], 10);
          if (!isNaN(extractedId)) {
            const ticket = await storage.getTicketById(extractedId);
            if (ticket) {
              console.log(`Found ticket #${extractedId} from subject line reference`);
              ticketId = extractedId;
            }
          }
        }
        
        // Second method: Try to match based on In-Reply-To header
        if (!ticketId && emailData.inReplyTo && emailData.inReplyTo.length > 0) {
          console.log(`Looking for message with ID matching: ${emailData.inReplyTo}`);
          const tickets = await storage.getTickets();
          for (const ticket of tickets) {
            const messages = await storage.getMessagesByTicketId(ticket.id);
            const foundMessage = messages.find(msg => 
              msg.messageId && msg.messageId.length > 0 && 
              (emailData.inReplyTo!.includes(msg.messageId) || 
               (msg.messageId.includes('@') && emailData.inReplyTo!.includes(msg.messageId.split('@')[0])))
            );
            
            if (foundMessage) {
              console.log(`Found matching message by ID in ticket #${ticket.id}`);
              ticketId = ticket.id;
              break;
            }
          }
        }
        
        // We are intentionally removing the "third method" that checked if the sender already has tickets
        // This ensures that each new email creates a new ticket instead of being grouped with existing tickets
        // unless it is explicitly a reply (which is handled by the first two methods)

        if (ticketId) {
          // This is a reply to an existing ticket
          console.log(`Processing as reply to ticket #${ticketId}`);
          const ticket = await storage.getTicketById(ticketId);
          
          if (!ticket) {
            console.error(`Ticket #${ticketId} not found`);
            return res.status(404).json({ error: 'Ticket not found' });
          }
          
          // Create a new message in the existing ticket
          const newMessage: InsertMessage = {
            ticketId,
            sender: emailData.sender.split('@')[0],
            senderEmail: emailData.sender,
            content: emailData.body,
            isAgent: false,
            messageId: emailData.messageId
          };
          
          await storage.createMessage(newMessage);
          
          // If ticket was closed, reopen it
          if (ticket.status === 'closed') {
            await storage.updateTicketStatus(ticketId, 'open');
          }
          
          res.status(200).json({ status: 'success', action: 'reply_processed' });
        } else {
          // This is a new ticket
          console.log('Processing as new ticket');
          
          // Extract customer name (use email if no name provided)
          const atIndex = emailData.sender.indexOf('@');
          const customerName = atIndex > 0 
            ? emailData.sender.substring(0, atIndex)
            : emailData.sender;
          
          // Create a new ticket
          const newTicket: InsertTicket = {
            customerEmail: emailData.sender,
            customerName: customerName,
            subject: emailData.subject,
            status: 'open'
          };
          
          const ticket = await storage.createTicket(newTicket);
          
          // Create the first message
          const newMessage: InsertMessage = {
            ticketId: ticket.id,
            sender: customerName,
            senderEmail: emailData.sender,
            content: emailData.body,
            isAgent: false,
            messageId: emailData.messageId
          };
          
          await storage.createMessage(newMessage);
          
          res.status(200).json({ status: 'success', action: 'ticket_created', ticketId: ticket.id });
        }
      } catch (error) {
        console.error('Error processing inbound email:', error);
        res.status(500).json({ error: 'Failed to process email' });
      }
    });
  }

  isInitialized(): boolean {
    return this.initialized;
  }
  
  /**
   * Check if the SendGrid API key is valid by making a simple API request
   */
  async checkAPIKeyStatus(): Promise<{isValid: boolean, error?: string}> {
    if (!this.initialized) {
      return { isValid: false, error: 'SendGrid service not initialized' };
    }
    
    try {
      // Use a lightweight API call to validate the API key
      // We'll try to get mail settings which is less expensive than sending a test email
      const client = require('@sendgrid/client');
      client.setApiKey(process.env.SENDGRID_API_KEY || '');
      
      const request = {
        method: 'GET',
        url: '/v3/user/profile'
      };
      
      await client.request(request);
      return { isValid: true };
    } catch (error: any) {
      console.error('SendGrid API key validation error:', error);
      
      let errorMessage = 'Unknown error validating API key';
      if (error.code === 401) {
        errorMessage = 'Unauthorized: Invalid API key';
      } else if (error.code === 403) {
        errorMessage = 'Forbidden: API key lacks permissions';
      } else if (error.response && error.response.body) {
        try {
          const errorBody = typeof error.response.body === 'string' 
            ? JSON.parse(error.response.body) 
            : error.response.body;
          
          if (errorBody.errors && errorBody.errors.length > 0) {
            errorMessage = errorBody.errors.map((e: any) => e.message).join(', ');
          }
        } catch (parseError) {
          errorMessage = String(error.response.body);
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      return { 
        isValid: false, 
        error: errorMessage 
      };
    }
  }

  /**
   * Convert plain text to HTML for email sending
   */
  private convertTextToHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>')
      .replace(/\r/g, '')
      .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
  }

  /**
   * Convert HTML to plain text (simple version)
   */
  private convertHtmlToText(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<p\s*\/?>/gi, '\n')
      .replace(/<div\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }
}

// Create singleton instance
export const sendgridService = new SendGridService({
  apiKey: process.env.SENDGRID_API_KEY || '',
  // Use the provided help desk email address
  fromEmail: process.env.SENDGRID_FROM_EMAIL || 'help@helpdesk.channelplay.in',
  fromName: process.env.SENDGRID_FROM_NAME || 'Channel Play Helpdesk'
});

// Helper function to check if a recipient email is authorized
// This isn't necessary for SendGrid production domains, but is useful for testing
export async function isRecipientAuthorized(email: string): Promise<boolean> {
  // In a real implementation, you might check against a whitelist
  // For now, we'll assume all addresses are valid
  return true;
}