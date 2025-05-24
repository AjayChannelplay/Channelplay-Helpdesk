/**
 * Email Service
 * 
 * This module provides a unified email service that coordinates 
 * SMTP for sending and IMAP for receiving
 */

import { smtpService } from './smtp';
import { imapService } from './imap';
import { SMTP_CONFIG, IMAP_CONFIG, EMAIL_DOMAIN, formatEmailAddress } from './config';

// Types for email polling
type EmailHandler = (email: any) => Promise<void>;
type EmailFilter = (email: any) => boolean;

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
        newEmails: emailCount || 0
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
      imapService.fetchUnreadEmails(async (emails) => {
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
      }).catch(error => {
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