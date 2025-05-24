/**
 * Clean Email Threading Implementation
 * 
 * This implements proper email threading using In-Reply-To and References headers
 * to prevent reply emails from creating new tickets.
 */

import { db } from './storage';
import { messages, tickets } from '../shared/schema';
import { eq } from 'drizzle-orm';

/**
 * Check if an incoming email is a reply to an existing conversation
 * Returns the ticket ID if this is a reply, null if it's a new conversation
 */
export async function findExistingConversation(
  messageId: string | null,
  inReplyTo: string | null, 
  references: string | null
): Promise<number | null> {
  
  console.log(`🔍 Checking if email is part of existing conversation:`);
  console.log(`  Message-ID: ${messageId}`);
  console.log(`  In-Reply-To: ${inReplyTo}`);
  console.log(`  References: ${references}`);
  
  // Step 1: Check In-Reply-To header first (highest priority)
  if (inReplyTo) {
    console.log(`📧 Checking In-Reply-To: ${inReplyTo}`);
    
    try {
      const existingMessage = await db.select({ ticketId: messages.ticketId })
        .from(messages)
        .where(eq(messages.messageId, inReplyTo))
        .limit(1);
        
      if (existingMessage.length > 0) {
        const ticketId = existingMessage[0].ticketId;
        console.log(`✅ Found existing conversation via In-Reply-To: Ticket #${ticketId}`);
        return ticketId;
      } else {
        console.log(`❌ No existing message found with Message-ID: ${inReplyTo}`);
      }
    } catch (error) {
      console.error('Error checking In-Reply-To:', error);
    }
  }
  
  // Step 2: Check References header (backup method)
  if (references) {
    console.log(`📧 Checking References: ${references}`);
    
    try {
      // Parse references - they can be space or newline separated
      const referencedIds = references
        .split(/[\s\n\r]+/)
        .map(id => id.trim())
        .filter(id => id.length > 0);
      
      console.log(`Found ${referencedIds.length} referenced message IDs`);
      
      // Check each referenced message ID
      for (const refId of referencedIds) {
        const existingMessage = await db.select({ ticketId: messages.ticketId })
          .from(messages)
          .where(eq(messages.messageId, refId))
          .limit(1);
          
        if (existingMessage.length > 0) {
          const ticketId = existingMessage[0].ticketId;
          console.log(`✅ Found existing conversation via References: Ticket #${ticketId} (Message-ID: ${refId})`);
          return ticketId;
        }
      }
      
      console.log(`❌ No existing messages found in References header`);
    } catch (error) {
      console.error('Error checking References:', error);
    }
  }
  
  console.log(`🆕 This appears to be a new conversation - will create new ticket`);
  return null;
}

/**
 * Add a message to an existing ticket
 */
export async function addMessageToExistingTicket(
  ticketId: number,
  content: string,
  sender: string,
  senderEmail: string,
  messageId: string | null,
  emailDate: Date
): Promise<void> {
  
  console.log(`📝 Adding reply message to existing ticket #${ticketId}`);
  
  try {
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
    
    // Update ticket's updatedAt timestamp
    await db.update(tickets)
      .set({ updatedAt: emailDate })
      .where(eq(tickets.id, ticketId));
    
    console.log(`✅ Successfully added reply to ticket #${ticketId}`);
    
  } catch (error) {
    console.error(`❌ Error adding message to ticket #${ticketId}:`, error);
    throw error;
  }
}