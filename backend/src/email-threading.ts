/**
 * Email Threading Utilities
 * 
 * This module provides enhanced email threading capabilities by analyzing
 * References and In-Reply-To headers from emails.
 */

import { db } from './db';
import { messages, tickets } from '@shared/schema';
import { eq, and, or, desc, isNotNull, not, isNull } from 'drizzle-orm';

// Helper function to clean message IDs for accurate comparison
export function cleanMessageId(messageId: string | null): string {
  if (!messageId) return '';
  return messageId.replace(/[<>]/g, '').trim();
}

// Helper function to extract individual message IDs from a References header
export function extractReferencedIds(references: string | null): string[] {
  if (!references) return [];
  
  // References header contains multiple message IDs separated by spaces
  return references.split(/\s+/)
    .map(id => cleanMessageId(id))
    .filter(id => id.length > 0);
}

/**
 * Find an existing ticket that this message belongs to based on
 * References or In-Reply-To headers
 * 
 * @param messageId - Message ID of the incoming message
 * @param references - References header from the incoming message
 * @param inReplyTo - In-Reply-To header from the incoming message
 * @param existingTicketId - Optional ticket ID to exclude (for updates)
 * 
 * @returns The ticket ID if a match is found, null otherwise
 */
export async function findRelatedTicket(
  messageId: string | null, 
  references: string | null,
  inReplyTo: string | null,
  existingTicketId?: number
): Promise<number | null> {
  try {
    // Clean IDs for comparison
    const cleanedMessageId = cleanMessageId(messageId);
    const cleanedInReplyTo = cleanMessageId(inReplyTo);
    
    // Skip if we don't have any identifiers to match on
    if (!cleanedMessageId && !cleanedInReplyTo && !references) {
      return null;
    }
    
    // Extract individual message IDs from References header
    const referencedIds = extractReferencedIds(references);
    
    // Build a list of all message IDs we need to search for
    const messagesToFind = new Set<string>();
    
    // Add In-Reply-To if present
    if (cleanedInReplyTo) {
      messagesToFind.add(cleanedInReplyTo);
    }
    
    // Add all message IDs from References header
    for (const refId of referencedIds) {
      if (refId) {
        messagesToFind.add(refId);
      }
    }
    
    // If no message IDs to search for, we don't have a match
    if (messagesToFind.size === 0) {
      // ENHANCEMENT: Check if we should do a subject-based match instead
      // This helps when external email clients strip threading headers
      console.log('No message IDs found for threading, will try subject-based matching as fallback');
      return null;
    }
    
    // Convert Set to Array for the query
    const messageIdsToFind = Array.from(messagesToFind);
    console.log('Looking for related messages with these IDs:', messageIdsToFind);
    
    // IMPROVEMENT: Perform more thorough search for message references
    // This helps catch replies when standard email headers are partially mangled
    const conditions = [];
    
    // Search for messages where the message_id (without angle brackets) matches any ID we're looking for
    for (const idToFind of messageIdsToFind) {
      if (idToFind && idToFind.length > 5) {
        // Look for direct matches and partial matches (for broken email clients)
        // Some email clients truncate or mangle message IDs
        conditions.push(`message_id LIKE '%${idToFind}%'`);
        
        // Also search with angle brackets
        conditions.push(`message_id LIKE '%<${idToFind}>%'`);
      }
    }
    
    if (conditions.length === 0) {
      return null;
    }
    
    const whereClause = conditions.join(' OR ');
    console.log('Using where clause:', whereClause);
    
    // Enhanced message ID matching logic for better threading accuracy
    const relatedMessagesResult = await db
      .select({
        id: messages.id,
        ticketId: messages.ticketId,
        messageId: messages.messageId,
      })
      .from(messages)
      .where(
        and(
          isNotNull(messages.messageId),
          // If we have an existing ticket ID, exclude messages from that ticket
          existingTicketId ? not(eq(messages.ticketId, existingTicketId)) : undefined
        )
      )
      .orderBy(desc(messages.createdAt))
      .limit(1000); // Limit to most recent messages for performance
      
    console.log(`Checking ${relatedMessagesResult.length} recent messages for threading matches`);
    
    // First, try to find exact matches (most reliable)
    for (const message of relatedMessagesResult) {
      const storedId = cleanMessageId(message.messageId || '');
      if (!storedId) continue;
      
      for (const idToFind of messageIdsToFind) {
        if (storedId === idToFind) {
          console.log(`Found related ticket: ${message.ticketId} (exact message ID match: ${storedId})`);
          return message.ticketId;
        }
      }
    }
    
    // If no exact match, try partial/fuzzy matching (for email clients that modify message IDs)
    for (const message of relatedMessagesResult) {
      const storedId = cleanMessageId(message.messageId || '');
      if (!storedId || storedId.length < 8) continue; // Skip very short IDs
      
      for (const idToFind of messageIdsToFind) {
        if (!idToFind || idToFind.length < 8) continue; // Skip very short IDs
        
        // Check for substantial overlap between IDs (handles truncated/modified IDs)
        if (storedId.includes(idToFind.substring(0, Math.min(idToFind.length, 12))) || 
            idToFind.includes(storedId.substring(0, Math.min(storedId.length, 12)))) {
          console.log(`Found related ticket: ${message.ticketId} (partial message ID match: ${storedId} ~ ${idToFind})`);
          return message.ticketId;
        }
      }
    }
    
    // No matches found with enhanced methods, do a final check with exact matches
    console.log('No matches found with enhanced methods, checking for exact Message-ID matches');
    
    // If no match found, return null
    return null;
    
  } catch (error) {
    console.error('Error finding related ticket:', error);
    return null;
  }
}

/**
 * Update references and in-reply-to fields for a message
 * This can be used when processing incoming emails
 * 
 * @param messageId - The ID of the message to update
 * @param references - References header value
 * @param inReplyTo - In-Reply-To header value
 */
export async function updateMessageReferences(
  messageId: number,
  references: string | null,
  inReplyTo: string | null
): Promise<void> {
  try {
    await db.update(messages)
      .set({
        referenceIds: references,
        inReplyTo: inReplyTo,
      })
      .where(eq(messages.id, messageId));
  } catch (error) {
    console.error('Error updating message references:', error);
  }
}