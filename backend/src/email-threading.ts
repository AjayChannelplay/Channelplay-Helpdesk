/**
 * Email Threading Utilities
 * 
 * This module provides enhanced email threading capabilities by analyzing
 * References and In-Reply-To headers from emails.
 */

import { db } from './db';
import { messages, tickets } from '@shared/schema';
import { eq, and, or, desc, isNotNull, not, isNull, sql } from 'drizzle-orm';

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
 * Find an existing ticket that this message belongs to based on multiple matching methods:
 * 1. Direct DB query to match in_reply_to with message_id
 * 2. Standard email threading headers (References, In-Reply-To)
 * 3. Subject matching (removing Re:, Fwd: prefixes)
 * 4. Sender email matching with existing ticket customer
 * 
 * @param messageId - Message ID of the incoming message
 * @param references - References header from the incoming message
 * @param inReplyTo - In-Reply-To header from the incoming message
 * @param subject - Email subject for subject-based matching
 * @param senderEmail - Sender email for customer-based matching
 * @param existingTicketId - Optional ticket ID to exclude (for updates)
 * 
 * @returns The ticket ID if a match is found, null otherwise
 */
export async function findRelatedTicket(
  messageId: string | null, 
  references: string | null,
  inReplyTo: string | null,
  subject?: string | null,
  senderEmail?: string | null,
  existingTicketId?: number
): Promise<number | null> {
  try {
    // Clean IDs for comparison
    const cleanedMessageId = cleanMessageId(messageId);
    const cleanedInReplyTo = cleanMessageId(inReplyTo);
    
    // Method 1: Direct DB query to match inReplyTo with message_id (most reliable method)
    // This handles the case where a reply properly sets the In-Reply-To header
    if (cleanedInReplyTo && cleanedInReplyTo.length > 5) {
      console.log(`Searching for messages with message_id matching in-reply-to: ${cleanedInReplyTo}`);
      
      // Direct SQL query for exact and partial matches on message_id
      const directMatches = await db.execute(
        sql`SELECT m.id, m.ticket_id, m.message_id 
            FROM messages m 
            WHERE m.message_id IS NOT NULL 
            AND (
              m.message_id = ${cleanedInReplyTo} OR 
              m.message_id = ${'<' + cleanedInReplyTo + '>'} OR 
              m.message_id LIKE ${'%' + cleanedInReplyTo + '%'}
            ) 
            ${existingTicketId ? sql`AND m.ticket_id != ${existingTicketId}` : sql``} 
            ORDER BY m.created_at DESC 
            LIMIT 10`
      );
      
      // Check if we have matches and if they are properly formed
      if (directMatches && Array.isArray(directMatches) && directMatches.length > 0 && directMatches[0].ticket_id) {
        const match = directMatches[0];
        console.log(`Found direct match! Ticket ID: ${match.ticket_id}, Message ID: ${match.message_id}`);
        return match.ticket_id;
      }
    }
    
    // Skip if we don't have any identifiers to match on
    if (!cleanedMessageId && !cleanedInReplyTo && !references) {
      return null;
    }
    
    // Method 2: References header lookup
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
    
    // Convert Set to Array for the query
    const messageIdsToFind = Array.from(messagesToFind);
    
    if (messageIdsToFind.length > 0) {
      console.log('Looking for related messages with these IDs:', messageIdsToFind);
      
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
    }
    
    // Method 3: Subject and sender-based matching (fallback method)
    console.log('No matches found with ID-based methods, trying subject-based matching');
    
    if (subject && subject.length > 5) {
      // Clean up the subject to remove reply prefixes
      const cleanSubject = subject.replace(/^(re|fwd|fw|)\s*:\s*/i, '').trim();
      
      if (cleanSubject.length > 5) {
        console.log(`Trying to match on subject: "${cleanSubject}"`);
        
        // Find tickets with a matching subject
        const subjectMatchedTickets = await db
          .select({
            id: tickets.id,
            subject: tickets.subject,
            customerEmail: tickets.customerEmail,
          })
          .from(tickets)
          .where(
            and(
              // Find tickets where the subject contains the cleaned subject
              // or the cleaned subject contains the ticket subject
              or(
                sql`LOWER(${tickets.subject}) LIKE LOWER('%${cleanSubject}%')`,
                sql`LOWER('${cleanSubject}') LIKE LOWER(CONCAT('%', ${tickets.subject}, '%'))`
              ),
              // Don't match if we already have an existingTicketId
              existingTicketId ? not(eq(tickets.id, existingTicketId)) : undefined
            )
          )
          .orderBy(desc(tickets.updatedAt))
          .limit(10); // Get recent tickets with similar subjects
        
        console.log(`Found ${subjectMatchedTickets.length} tickets with similar subjects`);
        
        // Check if any of the subject-matched tickets also match the sender
        if (senderEmail && subjectMatchedTickets.length > 0) {
          for (const ticket of subjectMatchedTickets) {
            // If the sender email matches the customer email on the ticket, this is likely a reply
            if (ticket.customerEmail && ticket.customerEmail.toLowerCase() === senderEmail.toLowerCase()) {
              console.log(`Found ticket #${ticket.id} matching both subject and sender email`);
              return ticket.id;
            }
          }
        }
        
        // If no sender match but we have subject matches, return the most recent one
        if (subjectMatchedTickets.length > 0) {
          console.log(`Returning most recent subject-matched ticket #${subjectMatchedTickets[0].id}`);
          return subjectMatchedTickets[0].id;
        }
      }
    }
    
    // If no match found with any method, return null
    console.log('No related ticket found with any matching method');
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