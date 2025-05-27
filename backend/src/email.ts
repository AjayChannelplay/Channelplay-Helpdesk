/**
 * Email Service
 * 
 * This module provides a unified email service that coordinates 
 * SMTP for sending and IMAP for receiving
 */

import { smtpService } from './smtp';
// Import the real IMAP service implementation
import { imapService } from './imap-service';
import { SMTP_CONFIG, EMAIL_DOMAIN, formatEmailAddress, isIMAPConfigured } from './config';
import { db } from './db';
import { tickets, messages, desks } from '../database/schema';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

// Types for email polling
type EmailHandler = (email: any) => Promise<void>;
type EmailFilter = (email: any) => boolean;

/**
 * Create a ticket from an email
 */
// Import email threading utilities
import { findRelatedTicket } from './email-threading';

/**
 * Create a ticket from an email, handling threading and MIME content properly
 */
export async function createTicketFromEmail(email: any, deskId: number) {
  console.log(`Processing email: ${email.subject}`);
  
  try {
    // Get the desk details
    const desk = await db.query.desks.findFirst({
      where: eq(desks.id, deskId)
    });
    
    if (!desk) {
      return { success: false, error: `Desk with ID ${deskId} not found` };
    }
    
    // Extract email data with improved parsing
    const subject = email.subject || '(No Subject)';
    const senderEmail = email.from?.text || email.from?.value?.[0]?.address || '';
    const senderName = email.from?.value?.[0]?.name || senderEmail.split('@')[0] || 'Unknown';
    
    // Better handling of multipart MIME content
    // Prefer HTML content for rich formatting, but fall back to text
    let content = '';
    if (email.html) {
      // Clean up HTML content to make it more readable
      content = email.html;
    } else if (email.text) {
      // Convert plain text to simple HTML for consistent display
      content = email.text.replace(/\n/g, '<br>');
    }
    
    const messageId = email.messageId || nanoid();
    const inReplyTo = email.inReplyTo || null;
    const references = email.references || null;
    
    // Extract CC recipients if any
    const ccRecipients = [];
    if (email.cc?.text) {
      ccRecipients.push(email.cc.text);
    } else if (email.cc?.value && Array.isArray(email.cc.value)) {
      email.cc.value.forEach((cc: any) => {
        if (cc.address) ccRecipients.push(cc.address);
      });
    }
    
    // Check if this email has already been processed (avoid duplicates)
    const existingMessage = await db.query.messages.findFirst({
      where: eq(messages.messageId, messageId)
    });
    
    if (existingMessage) {
      console.log(`Email with message ID ${messageId} already processed as ticket #${existingMessage.ticketId}`);
      return { success: true, ticketId: existingMessage.ticketId };
    }
    
    // Enhanced check to find if this email is a reply to an existing thread
    // Add debugging information to see the exact headers we're working with
    console.log(`Email details for threading check:\n  Subject: "${subject}"\n  From: ${senderEmail}\n  Message-ID: ${messageId}\n  In-Reply-To: ${inReplyTo}\n  References: ${references}`);
    
    // DIRECT APPROACH: For Outlook emails, try a direct subject-based match first before using the complex threading logic
    // This is a more reliable approach for emails from Outlook that often have non-standard threading headers
    let relatedTicketId = null;
    
    // Clean the subject by removing Re:, Fwd:, etc. and extra whitespace
    const cleanSubject = subject.replace(/^(re|fwd|fw|)\s*:\s*/i, '').trim();
    
    if (cleanSubject && cleanSubject.length > 3) {
      // Try to find a ticket with a matching subject
      console.log(`Performing direct subject match for: "${cleanSubject}"`);
      
      // First try an exact match on the clean subject
      const exactMatches = await db.query.tickets.findMany({
        where: (tickets, { eq, and, not }) => {
          const conditions = [
            eq(tickets.subject, cleanSubject)
          ];
          return and(...conditions);
        },
        orderBy: (tickets, { desc }) => [desc(tickets.updatedAt)],
        limit: 5
      });
      
      if (exactMatches.length > 0) {
        console.log(`Found ${exactMatches.length} tickets with exact subject match`);
        relatedTicketId = exactMatches[0].id;
      } else {
        // If no exact match, try to find a ticket where the subject contains the clean subject
        // or the clean subject contains the ticket subject
        const subjectMatches = await db.execute(
          `SELECT id, subject FROM tickets 
           WHERE LOWER(subject) LIKE LOWER('%${cleanSubject}%') 
           OR LOWER('${cleanSubject}') LIKE LOWER(CONCAT('%', subject, '%')) 
           ORDER BY updated_at DESC 
           LIMIT 5`
        );
        
        if (subjectMatches && Array.isArray(subjectMatches) && subjectMatches.length > 0) {
          console.log(`Found ${subjectMatches.length} tickets with fuzzy subject match`);
          relatedTicketId = subjectMatches[0].id;
        }
      }
    }
    
    // If direct subject matching didn't find anything, fall back to the complex threading logic
    if (!relatedTicketId) {
      console.log('Direct subject matching failed, trying threading logic with headers');
      relatedTicketId = await findRelatedTicket(
        messageId,  // Message ID
        references, // References header
        inReplyTo,  // In-Reply-To header
        subject,    // Actual email subject
        senderEmail // Actual sender email
      );
    }
    
    if (relatedTicketId) {
      console.log(`This email is a reply to existing ticket #${relatedTicketId}`);
      
      // Update the existing ticket's status and timestamp
      await db.update(tickets)
        .set({
          status: 'open', // Reopen the ticket if it was closed
          updatedAt: new Date()
        })
        .where(eq(tickets.id, relatedTicketId));
      
      // Create a new message in the existing ticket
      const [newMessage] = await db.insert(messages).values({
        ticketId: relatedTicketId,
        content: content,
        sender: senderName,
        senderEmail: senderEmail,
        isAgent: false,
        messageId: messageId,
        ccRecipients: ccRecipients,
        createdAt: new Date(),
        emailSent: false,
        referenceIds: references,
        inReplyTo: inReplyTo
      }).returning();
      
      return { success: true, ticketId: relatedTicketId };
    }
    
    // If not a reply, create a new ticket
    const [newTicket] = await db.insert(tickets).values({
      subject,
      status: 'open',
      customerName: senderName,
      customerEmail: senderEmail,
      deskId: deskId,
      ccRecipients: ccRecipients,
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning();
    
    if (!newTicket || !newTicket.id) {
      throw new Error('Failed to create ticket record');
    }
    
    // Create the message with full threading information
    const [newMessage] = await db.insert(messages).values({
      ticketId: newTicket.id,
      content: content,
      sender: senderName,
      senderEmail: senderEmail,
      isAgent: false,
      messageId: messageId,
      ccRecipients: ccRecipients,
      createdAt: new Date(),
      emailSent: false,
      referenceIds: references,
      inReplyTo: inReplyTo
    }).returning();
    
    console.log(`Created ticket #${newTicket.id} from email`);
    
    // Handle attachments if any
    if (email.attachments && email.attachments.length > 0) {
      console.log(`Processing ${email.attachments.length} attachments for ticket #${newTicket.id}`);
      // Format attachments for storage in the database
      const attachmentsData = email.attachments.map((attachment: any) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
        // Store attachment content or path depending on your implementation
        // You might want to save files to disk and store paths instead
        content: attachment.content?.toString('base64')
      }));
      
      // Update the message with attachments
      await db.update(messages)
        .set({ attachments: attachmentsData })
        .where(eq(messages.id, newMessage.id));
    }
    
    return { success: true, ticketId: newTicket.id };
  } catch (error: any) {
    console.error('Error creating ticket from email:', error);
    return { success: false, error: `Error creating ticket: ${error.message}` };
  }
}

class EmailService {
  private initialized: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private emailHandlers: EmailHandler[] = [];
  private emailFilters: EmailFilter[] = [];
  
  /**
   * Initialize the email service
   */
  initialize(): boolean {
    try {
      // Check if SMTP service is configured
      if (smtpService && smtpService.getStatus().configured) {
        console.log('SMTP service is configured');
      } else {
        console.log('SMTP service is not configured');
      }
      
      // Check if IMAP service is configured
      if (imapService && imapService.getStatus().configured) {
        console.log('IMAP service is configured');
      } else {
        console.log('IMAP service is not configured');
      }
      
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('Error initializing email service:', error);
      this.initialized = false;
      return false;
    }
  }
  
  /**
   * Send an email
   */
  async sendEmail(options: {
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
    if (!this.initialized) {
      return { 
        success: false, 
        error: 'Email service not initialized' 
      };
    }
    
    // If SMTP is not configured, return error
    if (!smtpService.getStatus().configured) {
      return { 
        success: false, 
        error: 'SMTP service not configured' 
      };
    }
    
    try {
      // Format the from address if not provided
      let from = options.from;
      if (!from) {
        const fromName = options.fromName || SMTP_CONFIG.fromName;
        from = formatEmailAddress(fromName, SMTP_CONFIG.fromEmail);
      }
      
      // Send the email
      const result = await smtpService.sendEmail({
        ...options,
        from
      });
      
      return result;
    } catch (error: any) {
      console.error('Error sending email:', error);
      return { 
        success: false, 
        error: error.message || 'Unknown error sending email' 
      };
    }
  }
  
  /**
   * Send a ticket reply with proper threading
   */
  async sendTicketReply(options: {
    from: string;
    to: string | string[];
    cc?: string | string[];
    bcc?: string | string[];
    subject: string;
    text?: string;
    html?: string;
    attachments?: any[];
    inReplyTo?: string;
    references?: string[];
    ticketId?: number;
  }): Promise<{ success: boolean; error?: string; messageId?: string }> {
    if (!this.initialized) {
      return { 
        success: false, 
        error: 'Email service not initialized' 
      };
    }
    
    try {
      // Generate a proper Message-ID using the desk's domain from the 'from' address
      // This avoids the "via helpdesk.1office.in" issue and ensures proper threading
      let domain = EMAIL_DOMAIN;
      
      // Extract domain from the 'from' address if available
      const fromEmail = options.from.match(/<([^>]+)>/);
      if (fromEmail && fromEmail[1] && fromEmail[1].includes('@')) {
        const parts = fromEmail[1].split('@');
        if (parts.length > 1) {
          domain = parts[1];
        }
      }
      
      // Create a ticket-specific Message-ID that includes the domain from the sending address
      // This ensures replies will thread properly in email clients
      const messageId = `<ticket-${options.ticketId || 'new'}-${Date.now()}-${Math.random().toString(36).substring(2, 10)}@${domain}>`;
      console.log(`Generated message ID with desk's domain: ${messageId}`);
      
      // Format references header for threading - critical for email clients to group conversations
      let references = '';
      if (options.references && options.references.length > 0) {
        // Ensure all references are properly formatted with angle brackets
        const formattedRefs = options.references.map(ref => {
          // Add angle brackets if missing
          return ref.startsWith('<') ? ref : `<${ref}>`;
        });
        references = formattedRefs.join(' ');
      }
      
      // Add the In-Reply-To to references if not already included
      // This ensures the conversation chain is maintained
      if (options.inReplyTo) {
        const formattedInReplyTo = options.inReplyTo.startsWith('<') 
          ? options.inReplyTo 
          : `<${options.inReplyTo}>`;
          
        if (!references.includes(formattedInReplyTo)) {
          references = references ? `${references} ${formattedInReplyTo}` : formattedInReplyTo;
        }
      }
      
      // Send the email
      const result = await this.sendEmail({
        ...options,
        messageId,
        references,
        headers: {
          ...(options.inReplyTo ? { 'In-Reply-To': options.inReplyTo } : {}),
          ...(references ? { 'References': references } : {})
        }
      });
      
      return {
        ...result,
        messageId
      };
    } catch (error: any) {
      console.error('Error sending ticket reply:', error);
      return { 
        success: false, 
        error: error.message || 'Unknown error sending ticket reply' 
      };
    }
  }
  
  /**
   * Check for new emails immediately (one-time check)
   * @returns Promise with result of the check
   */
  async checkEmailsNow(): Promise<{ success: boolean; newEmails: number; error?: string }> {
    if (!this.initialized) {
      console.error('Cannot check emails: Email service not initialized');
      return { success: false, newEmails: 0, error: 'Email service not initialized' };
    }
    
    if (!imapService.getStatus().configured) {
      console.error('Cannot check emails: IMAP service not configured');
      return { success: false, newEmails: 0, error: 'IMAP service not configured' };
    }
    
    try {
      console.log('Performing immediate email check per user request');
      
      // Run the poll emails function directly for an immediate check
      const emailCount = await this.pollEmails();
      
      return { 
        success: true, 
        newEmails: typeof emailCount === 'boolean' ? 0 : emailCount || 0
      };
    } catch (error: any) {
      console.error('Error in immediate email check:', error);
      return { 
        success: false, 
        newEmails: 0, 
        error: error.message || 'Unknown error checking emails' 
      };
    }
  }
  
  /**
   * Start polling for new emails
   */
  startPolling(interval: number = 300000): boolean {
    if (!this.initialized) {
      console.error('Cannot start polling: Email service not initialized');
      return false;
    }
    
    if (!imapService.getStatus().configured) {
      console.error('Cannot start polling: IMAP service not configured');
      return false;
    }
    
    // Clear existing poll interval if any
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    
    console.log(`Starting email polling with interval: ${interval}ms (${interval/1000} seconds)`);
    
    // Set up polling with reduced frequency to minimize background activity
    this.pollInterval = setInterval(() => {
      this.pollEmails().catch(error => {
        console.error('Error polling emails:', error);
      });
    }, interval);
    
    // Immediate first poll
    this.pollEmails().catch(error => {
      console.error('Error on initial email poll:', error);
    });
    
    return true;
  }
  
  /**
   * Stop polling for new emails
   */
  stopPolling(): boolean {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.log('Email polling stopped');
      return true;
    }
    
    return false;
  }
  
  /**
   * Poll for new emails
   */
  private async pollEmails(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      imapService.fetchUnreadEmails(async (emails: any[]) => {
        try {
          if (emails.length === 0) {
            console.log('No new emails found');
            resolve(true);
            return;
          }
          
          console.log(`Found ${emails.length} new emails`);
          
          // Process each email with handlers
          for (const email of emails) {
            // Apply filters
            if (this.emailFilters.length > 0) {
              const passesFilters = this.emailFilters.every(filter => filter(email));
              if (!passesFilters) {
                console.log('Email filtered out:', email.subject);
                continue;
              }
            }
            
            // Process with handlers
            for (const handler of this.emailHandlers) {
              try {
                await handler(email);
              } catch (error) {
                console.error('Error in email handler:', error);
              }
            }
          }
          
          resolve(true);
        } catch (error) {
          console.error('Error processing emails:', error);
          reject(error);
        }
      }).catch((error: Error) => {
        console.error('Error fetching unread emails:', error);
        reject(error);
      });
    });
  }
  
  /**
   * Register an email handler
   */
  registerEmailHandler(handler: EmailHandler): void {
    this.emailHandlers.push(handler);
  }
  
  /**
   * Register an email filter
   */
  registerEmailFilter(filter: EmailFilter): void {
    this.emailFilters.push(filter);
  }
  
  /**
   * Get the current status of the email service
   */
  getStatus(): { 
    initialized: boolean; 
    smtpConfigured: boolean; 
    imapConfigured: boolean;
    polling: boolean;
  } {
    return {
      initialized: this.initialized,
      smtpConfigured: smtpService.getStatus().configured,
      imapConfigured: imapService.getStatus().configured,
      polling: this.pollInterval !== null
    };
  }
}

// Create a singleton instance
export const emailService = new EmailService();