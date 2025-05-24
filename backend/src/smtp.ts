/**
 * SMTP Service
 * 
 * This module provides SMTP email sending functionality using nodemailer
 */

import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

class SMTPService {
  private transporter: Transporter | null = null;
  private isConfigured: boolean = false;
  private config: any = null;

  /**
   * Configure the SMTP service with credentials
   */
  configure(config: nodemailer.TransportOptions): void {
    try {
      this.transporter = nodemailer.createTransport(config);
      this.config = config;
      this.isConfigured = true;
      console.log('SMTP service configured successfully');
    } catch (error) {
      console.error('Error configuring SMTP service:', error);
      this.isConfigured = false;
    }
  }

  /**
   * Send an email
   */
  async sendEmail(options: {
    from: string | { name: string; address: string };
    to: string | string[];
    cc?: string | string[];
    bcc?: string | string[];
    subject: string;
    text?: string;
    html?: string;
    auth?: { user: string; pass: string };
    attachments?: any[];
    headers?: any;
    messageId?: string;
    inReplyTo?: string;
    references?: string;
  }): Promise<{ success: boolean; error?: string; messageId?: string }> {
    if (!this.isConfigured || !this.transporter) {
      return { 
        success: false, 
        error: 'SMTP service not configured' 
      };
    }

    try {
      const result = await this.transporter.sendMail(options);
      console.log('Email sent successfully:', result.messageId);
      return { 
        success: true, 
        messageId: result.messageId 
      };
    } catch (error: any) {
      console.error('Error sending email:', error);
      return { 
        success: false, 
        error: error.message || 'Unknown error sending email' 
      };
    }
  }

  /**
   * Verify connection to SMTP server
   */
  async verifyConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured || !this.transporter) {
      return { 
        success: false, 
        error: 'SMTP service not configured' 
      };
    }

    try {
      await this.transporter.verify();
      return { success: true };
    } catch (error: any) {
      return { 
        success: false, 
        error: error.message || 'Unknown error verifying connection' 
      };
    }
  }

  /**
   * Get the current status of the SMTP service
   */
  getStatus(): { configured: boolean; host?: string; user?: string } {
    if (!this.isConfigured || !this.config) {
      return { configured: false };
    }

    return {
      configured: true,
      host: this.config.host,
      user: this.config.auth?.user
    };
  }
}

// Create a singleton instance
export const smtpService = new SMTPService();