/**
 * Simple Email Threading Logic
 * 
 * This module provides simple, reliable email threading for replies
 */

import { db } from './db';
import { tickets, messages } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';

/**
 * Check if an email is a reply and find the original ticket
 */
export async function findOriginalTicket(
  subject: string | null,
  customerEmail: string | null
): Promise<number | null> {
  if (!subject || !customerEmail) return null;
  
  // Check if this looks like a reply
  if (!subject.toLowerCase().startsWith('re:')) {
    return null;
  }
  
  // Remove "Re:" prefix to find original subject
  let originalSubject = subject.replace(/^re:\s*/i, '').trim();
  
  // Remove additional "Re:" prefixes if nested
  while (originalSubject.toLowerCase().startsWith('re:')) {
    originalSubject = originalSubject.replace(/^re:\s*/i, '').trim();
  }
  
  console.log(`Looking for original ticket: "${originalSubject}" from ${customerEmail}`);
  
  try {
    // Find ticket with matching subject and customer
    const originalTickets = await db.select({ id: tickets.id })
      .from(tickets)
      .where(and(
        eq(tickets.subject, originalSubject),
        eq(tickets.customerEmail, customerEmail)
      ))
      .orderBy(desc(tickets.createdAt))
      .limit(1);
    
    if (originalTickets.length > 0) {
      console.log(`✅ Found original ticket #${originalTickets[0].id}`);
      return originalTickets[0].id;
    }
    
    console.log(`❌ No original ticket found for "${originalSubject}"`);
    return null;
  } catch (error) {
    console.error('Error finding original ticket:', error);
    return null;
  }
}