/**
 * IMAP Service
 * 
 * This module provides IMAP email fetching functionality
 */

import * as Imap from 'imap';
import { simpleParser } from 'mailparser';
import { Readable } from 'stream';

type EmailCallback = (error: Error | null, email: any | null) => void;

class IMAPService {
  private imap: Imap | null = null;
  private isConfigured: boolean = false;
  private config: any = null;
  private isConnected: boolean = false;
  private connectionAttempts: number = 0;
  private maxConnectionAttempts: number = 5;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  /**
   * Configure the IMAP service with credentials
   */
  configure(config: Imap.Config): void {
    try {
      // Close existing connection if any
      if (this.imap && this.isConnected) {
        this.imap.end();
      }
      
      this.imap = new Imap(config);
      this.config = config;
      this.isConfigured = true;
      this.connectionAttempts = 0;
      console.log('IMAP service configured successfully');
    } catch (error) {
      console.error('Error configuring IMAP service:', error);
      this.isConfigured = false;
    }
  }

  /**
   * Connect to the IMAP server
   */
  connect(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.isConfigured || !this.imap) {
        reject(new Error('IMAP service not configured'));
        return;
      }

      if (this.isConnected) {
        resolve(true);
        return;
      }

      this.connectionAttempts++;

      // Set up event handlers
      this.imap.once('ready', () => {
        console.log('IMAP connection ready');
        this.isConnected = true;
        this.connectionAttempts = 0;
        resolve(true);
      });

      this.imap.once('error', (err: Error) => {
        console.error('IMAP connection error:', err);
        this.isConnected = false;

        if (this.connectionAttempts < this.maxConnectionAttempts) {
          console.log(`Retrying IMAP connection (attempt ${this.connectionAttempts}/${this.maxConnectionAttempts})...`);
          
          // Clear any existing reconnect timeout
          if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
          }
          
          // Set up a new reconnect timeout
          this.reconnectTimeout = setTimeout(() => {
            this.connect().catch(() => {
              // Ignore reconnection errors here, they will be handled in the next attempt
            });
          }, 5000); // 5-second delay before reconnecting
        }

        reject(err);
      });

      this.imap.once('end', () => {
        console.log('IMAP connection ended');
        this.isConnected = false;
      });

      // Attempt connection
      try {
        this.imap.connect();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Fetch unread emails from the inbox
   */
  async fetchUnreadEmails(callback: (emails: any[]) => void): Promise<boolean> {
    if (!this.isConfigured || !this.imap) {
      return false;
    }

    try {
      // Connect if not already connected
      if (!this.isConnected) {
        await this.connect();
      }

      this.imap!.openBox('INBOX', false, (err, box) => {
        if (err) {
          console.error('Error opening inbox:', err);
          return;
        }

        // Search for unread messages
        this.imap!.search(['UNSEEN'], (err, results) => {
          if (err) {
            console.error('Error searching for unread messages:', err);
            return;
          }

          if (!results || results.length === 0) {
            // No unread messages found
            callback([]);
            return;
          }

          console.log(`Found ${results.length} unread messages`);

          // Fetch the messages
          const f = this.imap!.fetch(results, {
            bodies: '',
            markSeen: true
          });

          const emails: any[] = [];

          f.on('message', (msg, seqno) => {
            msg.on('body', (stream, info) => {
              this.parseEmail(stream, (error, email) => {
                if (error) {
                  console.error('Error parsing email:', error);
                  return;
                }

                if (email) {
                  emails.push(email);
                }
              });
            });

            msg.on('attributes', (attrs) => {
              // Store UID for future reference if needed
              console.log(`Message #${seqno} has UID: ${attrs.uid}`);
            });
          });

          f.once('error', (err) => {
            console.error('Fetch error:', err);
          });

          f.once('end', () => {
            console.log('Done fetching all messages');
            callback(emails);
          });
        });
      });

      return true;
    } catch (error) {
      console.error('Error fetching unread emails:', error);
      return false;
    }
  }

  /**
   * Parse an email from a readable stream
   */
  private parseEmail(stream: Readable, callback: EmailCallback): void {
    let buffer = '';

    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
    });

    stream.once('end', () => {
      // Parse the email
      simpleParser(buffer)
        .then((mail) => {
          callback(null, mail);
        })
        .catch((error) => {
          callback(error, null);
        });
    });
  }

  /**
   * Get the current status of the IMAP service
   */
  getStatus(): { configured: boolean; connected: boolean; host?: string; user?: string } {
    if (!this.isConfigured || !this.config) {
      return { configured: false, connected: false };
    }

    return {
      configured: true,
      connected: this.isConnected,
      host: this.config.host,
      user: this.config.user
    };
  }
}

// Create a singleton instance
export const imapService = new IMAPService();