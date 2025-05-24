/**
 * Desk-Specific Email Auto-Polling Service
 * 
 * This service automatically checks each desk's IMAP for unread emails and creates tickets
 */

import { fetchEmailsForDesk } from './imap-fetcher-working';
import { db } from './db';
import { desks } from '../shared/schema';
import { eq } from 'drizzle-orm';

let pollingIntervals: Map<number, NodeJS.Timeout> = new Map();

/**
 * Start desk-specific email polling service
 */
export async function startGmailAutoPolling() {
  console.log('🔄 Starting desk-specific email auto-polling service...');
  
  try {
    // Get all desks with IMAP configuration enabled
    const configuredDesks = await db.select().from(desks).where(
      eq(desks.useImapPolling, true)
    );
    
    console.log(`Found ${configuredDesks.length} desks with IMAP polling enabled`);
    
    let activePollingCount = 0;
    
    for (const desk of configuredDesks) {
      console.log(`Checking desk: ${desk.name} - Host: ${desk.imapHost}, User: ${desk.imapUser}, Port: ${desk.imapPort}, Password: ${desk.imapPassword ? 'SET' : 'NOT SET'}`);
      
      // Check if desk has complete IMAP configuration
      if (desk.imapHost && desk.imapUser && desk.imapPassword && desk.imapPort && desk.useImapPolling) {
        console.log(`📧 Starting polling for desk: ${desk.name} (${desk.imapUser})`);
        startDeskPolling(desk);
        activePollingCount++;
      } else {
        console.log(`❌ Desk ${desk.name} missing IMAP configuration - skipping`);
      }
    }
    
    if (activePollingCount === 0) {
      console.log('⚠️ No desks found with complete IMAP configuration. Auto-polling disabled.');
    } else {
      console.log(`✅ Started auto-polling for ${activePollingCount} desk(s)`);
    }
    
  } catch (error) {
    console.error('Error starting desk polling service:', error);
  }
}

/**
 * Start polling for a specific desk
 */
function startDeskPolling(desk: any) {
  // Clear any existing polling for this desk
  if (pollingIntervals.has(desk.id)) {
    clearInterval(pollingIntervals.get(desk.id)!);
  }
  
  // Start polling every 60 seconds for this desk
  const interval = setInterval(async () => {
    try {
      await checkDeskForNewEmails(desk);
    } catch (error) {
      console.error(`Error polling desk ${desk.name}:`, error);
    }
  }, 60000); // 60 seconds
  
  pollingIntervals.set(desk.id, interval);
  
  // Also run once immediately after 5 seconds
  setTimeout(() => {
    checkDeskForNewEmails(desk).catch(error => {
      console.error(`Error in initial desk polling for ${desk.name}:`, error);
    });
  }, 5000);
}

/**
 * Stop auto-polling service
 */
export function stopGmailAutoPolling() {
  pollingIntervals.forEach((interval, deskId) => {
    clearInterval(interval);
    console.log(`Stopped polling for desk ID: ${deskId}`);
  });
  pollingIntervals.clear();
  console.log('All desk auto-polling stopped');
}

/**
 * Check for new emails for a specific desk
 */
async function checkDeskForNewEmails(desk: any) {
  console.log(`🔍 Checking emails for desk: ${desk.name} (${desk.imapUser})`);
  
  try {
    await fetchEmailsForDesk(desk);
  } catch (error) {
    console.error(`Error fetching emails for desk ${desk.name}:`, error);
    // Don't throw the error to prevent stopping other desk polling
  }
}
        if (err) {
          console.error(`Error opening mailbox ${mailboxName} for ${desk.name}:`, err);
          reject(err);
          return;
        }

        console.log(`📬 ${mailboxName} opened for ${desk.name}. Total messages: ${box.messages.total}, Unread: ${box.messages.unseen}`);

        if (box.messages.unseen === 0) {
          console.log(`📭 No unread messages found for ${desk.name}`);
          imap.end();
          resolve();
          return;
        }

        // Search for unread messages
        imap.search(['UNSEEN'], (err, results) => {
          if (err) {
            console.error(`Error searching for unread messages in ${desk.name}:`, err);
            reject(err);
            return;
          }

          if (!results || results.length === 0) {
            console.log(`📭 No unread messages found for ${desk.name}`);
            imap.end();
            resolve();
            return;
          }

          console.log(`📬 Found ${results.length} unread messages for ${desk.name}`);

          const fetch = imap.fetch(results, { 
            bodies: '',
            markSeen: true,
            struct: true
          });

          fetch.on('message', (msg, seqno) => {
            console.log(`Processing message ${seqno} for ${desk.name}...`);
            
            let rawEmail = '';
            
            msg.on('body', (stream, info) => {
              stream.on('data', (chunk) => {
                rawEmail += chunk.toString('utf8');
              });
              
              stream.once('end', async () => {
                try {
                  const parsed = await simpleParser(rawEmail);
                  
                  // Use the ACTUAL email date from parsed.date (this is the real sent timestamp)
                  const emailSentAt = parsed.date || new Date(); // fallback just in case
                  
                  console.log(`📧 Parsed email for ${desk.name} from: ${parsed.from?.text} | Subject: ${parsed.subject} | Email Sent At: ${emailSentAt.toISOString()}`);
                  
                  // Ensure we use the actual email timestamp
                  parsed.date = emailSentAt;
                  
                  // Create ticket specifically for this desk
                  await createTicketFromEmail(parsed, desk);
                  processed++;
                  
                  console.log(`✅ Successfully processed message ${seqno} for ${desk.name} (${processed}/${results.length})`);
                  
                  if (processed === results.length) {
                    console.log(`🎉 Finished processing all ${processed} unread emails for ${desk.name}`);
                    imap.end();
                    resolve();
                  }
                } catch (error) {
                  console.error(`Error processing message ${seqno} for ${desk.name}:`, error);
                  processed++;
                  
                  if (processed === results.length) {
                    imap.end();
                    resolve();
                  }
                }
              });
            });

            msg.once('error', (err) => {
              console.error(`Error in message ${seqno} for ${desk.name}:`, err);
              processed++;
              
              if (processed === results.length) {
                imap.end();
                resolve();
              }
            });
          });

          fetch.once('error', (err) => {
            console.error(`Fetch error for ${desk.name}:`, err);
            reject(err);
          });

          fetch.once('end', () => {
            console.log(`📬 Fetch completed for ${desk.name}`);
            if (processed === 0) {
              imap.end();
              resolve();
            }
          });
        });
      });
    });

    imap.once('error', (err) => {
      console.error(`IMAP connection error for ${desk.name}:`, err);
      reject(err);
    });

    imap.once('end', () => {
      console.log(`📪 IMAP connection ended for ${desk.name}`);
    });

    console.log(`🔗 Connecting to IMAP server for ${desk.name}...`);
    imap.connect();
  });
}

/**
 * Create a new ticket from an email for a specific desk OR add to existing thread
 */
async function createTicketFromEmail(parsed: any, desk: any): Promise<void> {
  try {
    const senderEmail = parsed.from?.value?.[0]?.address || '';
    const senderName = parsed.from?.text || senderEmail || 'Unknown';
    const subject = parsed.subject || 'No Subject';
    const content = parsed.text || parsed.html || '';
    
    // Extract email threading headers
    const messageId = parsed.messageId || '';
    const inReplyTo = parsed.inReplyTo || '';
    const references = parsed.references || [];
    
    // Use the ACTUAL email date from parsed.date (this is the real sent timestamp)
    const emailSentAt = parsed.date || new Date();
    
    console.log(`📧 Processing email for ${desk.name} from: ${senderEmail}`);
    console.log(`   Subject: ${subject.substring(0, 50)}...`);
    console.log(`   Message-ID: ${messageId}`);
    console.log(`   In-Reply-To: ${inReplyTo}`);
    console.log(`   References: ${Array.isArray(references) ? references.join(', ') : references}`);
    
    // 🧠 THREADING LOGIC: Check if this is a reply to an existing ticket
    let existingTicketId = null;
    
    if (inReplyTo) {
      console.log(`🔍 Checking if In-Reply-To ${inReplyTo} matches any existing message...`);
      
      // Look for existing message with this Message-ID
      const existingMessages = await db.select({
        ticketId: messages.ticketId,
        messageId: messages.messageId
      })
      .from(messages)
      .where(eq(messages.messageId, inReplyTo))
      .limit(1);
      
      if (existingMessages.length > 0) {
        existingTicketId = existingMessages[0].ticketId;
        console.log(`✅ Found existing thread! Adding to ticket ID: ${existingTicketId}`);
      }
    }
    
    // If no match found via In-Reply-To, check References
    if (!existingTicketId && references && references.length > 0) {
      console.log(`🔍 Checking References for existing thread...`);
      
      for (const refMessageId of (Array.isArray(references) ? references : [references])) {
        const existingMessages = await db.select({
          ticketId: messages.ticketId
        })
        .from(messages)
        .where(eq(messages.messageId, refMessageId))
        .limit(1);
        
        if (existingMessages.length > 0) {
          existingTicketId = existingMessages[0].ticketId;
          console.log(`✅ Found existing thread via References! Adding to ticket ID: ${existingTicketId}`);
          break;
        }
      }
    }
    
    let ticketId;
    
    if (existingTicketId) {
      // 🎯 ADD TO EXISTING CONVERSATION
      console.log(`➕ Adding reply to existing ticket ${existingTicketId}`);
      ticketId = existingTicketId;
      
      // Update the existing ticket's updated timestamp
      await db.update(tickets)
        .set({ updatedAt: emailSentAt })
        .where(eq(tickets.id, existingTicketId));
        
    } else {
      // 🆕 CREATE NEW TICKET
      console.log(`📩 Creating new ticket for ${desk.name}`);
      
      const newTicket = {
        subject: subject,
        customerName: senderName,
        customerEmail: senderEmail,
        deskId: desk.id,
        status: 'open',
        ccRecipients: JSON.stringify([]),
        createdAt: emailSentAt,
        updatedAt: emailSentAt
      };

      const ticketResult = await db.insert(tickets).values(newTicket).returning({ id: tickets.id });
      ticketId = ticketResult[0].id;
    }
    
    // Create the message with authentic email timestamp and threading headers
    const newMessage = {
      ticketId: ticketId,
      content: content,
      sender: senderName,
      senderEmail: senderEmail,
      isAgent: false,
      messageId: messageId, // ✅ Store Message-ID for threading
      createdAt: emailSentAt,
      ccRecipients: JSON.stringify([]),
      attachments: JSON.stringify([])
    };

    await db.insert(messages).values(newMessage);
    console.log(`✅ ${existingTicketId ? 'Reply added to existing' : 'New'} ticket ${ticketId} processed successfully`);
    
  } catch (error) {
    console.error(`❌ Error creating ticket for desk ${desk.name}:`, error);
  }
}