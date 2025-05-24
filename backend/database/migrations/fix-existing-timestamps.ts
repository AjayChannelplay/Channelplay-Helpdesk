/**
 * Fix Existing Ticket Timestamps
 * 
 * This script updates existing tickets to use their original email dates
 * instead of the system creation timestamps.
 */

import { db } from './server/db.js';
import { tickets, messages } from './shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { simpleParser } from 'mailparser';

async function fixExistingTimestamps() {
  console.log('🔧 Starting timestamp fix for existing tickets...');
  
  try {
    // Get all tickets that were created today (these need to be fixed)
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const ticketsToFix = await db
      .select({
        id: tickets.id,
        subject: tickets.subject,
        customerEmail: tickets.customerEmail,
        createdAt: tickets.createdAt
      })
      .from(tickets)
      .where(sql`DATE(${tickets.createdAt}) = ${today}`)
      .orderBy(tickets.id);

    console.log(`📊 Found ${ticketsToFix.length} tickets to fix from today`);

    let fixed = 0;
    
    for (const ticket of ticketsToFix) {
      try {
        // Get the first message content for this ticket
        const ticketMessages = await db
          .select({
            id: messages.id,
            content: messages.content,
            createdAt: messages.createdAt
          })
          .from(messages)
          .where(eq(messages.ticketId, ticket.id))
          .orderBy(messages.createdAt)
          .limit(1);

        if (ticketMessages.length === 0) {
          console.log(`⚠️  Ticket #${ticket.id} has no messages, skipping`);
          continue;
        }

        const messageContent = ticketMessages[0].content;
        
        // Try to parse the email date from the content
        let originalDate: Date | null = null;
        
        // Look for Date header in the email content
        const dateMatch = messageContent.match(/^Date:\s*(.+)$/m);
        if (dateMatch) {
          try {
            originalDate = new Date(dateMatch[1].trim());
            if (isNaN(originalDate.getTime())) {
              originalDate = null;
            }
          } catch (e) {
            // Date parsing failed
          }
        }

        // If we couldn't find a date in the content, try parsing the whole message
        if (!originalDate) {
          try {
            const parsed = await simpleParser(messageContent);
            if (parsed.date) {
              originalDate = new Date(parsed.date);
            }
          } catch (e) {
            // Parsing failed
          }
        }

        // If we still don't have a date, look for common email patterns
        if (!originalDate) {
          // Look for patterns like "Sent: Monday, May 5, 2025 6:33 PM"
          const sentMatch = messageContent.match(/Sent:\s*([^<\n]+)/i);
          if (sentMatch) {
            try {
              originalDate = new Date(sentMatch[1].trim());
              if (isNaN(originalDate.getTime())) {
                originalDate = null;
              }
            } catch (e) {
              // Date parsing failed
            }
          }
        }

        if (originalDate && originalDate.getTime() < new Date().getTime()) {
          // Update both ticket and message timestamps
          await db
            .update(tickets)
            .set({
              createdAt: originalDate,
              updatedAt: originalDate
            })
            .where(eq(tickets.id, ticket.id));

          await db
            .update(messages)
            .set({
              createdAt: originalDate
            })
            .where(eq(messages.ticketId, ticket.id));

          console.log(`✅ Fixed ticket #${ticket.id}: ${ticket.subject.substring(0, 50)}... - New date: ${originalDate.toISOString()}`);
          fixed++;
        } else {
          console.log(`⚠️  Could not extract valid date for ticket #${ticket.id}: ${ticket.subject.substring(0, 50)}...`);
        }

      } catch (error) {
        console.error(`❌ Error processing ticket #${ticket.id}:`, error);
      }
    }

    console.log(`🎉 Successfully fixed ${fixed} out of ${ticketsToFix.length} tickets!`);
    
  } catch (error) {
    console.error('❌ Error fixing timestamps:', error);
  }
}

// Run the fix
fixExistingTimestamps().then(() => {
  console.log('✅ Timestamp fix completed!');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});