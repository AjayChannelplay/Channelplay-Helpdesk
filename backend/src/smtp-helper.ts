/**
 * SMTP Helper
 * 
 * This module provides direct SMTP email functionality using nodemailer
 * with desk-specific configurations to ensure proper sender display
 */

import * as nodemailer from 'nodemailer';
import { storage } from './services/storage';
import SMTPTransport from 'nodemailer/lib/smtp-transport';

/**
 * Send an email directly using the desk's SMTP configuration
 * 
 * @param options Email options
 * @param deskId The ID of the desk to use for SMTP configuration
 * @returns Success status and error message if applicable
 */
export async function sendDirectEmail(
  options: {
    from: string | { name: string; address: string };
    to: string | string[];
    cc?: string | string[];
    subject: string;
    text?: string;
    html?: string;
    headers?: Record<string, string>;
    attachments?: any[];
  },
  deskId: number
): Promise<{ 
  success: boolean; 
  error?: string; 
  messageId?: string;
  response?: string;
}> {
  try {
    // Get desk SMTP configuration
    const desk = await storage.getDeskById(deskId);
    
    if (!desk || !desk.smtpUser || !desk.smtpPassword) {
      return { 
        success: false, 
        error: 'Desk SMTP configuration not available' 
      };
    }
    
    // Determine if we're using Gmail based on the SMTP host
    const isGmail = (desk.smtpHost || '').includes('gmail.com');

    // Create transporter with proper SMTP settings
    // IMPORTANT: Using explicit host/port configuration instead of 'service: gmail'
    // which can sometimes have delivery issues
    const transport = {
      host: desk.smtpHost || 'smtp.gmail.com',
      port: Number(desk.smtpPort) || 587,
      // For Gmail, do NOT set secure:true for port 587 (it uses STARTTLS instead of TLS)
      secure: desk.smtpPort === '465', 
      auth: {
        user: desk.smtpUser,
        pass: desk.smtpPassword
      },
      // Gmail specific settings for improved deliverability
      tls: {
        // Do not fail on invalid certs
        rejectUnauthorized: false
      },
      // When using port 587, we need to upgrade to TLS after connecting
      // This is the standard way Gmail accepts connections
      requireTLS: isGmail ? true : undefined,
      opportunisticTLS: true,
      // Enable debug output with detailed logs to diagnose delivery issues
      debug: true,
      logger: true,
      // Add priority and timeout settings
      priority: 'high',
      connectionTimeout: 30000, // 30 seconds
      greetingTimeout: 30000,    // 30 seconds
      socketTimeout: 60000      // 60 seconds
    };
    
    console.log(`📧 Using SMTP server ${desk.smtpHost}:${desk.smtpPort} for delivery with user ${desk.smtpUser}`);
    const transporter = nodemailer.createTransport(transport as SMTPTransport.Options);
    
    // CRITICAL FIX: The key to preventing "via" text is to use the same email address
    // for both the from field and the SMTP authentication, AND to use object format
    // If options.from is already an object, respect that format, otherwise use desk configuration
    let formattedFrom: { name: string; address: string };
    
    if (typeof options.from === 'object' && options.from.address) {
      // Already in proper format, use as is - this is what email-direct.ts passes
      formattedFrom = options.from as { name: string; address: string };
      
      // CRITICAL: Verify the from address matches the SMTP user
      // This is essential for both deliverability and preventing "via" text
      if (formattedFrom.address !== desk.smtpUser) {
        console.warn(`⚠️ WARNING: From address (${formattedFrom.address}) doesn't match SMTP user (${desk.smtpUser})`);
        console.warn(`⚠️ This may cause emails to show "via helpdesk.1office.in" or fail delivery`);
        
        // Force the address to match SMTP user while keeping the display name
        formattedFrom.address = desk.smtpUser;
        console.log(`✅ Corrected from address to match SMTP user: ${formattedFrom.address}`);
      }
    } else {
      // Convert string format to object format or use default values
      const senderName = desk.smtpFromName || desk.name || 'Support';
      const senderEmail = desk.smtpUser; // MUST match SMTP authentication
      
      formattedFrom = {
        name: senderName,
        address: senderEmail
      };
      
      console.log(`✅ Formatted sender as object: ${senderName} <${senderEmail}>`);
    }
    
    // Special headers that help improve Gmail deliverability
    const customHeaders: Record<string, string> = {
      'X-Priority': '1',
      'Reply-To': formattedFrom.address,
      'Sender': formattedFrom.address, // CRITICAL: This header ensures the sender matches SMTP auth
      'Message-ID': options.headers?.['Message-ID'] || `<${Math.random().toString(36).substring(2, 15)}-${Date.now()}@${formattedFrom.address.split('@')[1]}>`,
      'X-Auto-Response-Suppress': 'OOF, DR, RN, NRN, AutoReply', // Prevent auto-responder loops
      'Precedence': 'bulk', // Improve deliverability for bulk mail
      ...(options.headers || {})
    };
    
    // First, verify the transporter works
    try {
      // Test SMTP connection before attempting to send
      const verifyResult = await transporter.verify();
      console.log(`📧 SMTP connection verification result: ${verifyResult}`);
    } catch (verifyError: any) {
      console.error(`❌ SMTP connection verification failed: ${verifyError.message}`);
      return {
        success: false,
        error: `SMTP connection failed: ${verifyError.message}`
      };
    }
    
    // Log complete email data for debugging (excluding attachments)
    console.log(`📧 Sending email with data:`, {
      from: formattedFrom,
      to: options.to,
      cc: options.cc,
      subject: options.subject,
      headers: customHeaders,
      attachmentsCount: options.attachments?.length || 0
    });
    
    // Enhanced logging to diagnose delivery issues
    console.log(`📧 Preparing to send email with following configuration:`);
    console.log(`   From: ${formattedFrom.name} <${formattedFrom.address}>`);
    console.log(`   To: ${typeof options.to === 'string' ? options.to : (options.to || []).join(', ')}`);
    console.log(`   Subject: ${options.subject}`);
    console.log(`   Headers: ${Object.keys(customHeaders).join(', ')}`);
    
    // CRITICAL FIX: Verify that the from field exactly matches SMTP auth user
    // This is the key to both deliverability and preventing "via helpdesk" text
    if (formattedFrom.address !== desk.smtpUser) {
      console.warn(`⚠️ Critical mismatch: From address (${formattedFrom.address}) doesn't match SMTP user (${desk.smtpUser})`);
      // Force correction - this ensures proper delivery
      formattedFrom.address = desk.smtpUser;
    }
    
    // Send mail with proper settings 
    const info = await transporter.sendMail({
      from: formattedFrom,         // Must match SMTP auth user email
      to: options.to,              // Recipient(s)
      cc: options.cc,              // CC recipient(s)
      subject: options.subject,    // Subject
      text: options.text || '',    // Plain text
      html: options.html,          // HTML version (optional)
      headers: customHeaders,      // Custom headers
      attachments: options.attachments, // Optional attachments
      // Apply the same enhanced settings used in the test email function
      priority: 'high'
    });
    
    if (info) {
      console.log(`📧 Email sent successfully. Response:`, {
        messageId: info.messageId || 'none',
        response: info.response || 'no response',
        accepted: info.accepted || [],
        rejected: info.rejected || [],
        envelope: info.envelope || {}
      });
      
      // If we have no rejected recipients and at least one accepted recipient, consider it a success
      if ((!info.rejected || info.rejected.length === 0) && 
          (info.accepted && info.accepted.length > 0)) {
        return {
          success: true,
          messageId: info.messageId || 'no-message-id',
          response: info.response
        };
      } else if (info.rejected && info.rejected.length > 0) {
        // If some recipients were rejected, report as error
        return {
          success: false,
          error: `Email rejected for recipients: ${info.rejected.join(', ')}`,
          response: info.response
        };
      } else {
        // Something unexpected happened
        return {
          success: false,
          error: `Email delivery status unknown: ${info.response || 'No response from SMTP server'}`,
          response: info.response
        };
      }
    } else {
      console.log('❌ No information returned from SMTP server');
      return {
        success: false,
        error: 'No information returned from SMTP server'
      };
    }
  } catch (error: any) {
    console.error('Error sending email via Gmail:', error);
    return {
      success: false,
      error: error.message || 'Unknown error sending email'
    };
  }
}