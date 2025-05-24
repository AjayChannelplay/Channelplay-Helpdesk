/**
 * Email Sender Helper
 * 
 * This module ensures all emails are sent with proper sender configuration,
 * prioritizing Gmail SMTP settings for all outgoing messages.
 */

import { storage } from './storage';

// Configuration for preferred email sender
const DEFAULT_GMAIL = 'ajaykumar23aps@gmail.com';
const DEFAULT_NAME = 'Gmail Support';

/**
 * Get the preferred sender email address to use for all outgoing emails
 * Prioritizes Gmail SMTP configuration over any other settings
 */
export async function getPreferredSenderEmail(): Promise<{ email: string; name: string }> {
  try {
    // Try to get a desk with Gmail SMTP configuration
    const desks = await storage.getDesks();
    
    // First look for Gmail desk with SMTP configured
    const gmailDesk = desks.find(desk => 
      desk.smtpHost && 
      desk.smtpHost.includes('gmail.com') &&
      desk.smtpUser && 
      desk.smtpUser.toLowerCase().includes('@gmail.com')
    );
    
    if (gmailDesk && gmailDesk.smtpUser) {
      console.log(`📧 Using Gmail desk configuration: ${gmailDesk.name} <${gmailDesk.smtpUser}>`);
      return {
        email: gmailDesk.smtpUser,
        name: gmailDesk.name || DEFAULT_NAME
      };
    }
    
    // Second best option: Any desk with SMTP configured
    const smtpDesk = desks.find(desk => 
      desk.smtpHost && 
      desk.smtpUser &&
      desk.smtpPassword
    );
    
    if (smtpDesk && smtpDesk.smtpUser) {
      console.log(`📧 Using SMTP desk configuration: ${smtpDesk.name} <${smtpDesk.smtpUser}>`);
      return {
        email: smtpDesk.smtpUser,
        name: smtpDesk.name || 'Support Desk'
      };
    }
    
    // Fallback to default Gmail
    console.log(`📧 Using default Gmail configuration: ${DEFAULT_NAME} <${DEFAULT_GMAIL}>`);
    return {
      email: DEFAULT_GMAIL,
      name: DEFAULT_NAME
    };
  } catch (error) {
    console.error('Error getting preferred sender email:', error);
    return {
      email: DEFAULT_GMAIL,
      name: DEFAULT_NAME
    };
  }
}

/**
 * Format an email address with proper display name
 */
export function formatEmailAddress(name: string, email: string): string {
  return `${name} <${email}>`;
}

/**
 * Get the proper from address to use in all emails
 */
export async function getFromAddress(): Promise<string> {
  const sender = await getPreferredSenderEmail();
  return formatEmailAddress(sender.name, sender.email);
}