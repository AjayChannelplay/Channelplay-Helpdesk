/**
 * Simple Email Threading Implementation
 * 
 * Implements the exact logic you outlined:
 * - Check In-Reply-To header to see if email is replying to existing message
 * - If match found, add to existing ticket instead of creating new one
 */

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { eq } from 'drizzle-orm';
import { messages, tickets } from '../database/schema';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

/**
 * Check if incoming email is a reply to existing conversation
 * Returns ticket ID if reply, null if new conversation
 */
export async function checkIfReply(inReplyTo: string | null, references: string | null): Promise<number | null> {
  
  // Step 1: Check In-Reply-To header (highest priority)
  if (inReplyTo) {
    console.log(`🔍 Checking In-Reply-To: ${inReplyTo}`);
    
    const existingMessage = await db.select({ ticketId: messages.ticketId })
      .from(messages)
      .where(eq(messages.messageId, inReplyTo))
      .limit(1);
      
    if (existingMessage.length > 0) {
      console.log(`✅ Found existing ticket #${existingMessage[0].ticketId} via In-Reply-To`);
      return existingMessage[0].ticketId;
    }
  }
  
  // Step 2: Check References header as backup
  if (references) {
    console.log(`🔍 Checking References: ${references}`);
    
    const referencedIds = references.split(/\s+/).filter(id => id.trim().length > 0);
    
    for (const refId of referencedIds) {
      const existingMessage = await db.select({ ticketId: messages.ticketId })
        .from(messages)
        .where(eq(messages.messageId, refId.trim()))
        .limit(1);
        
      if (existingMessage.length > 0) {
        console.log(`✅ Found existing ticket #${existingMessage[0].ticketId} via References`);
        return existingMessage[0].ticketId;
      }
    }
  }
  
  console.log(`🆕 This is a new conversation`);
  return null;
}

/**
 * Add reply message to existing ticket
 */
export async function addReplyToTicket(
  ticketId: number,
  content: string,
  sender: string,
  senderEmail: string,
  messageId: string | null,
  emailDate: Date
): Promise<void> {
  
  console.log(`📝 Adding reply to ticket #${ticketId}`);
  
  await db.insert(messages).values({
    ticketId: ticketId,
    content: content,
    sender: sender,
    senderEmail: senderEmail,
    isAgent: false,
    messageId: messageId,
    createdAt: emailDate,
    isSatisfactionResponse: false,
    satisfactionRating: null,
    ccRecipients: [],
    attachments: []
  });
  
  // Update ticket timestamp
  await db.update(tickets)
    .set({ updatedAt: emailDate })
    .where(eq(tickets.id, ticketId));
  
  console.log(`✅ Reply added to ticket #${ticketId}`);
}