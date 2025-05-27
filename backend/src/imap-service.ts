/**
 * IMAP Service for fetching emails
 * 
 * This service connects to IMAP servers and fetches unread emails
 */

import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { Readable } from 'stream';
import type { Config } from 'imap';
import { parseMimeContent, cleanEmailContent } from './mime-parser';

interface ImapStatus {
  status: 'connected' | 'disconnected' | 'connecting';
  error?: string;
  configured: boolean;
}

class ImapService {
  private imap: Imap | null = null;
  private status: ImapStatus = {
    status: 'disconnected',
    configured: false
  };
  private config: Config | null = null;

  constructor() {
    this.status = {
      status: 'disconnected',
      configured: false
    };
  }

  /**
   * Set configuration for IMAP connection
   */
  configure(config: Config) {
    this.config = config;
    this.status.configured = !!(config && config.user && config.password && config.host);
    return this.status.configured;
  }

  /**
   * Configure for a specific desk
   */
  configureForDesk(desk: any): boolean {
    if (!desk) {
      console.error('Cannot configure IMAP: No desk provided');
      return false;
    }
    
    if (!desk.imapHost || !desk.imapUser || !desk.imapPassword) {
      console.log(`Desk ${desk.name} (ID: ${desk.id}) does not have complete IMAP configuration`);
      return false;
    }

    const config: Config = {
      user: desk.imapUser,
      password: desk.imapPassword,
      host: desk.imapHost,
      port: desk.imapPort ? parseInt(desk.imapPort, 10) : 993,
      tls: desk.imapSecure !== false, // Default to true
      tlsOptions: { rejectUnauthorized: false }, // Allow self-signed certificates
      authTimeout: 30000, // 30 seconds timeout for auth
    };

    return this.configure(config);
  }

  /**
   * Connect to IMAP server
   */
  async connect(): Promise<{ success: boolean; error?: string }> {
    if (!this.config || !this.status.configured) {
      this.status.error = 'Not configured';
      console.error('Cannot connect to IMAP: Not configured');
      return { success: false, error: 'IMAP not configured' };
    }

    if (this.imap && this.status.status === 'connected') {
      console.log('Already connected to IMAP server');
      return { success: true };
    }

    try {
      this.status.status = 'connecting';
      this.status.error = undefined;

      // Create a new IMAP connection
      this.imap = new Imap(this.config);

      return new Promise<{ success: boolean; error?: string }>((resolve, reject) => {
        if (!this.imap) {
          const error = new Error('IMAP object not initialized');
          console.error(error.message);
          this.status = {
            status: 'disconnected',
            error: error.message,
            configured: true
          };
          reject(error);
          return;
        }

        // Handle errors
        this.imap.once('error', (err: Error) => {
          console.error('IMAP connection error:', err);
          this.status = {
            status: 'disconnected',
            error: err.message || 'Unknown error',
            configured: true
          };
          reject(err);
        });

        // Handle successful connection
        this.imap.once('ready', () => {
          this.status = {
            status: 'connected',
            configured: true
          };
          console.log('Connected to IMAP server');
          resolve({ success: true });
        });
        
        // Handle end (connection closed)
        this.imap.once('end', () => {
          console.log('IMAP connection ended');
          this.status = {
            status: 'disconnected',
            configured: true
          };
        });
        
        // Start connection
        this.imap.connect();
      });
    } catch (error: any) {
      console.error('Error connecting to IMAP:', error);
      this.status = {
        status: 'disconnected',
        error: error.message,
        configured: true
      };
      return { success: false, error: `Error connecting to IMAP: ${error.message}` };
    }
  }

  /**
   * Check if connected to IMAP server
   */
  isConnected() {
    return this.imap?.state === 'authenticated';
  }

  /**
   * Get current status
   */
  getStatus(): ImapStatus {
    return this.status;
  }

  /**
   * Disconnect from the IMAP server
   */
  disconnect() {
    if (this.imap) {
      try {
        this.imap.end();
      } catch (error) {
        console.error('Error disconnecting from IMAP:', error);
      }
      this.imap = null;
    }
    this.status = {
      status: 'disconnected',
      configured: !!this.config
    };
  }

  /**
   * Fetch unread emails
   */
  async fetchUnreadEmails(callback: (emails: any[]) => Promise<void>) {
    if (!this.imap || !this.isConnected()) {
      console.error('Cannot fetch emails: Not connected to IMAP server');
      return { success: false, error: 'Not connected to IMAP server' };
    }

    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      try {
        this.imap!.openBox('INBOX', false, (err, box) => {
          if (err) {
            console.error('Error opening inbox:', err);
            return resolve({ success: false, error: `Error opening inbox: ${err.message}` });
          }

          // Search for unread emails
          this.imap!.search(['UNSEEN'], (searchErr, results) => {
            if (searchErr) {
              console.error('Error searching for unread emails:', searchErr);
              return resolve({ success: false, error: `Error searching emails: ${searchErr.message}` });
            }

            if (!results || results.length === 0) {
              console.log('No unread emails found');
              return resolve({ success: true });
            }

            console.log(`Found ${results.length} unread email(s)`);
            const emails: any[] = [];

            // Fetch emails with more complete headers for threading
            const f = this.imap!.fetch(results, {
              bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)', 'TEXT', ''],
              markSeen: false,
              struct: true
            });

            f.on('message', (msg, seqno) => {
              const email: any = {
                seqno,
                attributes: null,
                headers: null,
                body: ''
              };

              msg.on('body', (stream, info) => {
                let buffer = '';
                stream.on('data', (chunk) => {
                  buffer += chunk.toString('utf8');
                });

                stream.once('end', () => {
                  if (info.which === 'TEXT') {
                    email.body = buffer;
                  } else {
                    email.headers = buffer;
                  }
                });
              });

              msg.once('attributes', (attrs) => {
                email.attributes = attrs;
              });

              msg.once('end', () => {
                emails.push(email);
              });
            });

            f.once('error', (fetchErr) => {
              console.error('Error fetching emails:', fetchErr);
              resolve({ success: false, error: `Error fetching emails: ${fetchErr.message}` });
            });

            f.once('end', async () => {
              // Process emails
              const processedEmails: any[] = [];
              
              for (const email of emails) {
                try {
                  // Parse email headers
                  const headerInfo = await simpleParser(email.headers);
                  
                  // Try our enhanced MIME parser first for complex emails
                  // This handles multipart messages better, especially from Outlook
                  let fullEmail;
                  try {
                    // First try our specialized parser for complex MIME structures
                    fullEmail = await parseMimeContent(email.headers + '\r\n\r\n' + email.body);
                    console.log('Successfully parsed email using enhanced MIME parser');
                  } catch (parseError) {
                    // Fall back to simple parser if enhanced parser fails
                    console.warn('Enhanced MIME parser failed, falling back to simple parser:', parseError);
                    fullEmail = await simpleParser(email.headers + '\r\n\r\n' + email.body, {
                      keepCidLinks: true,
                      skipHtmlToText: false,
                      skipTextToHtml: false,
                      skipImageLinks: false
                    });
                  }
                  
                  // Combine header and body data with improved threading support
                  // Clean up content for better readability
                  let htmlContent = fullEmail.html;
                  let textContent = fullEmail.text;
                  
                  // Apply content cleaning for better formatting
                  if (htmlContent) {
                    htmlContent = cleanEmailContent(htmlContent);
                  }
                  if (textContent) {
                    textContent = cleanEmailContent(textContent);
                  }
                  
                  const processedEmail = {
                    messageId: fullEmail.messageId,
                    from: fullEmail.from,
                    to: fullEmail.to,
                    cc: fullEmail.cc,
                    subject: fullEmail.subject,
                    date: fullEmail.date,
                    text: textContent,
                    html: htmlContent,
                    attachments: fullEmail.attachments,
                    headers: fullEmail.headers,
                    inReplyTo: fullEmail.inReplyTo,
                    references: fullEmail.references,
                    uid: email.attributes?.uid,
                    seqno: email.seqno,
                    // Include raw MIME structure for debugging
                    raw: email.body
                  };
                  
                  processedEmails.push(processedEmail);
                } catch (parseErr) {
                  console.error('Error parsing email:', parseErr);
                }
              }

              if (processedEmails.length > 0) {
                // Call the callback with processed emails
                try {
                  await callback(processedEmails);
                  console.log(`Processed ${processedEmails.length} emails successfully`);
                } catch (callbackErr) {
                  console.error('Error in email processing callback:', callbackErr);
                }
              }

              resolve({ success: true });
            });
          });
        });
      } catch (error: any) {
        console.error('Error fetching unread emails:', error);
        resolve({ success: false, error: `Error fetching unread emails: ${error.message}` });
      }
    });
  }

  /**
   * Mark messages as seen
   * @param uids Array of UIDs to mark as seen
   */
  async markSeen(uids: number[]): Promise<boolean> {
    if (!this.imap || !this.isConnected()) {
      console.error('Cannot mark messages as seen: Not connected');
      return false;
    }

    return new Promise<boolean>((resolve) => {
      if (!this.imap) {
        console.error('IMAP object not available');
        resolve(false);
        return;
      }
      
      this.imap.setFlags(uids, ['\\Seen'], (err) => {
        if (err) {
          console.error('Error marking emails as seen:', err);
          resolve(false);
        } else {
          console.log(`Marked ${uids.length} emails as seen`);
          resolve(true);
        }
      });
    });
  }
}

// Export a singleton instance
export const imapService = new ImapService();
