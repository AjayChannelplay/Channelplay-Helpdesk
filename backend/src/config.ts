/**
 * Email Configuration Settings
 * 
 * This file contains configuration settings for email services.
 * Values are read from environment variables where available,
 * otherwise defaults are used.
 */

// SMTP Configuration
export const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || '',
  port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  fromEmail: process.env.SMTP_FROM_EMAIL || '',
  fromName: process.env.SMTP_FROM_NAME || ''
};

// IMAP Configuration
export const IMAP_CONFIG = {
  host: process.env.IMAP_HOST || '',
  port: process.env.IMAP_PORT ? parseInt(process.env.IMAP_PORT) : 993,
  user: process.env.IMAP_USER || '',
  password: process.env.IMAP_PASSWORD || '',
  tls: process.env.IMAP_TLS !== 'false', // Default to true
  mailbox: process.env.IMAP_MAILBOX || 'INBOX'
};

// Email Domain Configuration
export const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN || '';

// Email Poll Frequency (milliseconds)
export const EMAIL_POLL_FREQUENCY = process.env.EMAIL_POLL_FREQUENCY 
  ? parseInt(process.env.EMAIL_POLL_FREQUENCY)
  : 300000; // Default: check every 5 minutes to reduce polling frequency

// Check if SMTP is configured
export function isSMTPConfigured(): boolean {
  return !!(SMTP_CONFIG.host && SMTP_CONFIG.user && SMTP_CONFIG.pass);
}

// Check if IMAP is configured
export function isIMAPConfigured(): boolean {
  return !!(IMAP_CONFIG.host && IMAP_CONFIG.user && IMAP_CONFIG.password);
}

// Helper for full email address format
export function formatEmailAddress(name: string, email: string): string {
  if (!email.includes('@')) {
    email = `${email}@${EMAIL_DOMAIN}`;
  }
  return `${name} <${email}>`;
}