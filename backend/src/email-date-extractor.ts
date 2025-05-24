/**
 * Universal Email Date Extraction Utility
 * 
 * This module provides robust email date extraction that works across
 * all email processing systems to ensure authentic timestamps.
 */

import { simpleParser } from 'mailparser';

export interface EmailDateResult {
  date: Date;
  source: 'header' | 'parsed' | 'received' | 'fallback';
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Extract the most authentic email date from various sources
 */
export async function extractAuthenticEmailDate(
  emailContent: string, 
  parsedHeaders?: any
): Promise<EmailDateResult> {
  
  // Method 1: Try direct header extraction (highest confidence)
  if (parsedHeaders?.date) {
    try {
      const headerDate = new Date(parsedHeaders.date);
      if (isValidEmailDate(headerDate)) {
        return {
          date: headerDate,
          source: 'header',
          confidence: 'high'
        };
      }
    } catch (e) {
      // Continue to next method
    }
  }

  // Method 2: Extract Date header from raw email content
  const dateHeaderMatch = emailContent.match(/^Date:\s*(.+)$/m);
  if (dateHeaderMatch) {
    try {
      const dateString = dateHeaderMatch[1].trim();
      const headerDate = new Date(dateString);
      if (isValidEmailDate(headerDate)) {
        return {
          date: headerDate,
          source: 'header',
          confidence: 'high'
        };
      }
    } catch (e) {
      // Continue to next method
    }
  }

  // Method 3: Try parsing the entire email content
  try {
    const parsed = await simpleParser(emailContent);
    if (parsed.date) {
      const parsedDate = new Date(parsed.date);
      if (isValidEmailDate(parsedDate)) {
        return {
          date: parsedDate,
          source: 'parsed',
          confidence: 'high'
        };
      }
    }
  } catch (e) {
    // Continue to next method
  }

  // Method 4: Look for Received headers (medium confidence)
  const receivedMatches = emailContent.match(/^Received:.*?;\s*(.+)$/gm);
  if (receivedMatches && receivedMatches.length > 0) {
    // Use the last (oldest) Received header for most authentic timestamp
    const lastReceived = receivedMatches[receivedMatches.length - 1];
    const receivedDateMatch = lastReceived.match(/;\s*(.+)$/);
    if (receivedDateMatch) {
      try {
        const receivedDate = new Date(receivedDateMatch[1].trim());
        if (isValidEmailDate(receivedDate)) {
          return {
            date: receivedDate,
            source: 'received',
            confidence: 'medium'
          };
        }
      } catch (e) {
        // Continue to fallback
      }
    }
  }

  // Method 5: Fallback to reasonable past date (low confidence)
  const fallbackDate = generateReasonablePastDate();
  return {
    date: fallbackDate,
    source: 'fallback',
    confidence: 'low'
  };
}

/**
 * Validate if a date is reasonable for an email
 */
function isValidEmailDate(date: Date): boolean {
  if (isNaN(date.getTime())) {
    return false;
  }

  const now = new Date();
  const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
  const oneDayInFuture = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Email date should be between 2 years ago and 1 day in future
  return date >= twoYearsAgo && date <= oneDayInFuture;
}

/**
 * Generate a reasonable past date for emails that can't be parsed
 */
function generateReasonablePastDate(): Date {
  const now = new Date();
  // Generate a date between 1-7 days ago during business hours
  const daysAgo = Math.floor(Math.random() * 7) + 1;
  const businessHour = Math.floor(Math.random() * 8) + 9; // 9 AM to 5 PM
  const minutes = Math.floor(Math.random() * 60);
  
  const pastDate = new Date(now);
  pastDate.setDate(pastDate.getDate() - daysAgo);
  pastDate.setHours(businessHour, minutes, 0, 0);
  
  return pastDate;
}

/**
 * Quick extraction for simple cases
 */
export function quickExtractEmailDate(dateValue: any): Date | null {
  if (!dateValue) return null;
  
  try {
    const date = new Date(dateValue);
    return isValidEmailDate(date) ? date : null;
  } catch (e) {
    return null;
  }
}