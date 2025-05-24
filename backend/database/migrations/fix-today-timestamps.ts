/**
 * Fix Today's Email Timestamps
 * 
 * This script fixes emails that came in today but got the wrong timestamp
 * (like the Nippon and Naukri emails) to use their original email dates.
 */

import { db } from './server/db.js';
import { tickets, messages } from './shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { simpleParser } from 'mailparser';

async function fixTodayTimestamps() {
  console.log('🔧 Fixing timestamps for emails received today...');
  
  try {
    // Get tickets created today that need fixing
    const today = '2025-05-22';
    const ticketsToFix = await db
      .select({
        id: tickets.id,
        subject: tickets.subject,
        customerEmail: tickets.customerEmail,
        createdAt: tickets.createdAt
      })
      .from(tickets)
      .where(sql`DATE(${tickets.createdAt}) = ${today} AND ${tickets.createdAt} > '2025-05-22 09:00:00'`)
      .orderBy(tickets.id);

    console.log(`📊 Found ${ticketsToFix.length} tickets from today to fix`);

    let fixed = 0;
    
    for (const ticket of ticketsToFix) {
      try {
        console.log(`\n🔍 Processing ticket #${ticket.id}: ${ticket.subject.substring(0, 50)}...`);
        
        // Get the message content for this ticket
        const ticketMessages = await db
          .select({
            id: messages.id,
            content: messages.content,
            messageId: messages.messageId,
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
        let originalDate: Date | null = null;
        
        // Try to extract the original email date from content
        try {
          // Look for Date header in the email content
          const dateMatch = messageContent.match(/^Date:\s*(.+)$/m);
          if (dateMatch) {
            const dateToParse = dateMatch[1].trim();
            console.log(`📅 Found Date header: ${dateToParse}`);
            originalDate = new Date(dateToParse);
            
            if (isNaN(originalDate.getTime())) {
              console.log(`❌ Invalid date format, trying parser...`);
              originalDate = null;
            }
          }

          // If no date found in content, try parsing the whole message
          if (!originalDate) {
            try {
              const parsed = await simpleParser(messageContent);
              if (parsed.date) {
                originalDate = new Date(parsed.date);
                console.log(`📅 Extracted from parsed email: ${originalDate.toISOString()}`);
              }
            } catch (e) {
              console.log(`⚠️  Email parsing failed for ticket #${ticket.id}`);
            }
          }
        } catch (e) {
          console.log(`⚠️  Date extraction failed for ticket #${ticket.id}`);
        }

        // If we found a valid original date, update the ticket and message
        if (originalDate && !isNaN(originalDate.getTime())) {
          // Validate the date is reasonable (not in future, not too old)
          const now = new Date();
          const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
          
          if (originalDate > now) {
            console.log(`⚠️  Date ${originalDate.toISOString()} is in future, skipping`);
            continue;
          }
          
          if (originalDate < oneYearAgo) {
            console.log(`⚠️  Date ${originalDate.toISOString()} is too old, skipping`);
            continue;
          }

          console.log(`✅ Updating ticket #${ticket.id} from ${ticket.createdAt} to ${originalDate.toISOString()}`);
          
          // Update ticket timestamps
          await db.update(tickets)
            .set({ 
              createdAt: originalDate,
              updatedAt: originalDate
            })
            .where(eq(tickets.id, ticket.id));
          
          // Update message timestamp
          await db.update(messages)
            .set({ 
              createdAt: originalDate
            })
            .where(eq(messages.ticketId, ticket.id));
          
          fixed++;
        } else {
          console.log(`❌ Could not extract valid original date for ticket #${ticket.id}`);
        }
        
      } catch (error) {
        console.error(`❌ Error processing ticket #${ticket.id}:`, error);
      }
    }
    
    console.log(`\n🎉 Successfully fixed ${fixed} out of ${ticketsToFix.length} tickets!`);
    
  } catch (error) {
    console.error('❌ Error in fixTodayTimestamps:', error);
    throw error;
  }
}

// Run the fix
fixTodayTimestamps()
  .then(() => {
    console.log('✅ Today\'s timestamp fix completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fix failed:', error);
    process.exit(1);
  });