import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { InsertTicket, InsertMessage } from '../shared/schema';
import { db } from './db';
import { tickets, messages } from '../shared/schema';
import { v4 as uuidv4 } from 'uuid';
import { cleanMessageId, extractReferencedIds, findRelatedTicket } from './email-threading';
import { eq, desc } from 'drizzle-orm';
import { ParsedMail } from 'mailparser';
import { createHash } from 'crypto';

// Default IMAP configuration that can be overridden
let imapConfig = {
  user: process.env.IMAP_USER || '',
  password: process.env.IMAP_PASSWORD || '',
  host: process.env.IMAP_HOST || 'imap.gmail.com',
  port: process.env.IMAP_PORT ? parseInt(process.env.IMAP_PORT) : 993,
  tls: process.env.IMAP_TLS !== 'false',
  tlsOptions: { rejectUnauthorized: false },
  authTimeout: 30000,
  mailbox: 'INBOX'
};

/**
 * Configure IMAP with new settings
 */
export function configure(config: {
  host: string;
  port: number;
  user: string;
  password: string;
  tls?: boolean;
  mailbox?: string;
}) {
  console.log("Configuring IMAP with new settings:", {
    host: config.host,
    port: config.port,
    user: config.user,
    tls: config.tls,
    mailbox: config.mailbox
  });
  
  // Update the IMAP configuration
  imapConfig = {
    ...imapConfig, // Keep default settings for fields not provided
    ...config,     // Override with provided settings
    tlsOptions: { rejectUnauthorized: false }, // Always keep this setting
    authTimeout: 30000 // Always keep this setting
  };
  
  console.log("IMAP configuration updated successfully");
  return true;
}

/**
 * Parse email message content
 */
function processMessage(msg: any, seqno: any, callback: Function) {
  // Configure simpleParser to extract attachments
  const parser = simpleParser(msg);
  parser.then(async (parsed) => {
    try {
      console.log('Processing email:', parsed.subject);
      
      // Extract message ID and references for threading
      const messageId = parsed.messageId;
      
      // Convert references to string format for database storage
      let refString = null;
      if (parsed.references) {
        if (Array.isArray(parsed.references)) {
          refString = parsed.references.join(' ');
        } else if (typeof parsed.references === 'string') {
          refString = parsed.references;
        } else {
          refString = String(parsed.references);
        }
      }
      
      const inReplyTo = parsed.inReplyTo || null;
      
      // Log incoming email headers for debugging
      console.log('📧 Incoming email headers:', {
        messageId,
        references: refString ? (refString.length > 100 ? refString.substring(0, 100) + '...' : refString) : null,
        inReplyTo,
        subject: parsed.subject
      });
      
      // Check the content of the email for ticket numbers
      // Many email clients don't maintain proper thread headers
      const content = parsed.text || '';
      const ticketNumberMatch = content.match(/Ticket #(\d+)/i) || 
                               content.match(/Ticket ID: (\d+)/i) ||
                               content.match(/Support Ticket: (\d+)/i);
      
      let ticketIdFromContent = null;
      if (ticketNumberMatch && ticketNumberMatch[1]) {
        ticketIdFromContent = parseInt(ticketNumberMatch[1], 10);
        console.log(`Found potential ticket reference in email content: #${ticketIdFromContent}`);
      }
      
      // Enhanced ticket matching for better reply handling
      // First try finding by thread headers - convert references to string if it's an array
      let refString = typeof references === 'string' ? references : 
                     Array.isArray(references) ? references.join(' ') : null;
                     
      // 🔍 Check if this email is a reply using In-Reply-To and References headers
      let relatedTicketId = null;
      
      // Step 1: Check In-Reply-To header (highest priority)
      if (inReplyTo) {
        console.log(`📧 Email has In-Reply-To: ${inReplyTo}, checking for existing conversation`);
        
        const existingMessage = await db.select({ ticketId: messages.ticketId })
          .from(messages)
          .where(eq(messages.messageId, inReplyTo))
          .limit(1);
          
        if (existingMessage.length > 0) {
          relatedTicketId = existingMessage[0].ticketId;
          console.log(`✅ Found existing ticket #${relatedTicketId} via In-Reply-To header`);
        } else {
          console.log(`❌ No existing message found with ID: ${inReplyTo}`);
        }
      }
      
      // Step 2: Check References header if no In-Reply-To match
      if (!relatedTicketId && refString) {
        console.log(`📧 Checking References: ${refString}`);
        
        const referencedIds = refString.split(/\s+/).filter(id => id.trim().length > 0);
        
        for (const refId of referencedIds) {
          const existingMessage = await db.select({ ticketId: messages.ticketId })
            .from(messages)
            .where(eq(messages.messageId, refId.trim()))
            .limit(1);
            
          if (existingMessage.length > 0) {
            relatedTicketId = existingMessage[0].ticketId;
            console.log(`✅ Found existing ticket #${relatedTicketId} via References header`);
            break;
          }
        }
      }
      
      // If no match found by message ID, try multiple methods to find the related ticket
      
      // 1. Try checking if the subject line contains a ticket reference
      // Many email clients keep the original subject line when replying
      if (!relatedTicketId && parsed.subject) {
        const subject = parsed.subject.trim();
        // Look for various ticket reference formats in subject
        const ticketRefMatch = subject.match(/\[Ticket #(\d+)\]/i) || 
                              subject.match(/Ticket #(\d+)/i) ||
                              subject.match(/Re: .+\[#(\d+)\]/i);
        
        if (ticketRefMatch && ticketRefMatch[1]) {
          const potentialTicketId = parseInt(ticketRefMatch[1], 10);
          console.log(`Found ticket reference in subject: #${potentialTicketId}`);
          
          // Verify the ticket exists
          const ticketExists = await db.select({ id: tickets.id })
            .from(tickets)
            .where(eq(tickets.id, potentialTicketId))
            .limit(1);
            
          if (ticketExists.length > 0) {
            relatedTicketId = potentialTicketId;
            console.log(`Confirmed ticket #${potentialTicketId} exists, using as related ticket`);
          }
        }
      }
      
      // 2. Check for ticket ID in email content if we found it earlier
      if (!relatedTicketId && ticketIdFromContent) {
        console.log(`Checking if ticket #${ticketIdFromContent} exists`);
        const ticketExists = await db.select({ id: tickets.id })
          .from(tickets)
          .where(eq(tickets.id, ticketIdFromContent))
          .limit(1);
          
        if (ticketExists.length > 0) {
          relatedTicketId = ticketIdFromContent;
          console.log(`Confirmed ticket #${ticketIdFromContent} exists from content, using as related ticket`);
        }
      }
      
      // 3. Simple subject-based threading for replies
      if (!relatedTicketId && parsed.subject && parsed.from?.value?.[0]?.address) {
        const customerEmail = parsed.from.value[0].address;
        const subject = parsed.subject.trim();
        
        // If this looks like a reply (starts with "Re:")
        if (subject.toLowerCase().startsWith('re:')) {
          console.log(`Email subject "${subject}" looks like a reply, searching for original ticket`);
          
          // Remove "Re:" prefixes to find original subject
          let originalSubject = subject.replace(/^re:\s*/i, '').trim();
          
          // Remove additional "Re:" prefixes if nested
          while (originalSubject.toLowerCase().startsWith('re:')) {
            originalSubject = originalSubject.replace(/^re:\s*/i, '').trim();
          }
          
          console.log(`Looking for original ticket with subject: "${originalSubject}"`);
          
          try {
            // Find ticket with matching original subject from this customer
            const matchingTickets = await db.select({ id: tickets.id })
              .from(tickets)
              .where(eq(tickets.customerEmail, customerEmail))
              .orderBy(desc(tickets.createdAt))
              .limit(5);
            
            // Look for exact subject match
            for (const ticket of matchingTickets) {
              const fullTicket = await db.select()
                .from(tickets)
                .where(eq(tickets.id, ticket.id))
                .limit(1);
                
              if (fullTicket.length > 0 && fullTicket[0].subject === originalSubject) {
                relatedTicketId = ticket.id;
                console.log(`✅ Found original ticket #${relatedTicketId} for reply "${subject}"`);
                break;
              }
            }
            
            if (!relatedTicketId) {
              console.log(`❌ No original ticket found for subject "${originalSubject}"`);
            }
          } catch (error) {
            console.error('Error finding original ticket:', error);
          }
        } else {
          console.log(`Subject "${subject}" doesn't look like a reply, will create new ticket`);
        }
      }
      
      if (relatedTicketId) {
        // This is a reply to an existing ticket
        console.log(`Email is a reply to existing ticket #${relatedTicketId}`);
        
        // Create a message in the existing ticket
        const messageTimestamp = parsed.date || new Date(); // Use actual email send time
        
        // Process attachments from the parsed email
        const attachments = parsed.attachments ? parsed.attachments.map((attachment: any) => ({
          filename: attachment.filename || 'unnamed_attachment',
          contentType: attachment.contentType || 'application/octet-stream',
          size: attachment.size || 0,
          content: attachment.content ? attachment.content.toString('base64') : ''
        })) : [];
        
        console.log(`📎 Processing ${attachments.length} attachments for reply message`);
        
        const newMessage = {
          ticketId: relatedTicketId,
          content: parsed.text || '',
          sender: parsed.from?.text || 'Unknown',
          senderEmail: parsed.from?.value?.[0]?.address || '',
          messageId: messageId,
          referenceIds: refString, // Store References header
          inReplyTo: inReplyTo,   // Store In-Reply-To header
          isAgent: false,
          createdAt: messageTimestamp,
          isSatisfactionResponse: false,
          satisfactionRating: null,
          ccRecipients: [],
          attachments: attachments,
          emailSent: false
        };
        
        await db.insert(messages).values(newMessage);
        
        // Use the email's actual send time for updating the ticket
        const replyTimestamp = parsed.date || new Date(); // Use email's actual send time
        console.log(`Reply email sent at: ${replyTimestamp}`);
        
        // Update the ticket with the actual email timestamp
        await db.update(tickets)
          .set({ 
            updatedAt: replyTimestamp // Use actual email send time
          })
          .where(eq(tickets.id, relatedTicketId));
        
        console.log('Added reply to ticket:', relatedTicketId);
      } else {
        // This is a new ticket
        console.log('Creating new ticket from email');
        
        // Use the actual email send time, not the system fetch time
        const originalSendTime = parsed.date || new Date(); // Use email's actual send time
        
        console.log(`Email sent at: ${originalSendTime}`);
        
        // Use ChannelPlay desk ID (8) instead of Gmail Support desk ID (19)
        const newTicket = {
          subject: parsed.subject || 'No Subject',
          status: 'open',
          priority: 'medium',
          deskId: 8, // ChannelPlay Help Desk ID
          assignedTo: null,
          createdBy: null,
          customerName: parsed.from?.text || 'Unknown',
          customerEmail: parsed.from?.value?.[0]?.address || '',
          createdAt: originalSendTime, // Use actual email send time
          updatedAt: originalSendTime  // Also use email send time for updatedAt for consistent sorting
        };
        
        const insertedTicket = await db.insert(tickets).values(newTicket).returning();
        const ticketId = insertedTicket[0].id;
        
        // Debug: Check what the parser found
        console.log(`📧 Email parser found:`, {
          hasAttachments: !!parsed.attachments,
          attachmentCount: parsed.attachments?.length || 0,
          attachmentDetails: parsed.attachments?.map(a => ({ 
            filename: a.filename, 
            contentType: a.contentType,
            hasContent: !!a.content 
          })) || []
        });
        
        // Process attachments from the parsed email
        const attachments = parsed.attachments ? parsed.attachments.map((attachment: any) => ({
          filename: attachment.filename || 'unnamed_attachment',
          contentType: attachment.contentType || 'application/octet-stream',
          size: attachment.size || 0,
          content: attachment.content ? attachment.content.toString('base64') : ''
        })) : [];
        
        console.log(`📎 Processing ${attachments.length} attachments for new ticket`);
        
        // Create initial message using the actual email send time
        const newMessage = {
          ticketId: ticketId,
          content: parsed.text || '',
          sender: parsed.from?.text || 'Unknown',
          senderEmail: parsed.from?.value?.[0]?.address || '',
          messageId: messageId,
          referenceIds: refString, // Store References header
          inReplyTo: inReplyTo,   // Store In-Reply-To header
          isAgent: false,
          createdAt: originalSendTime,
          isSatisfactionResponse: false,
          satisfactionRating: null,
          ccRecipients: [],
          attachments: attachments,
          emailSent: false
        };
        
        await db.insert(messages).values(newMessage);
        console.log('Created new ticket:', ticketId);
      }
      
      callback();
    } catch (error) {
      console.error('Error processing email:', error);
      callback(error);
    }
  }).catch(err => {
    console.error('Error parsing email:', err);
    callback(err);
  });
}

/**
 * Fetch new emails from Gmail
 */
export function fetchEmails(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      // Make sure we have required credentials
      if (!imapConfig.user || !imapConfig.password || !imapConfig.host) {
        return reject(new Error("Missing required IMAP credentials. Please configure IMAP settings first."));
      }
      
      console.log("Connecting to IMAP server with configuration:", {
        host: imapConfig.host, 
        port: imapConfig.port,
        user: imapConfig.user, 
        tls: imapConfig.tls,
        mailbox: imapConfig.mailbox || 'INBOX'
      });
      
      const imap = new Imap(imapConfig);
      
      imap.once('ready', () => {
        // Use the configured mailbox or default to INBOX
        const mailboxName = imapConfig.mailbox || 'INBOX';
        console.log(`Opening mailbox: ${mailboxName}`);
        
        imap.openBox(mailboxName, false, (err, box) => {
          if (err) {
            console.error('Error opening inbox:', err);
            imap.end();
            return reject(err);
          }
          
          // Get current date for time constraints
          const currentDate = new Date();
          // Set date to 30 days ago to avoid fetching really old messages
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(currentDate.getDate() - 30);
          
          // Format date for IMAP search (month name might need to be capitalized)
          const month = thirtyDaysAgo.toLocaleString('en-US', { month: 'short' }).toUpperCase();
          const day = thirtyDaysAgo.getDate();
          const year = thirtyDaysAgo.getFullYear();
          const sinceDate = `${day}-${month}-${year}`;
          
          console.log(`Searching for UNREAD emails only to process new messages`);
          
          // Search for UNREAD messages only to avoid processing already handled emails
          // This helps capture emails that might have been automatically marked as read
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const recentDay = yesterday.getDate();
          const recentMonth = yesterday.toLocaleString('en-US', { month: 'short' }).toUpperCase();
          const recentYear = yesterday.getFullYear();
          const recentDate = `${recentDay}-${recentMonth}-${recentYear}`;
          
          console.log(`Searching for UNREAD and RECENT messages in Gmail...`);
          // First search for unread messages
          imap.search(['UNSEEN'], (err, unseenResults) => {
            if (err) {
              console.error('Error searching for UNSEEN messages:', err);
              unseenResults = [];
            }

            // Also search for recent messages (last 10 minutes) to catch emails that got marked as read
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
            const recentTime = tenMinutesAgo.toISOString().split('T')[0]; // YYYY-MM-DD format
            
            imap.search(['SINCE', recentTime], (err2, recentResults) => {
              if (err2) {
                console.error('Error searching for recent messages:', err2);
                recentResults = [];
              }

              // Combine results and remove duplicates
              const allResults = [...new Set([...(unseenResults || []), ...(recentResults || [])])];
              console.log(`Found ${unseenResults?.length || 0} unread and ${recentResults?.length || 0} recent messages (${allResults.length} total after dedup)`);
              
              if (allResults.length === 0) {
                console.log(`📭 No unread or recent messages found for ${desk.name}`);
                imap.end();
                resolve();
                return;
              }
              
              processResults(allResults.slice(0, 10)); // Limit to 10
            });
          });

          function processResults(results: any[]) {
            console.log(`Found ${results.length} messages to process`);
            // Limit to 10 messages at a time to prevent memory overload
            if (results.length > 10) {
              console.log(`Limiting to processing 10 out of ${results.length} unread messages to prevent memory issues`);
              results = results.slice(0, 10);
            }
            
            processResults(results);
          });
          
          function processResults(messageIds: any[]) {
            if (messageIds.length === 0) {
              console.log('No unread messages found');
              imap.end();
              return resolve();
            }
            
            if (results.length === 0) {
              console.log('No new messages found');
              imap.end();
              return resolve();
            }
            
            console.log(`Found ${results.length} new messages`);
            
            const fetch = imap.fetch(results, { bodies: '', markSeen: true });
            
            fetch.on('message', (msg, seqno) => {
              let buffer = '';
              msg.on('body', (stream, info) => {
                stream.on('data', (chunk) => {
                  buffer += chunk.toString('utf8');
                });
                
                stream.once('end', () => {
                  processMessage(buffer, seqno, (err: any) => {
                    if (err) {
                      console.error('Error processing message:', err);
                    }
                  });
                });
              });
            });
            
            fetch.once('error', (err: Error) => {
              console.error('Fetch error:', err);
              reject(err);
            });
            
            fetch.once('end', () => {
              console.log('Done fetching messages');
              imap.end();
              resolve();
            });
          });
        });
      });
      
      imap.once('error', (err) => {
        console.error('IMAP connection error:', err);
        reject(err);
      });
      
      imap.once('end', () => {
        console.log('IMAP connection ended');
      });
      
      imap.connect();
    } catch (error) {
      console.error('Error in fetchEmails:', error);
      reject(error);
    }
  });
}

/**
 * Fetch emails from a specific desk with IMAP polling enabled
 */
export async function fetchEmailsForDesk(desk: any): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      // Check if this desk has IMAP polling enabled and has credentials
      if (!desk.useImapPolling || !desk.imapUser || !desk.imapPassword || !desk.imapHost) {
        console.log(`Skipping desk ${desk.name} - IMAP polling not configured`);
        return resolve();
      }

      console.log(`Fetching emails for desk: ${desk.name} (${desk.email})`);
      
      const deskImapConfig = {
        user: desk.imapUser,
        password: desk.imapPassword,
        host: desk.imapHost,
        port: parseInt(desk.imapPort) || 993,
        tls: desk.imapSecure !== false,
        tlsOptions: { 
          rejectUnauthorized: false,
          servername: desk.imapHost // Explicit servername for Gmail
        },
        authTimeout: 60000, // Increased timeout for Gmail
        connTimeout: 60000, // Connection timeout
        keepalive: false, // Disable keepalive for simpler connections
        debug: console.log // Enable debug logging
      };
      
      const imap = new Imap(deskImapConfig);
      
      imap.once('ready', () => {
        const mailboxName = deskImapConfig.mailbox || 'INBOX';
        console.log(`Opening mailbox: ${mailboxName} for desk ${desk.name}`);
        
        imap.openBox(mailboxName, false, (err, box) => {
          if (err) {
            console.error(`Error opening inbox for desk ${desk.name}:`, err);
            imap.end();
            return reject(err);
          }
          
          console.log(`Searching for UNREAD messages only in desk ${desk.name}`);
          imap.search(['UNSEEN'], (err, results) => {
            if (err) {
              console.error(`Error searching for unread messages in desk ${desk.name}:`, err);
              imap.end();
              return reject(err);
            }
            
            if (results.length === 0) {
              console.log(`No unread messages found in desk ${desk.name}`);
              imap.end();
              return resolve();
            }
            
            // Limit to 10 messages at a time to prevent memory overload
            if (results.length > 10) {
              console.log(`Limiting to processing 10 out of ${results.length} unread messages for desk ${desk.name}`);
              results = results.slice(0, 10);
            }
            
            console.log(`Found ${results.length} unread messages in desk ${desk.name}`);
            
            // Fetch complete raw email message to extract attachments
            const fetch = imap.fetch(results, { 
              bodies: '',
              markSeen: true 
            });
            let processedCount = 0;
            
            fetch.on('message', (msg, seqno) => {
              let buffer = '';
              msg.on('body', (stream, info) => {
                stream.on('data', (chunk) => {
                  buffer += chunk.toString('utf8');
                });
                
                stream.once('end', () => {
                  processMessageForDesk(buffer, seqno, desk, (err: any) => {
                    processedCount++;
                    if (err) {
                      console.error(`Error processing message for desk ${desk.name}:`, err);
                    }
                    if (processedCount === results.length) {
                      console.log(`Finished processing all messages for desk ${desk.name}`);
                    }
                  });
                });
              });
            });
            
            fetch.once('error', (err: Error) => {
              console.error(`Fetch error for desk ${desk.name}:`, err);
              imap.end();
              return reject(err);
            });
            
            fetch.once('end', () => {
              console.log(`Finished fetching messages for desk ${desk.name}`);
              imap.end();
              return resolve();
            });
          });
        });
      });
      
      imap.once('error', (err: Error) => {
        console.error(`IMAP connection error for desk ${desk.name}:`, err);
        console.error(`IMAP Error Details:`, {
          message: err.message,
          code: (err as any).code,
          errno: (err as any).errno,
          syscall: (err as any).syscall,
          hostname: (err as any).hostname
        });
        return reject(err);
      });
      
      imap.connect();
    } catch (error) {
      console.error(`Error in fetchEmailsForDesk for desk ${desk?.name}:`, error);
      return reject(error);
    }
  });
}

/**
 * Process a single email message for a specific desk
 */
async function processMessageForDesk(buffer: string, seqno: number, desk: any, callback: (err?: any) => void): Promise<void> {
  try {
    const parsed: ParsedMail = await simpleParser(buffer);
    
    console.log(`Processing message for desk ${desk.name}:`, {
      from: parsed.from?.text,
      subject: parsed.subject,
      date: parsed.date,
      messageId: parsed.messageId,
      cc: parsed.cc ? 'HAS CC DATA' : 'NO CC DATA'
    });
    
    if (parsed.cc) {
      console.log(`📧 FOUND CC DATA:`, JSON.stringify(parsed.cc, null, 2));
    } else {
      console.log(`📧 NO CC RECIPIENTS in this email`);
    }

    // Extract the REAL original email date - this is crucial for proper ticket timestamps
    let emailDate: Date;
    let dateSource = 'current-time-fallback';
    
    // Method 1: Try parsed.date from email parser (most reliable)
    if (parsed.date) {
      const parsedDate = new Date(parsed.date);
      if (!isNaN(parsedDate.getTime())) {
        emailDate = parsedDate;
        dateSource = 'email-parser-date';
      }
    }
    
    // Method 2: Try extracting from email headers directly
    if (!emailDate && parsed.headers) {
      const headerDate = parsed.headers.get('date') || parsed.headers.get('Date');
      if (headerDate) {
        const headerParsedDate = new Date(headerDate);
        if (!isNaN(headerParsedDate.getTime())) {
          emailDate = headerParsedDate;
          dateSource = 'email-header-date';
        }
      }
    }
    
    // Method 3: Try extracting from raw email content (Date: header)
    if (!emailDate) {
      const content = parsed.text || parsed.html || '';
      const dateMatch = content.match(/^Date:\s*(.+)$/m);
      if (dateMatch && dateMatch[1]) {
        const contentDate = new Date(dateMatch[1].trim());
        if (!isNaN(contentDate.getTime())) {
          emailDate = contentDate;
          dateSource = 'email-content-date';
        }
      }
    }
    
    // Final fallback: use current time but log it as a problem
    if (!emailDate) {
      emailDate = new Date();
      console.error(`❌ FAILED to extract original email date for: ${parsed.subject?.substring(0, 50)}... - Using current time as fallback`);
      dateSource = 'current-time-fallback';
    }
    
    // Validate the date is reasonable
    const now = new Date();
    const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
    
    if (emailDate > now) {
      console.warn(`⚠️  Email date ${emailDate.toISOString()} is in future, using current time`);
      emailDate = now;
      dateSource = 'corrected-future-date';
    } else if (emailDate < twoYearsAgo) {
      console.warn(`⚠️  Email date ${emailDate.toISOString()} is too old (over 2 years), using current time`);
      emailDate = now;  
      dateSource = 'corrected-very-old-date';
    }
    
    console.log(`📩 Using email timestamp: ${emailDate.toISOString()} (Source: ${dateSource}) for: ${parsed.subject?.substring(0, 50)}...`);
    
    // Extract sender information
    const senderEmail = parsed.from?.value?.[0]?.address || '';
    const senderName = parsed.from?.value?.[0]?.name || senderEmail.split('@')[0] || 'Unknown';
    
    // Extract CC recipients from the email
    const ccRecipients: string[] = [];
    
    console.log(`📧 PROCESSING EMAIL WITH CC CHECK from ${senderEmail}`);
    console.log(`📧 Subject: ${parsed.subject}`);
    console.log(`📧 CC field present:`, !!parsed.cc);
    if (parsed.cc) {
      console.log(`📧 CC data found:`, JSON.stringify(parsed.cc, null, 2));
    }
    
    // Try different ways to extract CC recipients from mailparser
    if (parsed.cc) {
      console.log(`📧 Raw CC data from email:`, JSON.stringify(parsed.cc, null, 2));
      console.log(`📧 CC type:`, typeof parsed.cc);
      console.log(`📧 CC constructor:`, parsed.cc.constructor.name);
      
      // Handle the different possible formats for CC addresses
      if (Array.isArray(parsed.cc)) {
        // If it's an array of addresses
        for (const ccItem of parsed.cc) {
          if (ccItem && typeof ccItem === 'object') {
            if (ccItem.address) {
              const formattedCC = ccItem.name ? `${ccItem.name} <${ccItem.address}>` : ccItem.address;
              ccRecipients.push(formattedCC);
            }
          } else if (typeof ccItem === 'string') {
            ccRecipients.push(ccItem);
          }
        }
      } else if (typeof parsed.cc === 'object' && parsed.cc.value && Array.isArray(parsed.cc.value)) {
        // If it's an object with a value array (mailparser format)
        for (const ccItem of parsed.cc.value) {
          if (ccItem && ccItem.address) {
            const formattedCC = ccItem.name ? `${ccItem.name} <${ccItem.address}>` : ccItem.address;
            ccRecipients.push(formattedCC);
          }
        }
      } else if (typeof parsed.cc === 'object' && parsed.cc.address) {
        // If it's a single address object
        const formattedCC = parsed.cc.name ? `${parsed.cc.name} <${parsed.cc.address}>` : parsed.cc.address;
        ccRecipients.push(formattedCC);
      } else if (typeof parsed.cc === 'string') {
        // If it's a simple string
        ccRecipients.push(parsed.cc);
      }
      
      if (ccRecipients.length > 0) {
        console.log(`📧 Successfully extracted ${ccRecipients.length} CC recipients: ${ccRecipients.join(', ')}`);
      } else {
        console.log(`📧 CC field detected but no recipients extracted. Raw CC:`, parsed.cc);
      }
    }
    
    // Get message threading information
    const messageId = parsed.messageId || `<${uuidv4()}@generated>`;
    const references = parsed.references;
    const inReplyTo = parsed.inReplyTo;
    
    // Process attachments from the parsed email
    const attachments: any[] = [];
    if (parsed.attachments && parsed.attachments.length > 0) {
      console.log(`📎 Found ${parsed.attachments.length} attachments in email from ${senderEmail}`);
      
      for (const attachment of parsed.attachments) {
        try {
          // Skip if too large
          if (attachment.size > 10 * 1024 * 1024) {
            console.warn(`Skipping large attachment: ${attachment.filename} (${attachment.size} bytes)`);
            continue;
          }
          
          // Basic validation
          if (!attachment.content) {
            console.warn(`Attachment ${attachment.filename} has no content`);
            continue;
          }
          
          // Sanitize filename
          let filename = attachment.filename || 'unnamed_attachment';
          filename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
          
          const attachmentData = {
            filename: filename,
            contentType: attachment.contentType || 'application/octet-stream',
            size: attachment.size || attachment.content?.length || 0,
            content: attachment.content.toString('base64'),
            checksum: require('crypto').createHash('md5').update(attachment.content).digest('hex')
          };
          
          attachments.push(attachmentData);
          console.log(`📎 Processed attachment: ${filename} (${attachmentData.size} bytes)`);
        } catch (attachmentError) {
          console.error('Error processing attachment:', attachmentError);
        }
      }
    } else {
      console.log(`📎 No attachments found in email from ${senderEmail}`);
    }
    
    console.log(`📎 Total processed attachments: ${attachments.length}`);
    
    // Check for ticket references in content and subject
    const content = parsed.text || '';
    const ticketNumberMatch = content.match(/Ticket #(\d+)/i) || 
                             content.match(/Ticket ID: (\d+)/i) ||
                             content.match(/Support Ticket: (\d+)/i);
    
    let ticketIdFromContent = null;
    if (ticketNumberMatch && ticketNumberMatch[1]) {
      ticketIdFromContent = parseInt(ticketNumberMatch[1], 10);
      console.log(`Found potential ticket reference in email content for desk ${desk.name}: #${ticketIdFromContent}`);
    }
    
    // Enhanced ticket matching for better reply handling
    let refString = typeof references === 'string' ? references : 
                   Array.isArray(references) ? references.join(' ') : null;
                   
    let relatedTicketId = await findRelatedTicket(
      messageId || null, 
      refString, 
      inReplyTo || null
    );
    
    // If no match found by message ID, try subject line matching
    if (!relatedTicketId && parsed.subject) {
      const subject = parsed.subject.trim();
      const ticketRefMatch = subject.match(/\[Ticket #(\d+)\]/i) || 
                            subject.match(/Ticket #(\d+)/i) ||
                            subject.match(/Re: .+\[#(\d+)\]/i);
      
      if (ticketRefMatch && ticketRefMatch[1]) {
        const potentialTicketId = parseInt(ticketRefMatch[1], 10);
        console.log(`Found ticket reference in subject for desk ${desk.name}: #${potentialTicketId}`);
        
        // Verify the ticket exists and belongs to this desk
        const ticketExists = await db.select({ id: tickets.id, deskId: tickets.deskId })
          .from(tickets)
          .where(eq(tickets.id, potentialTicketId))
          .limit(1);
          
        if (ticketExists.length > 0 && ticketExists[0].deskId === desk.id) {
          relatedTicketId = potentialTicketId;
          console.log(`Confirmed ticket #${potentialTicketId} belongs to desk ${desk.name}`);
        }
      }
    }
    
    // If still no match and we found a ticket number in content, try that
    if (!relatedTicketId && ticketIdFromContent) {
      const ticketExists = await db.select({ id: tickets.id, deskId: tickets.deskId })
        .from(tickets)
        .where(eq(tickets.id, ticketIdFromContent))
        .limit(1);
        
      if (ticketExists.length > 0 && ticketExists[0].deskId === desk.id) {
        relatedTicketId = ticketIdFromContent;
        console.log(`Using ticket from content #${ticketIdFromContent} for desk ${desk.name}`);
      }
    }
    
    if (relatedTicketId) {
      console.log(`Adding reply to existing ticket #${relatedTicketId} for desk ${desk.name}`);
      
      // Create a new message for the existing ticket
      const newMessage: InsertMessage = {
        ticketId: relatedTicketId,
        content: content,
        sender: senderName,
        senderEmail: senderEmail,
        isAgent: false,
        messageId: messageId,
        referenceIds: refString,
        inReplyTo: inReplyTo || null,
        createdAt: emailDate, // Use original email timestamp
        ccRecipients: JSON.stringify(ccRecipients),
        attachments: JSON.stringify(attachments),
        isSatisfactionResponse: false,
        satisfactionRating: null,
        emailSent: false
      };
      
      await db.insert(messages).values(newMessage);
      
      // If the incoming email has CC recipients, merge them with the ticket's existing CC recipients
      if (ccRecipients.length > 0) {
        console.log(`📧 Incoming email has ${ccRecipients.length} CC recipients, merging with ticket...`);
        
        // Get current ticket to check existing CC recipients
        const currentTicket = await db.select().from(tickets).where(eq(tickets.id, relatedTicketId)).limit(1);
        
        if (currentTicket.length > 0) {
          const existingCCs = currentTicket[0].ccRecipients || [];
          const allCCs = [...existingCCs];
          
          // Add new CC recipients that don't already exist
          ccRecipients.forEach(newCC => {
            if (!allCCs.includes(newCC)) {
              allCCs.push(newCC);
            }
          });
          
          if (allCCs.length > existingCCs.length) {
            console.log(`📧 Adding ${allCCs.length - existingCCs.length} new CC recipients to ticket #${relatedTicketId}`);
            
            // Update ticket with merged CC recipients
            await db.update(tickets)
              .set({ 
                updatedAt: emailDate,
                status: 'open', // Reopen ticket if it was closed
                ccRecipients: allCCs
              })
              .where(eq(tickets.id, relatedTicketId));
          } else {
            // Update just timestamp and status
            await db.update(tickets)
              .set({ 
                updatedAt: emailDate,
                status: 'open' // Reopen ticket if it was closed
              })
              .where(eq(tickets.id, relatedTicketId));
          }
        }
      } else {
        // Update the ticket's updated timestamp to the email's timestamp
        await db.update(tickets)
          .set({ 
            updatedAt: emailDate,
            status: 'open' // Reopen ticket if it was closed
          })
          .where(eq(tickets.id, relatedTicketId));
      }
        
      console.log(`Successfully added reply to ticket #${relatedTicketId} for desk ${desk.name} with original timestamp`);
    } else {
      console.log(`Creating new ticket for desk ${desk.name} with original timestamp`);
      
      // Create a new ticket assigned to this specific desk
      const newTicket: InsertTicket = {
        subject: parsed.subject || 'No Subject',
        status: 'open',
        customerName: senderName,
        customerEmail: senderEmail,
        deskId: desk.id, // Assign to the specific desk
        createdAt: emailDate, // Use original email timestamp
        updatedAt: emailDate,
        ccRecipients: JSON.stringify(ccRecipients)
      };
      
      const [createdTicket] = await db.insert(tickets).values(newTicket).returning();
      
      // Create the initial message with original timestamp
      const initialMessage: InsertMessage = {
        ticketId: createdTicket.id,
        content: content,
        sender: senderName,
        senderEmail: senderEmail,
        isAgent: false,
        messageId: messageId,
        referenceIds: refString,
        inReplyTo: inReplyTo || null,
        createdAt: emailDate, // Use original email timestamp
        ccRecipients: JSON.stringify(ccRecipients),
        attachments: JSON.stringify(attachments),
        isSatisfactionResponse: false,
        satisfactionRating: null,
        emailSent: false
      };
      
      await db.insert(messages).values(initialMessage);
      
      console.log(`Successfully created ticket #${createdTicket.id} for desk ${desk.name} with original timestamp`);
    }
    
    callback();
  } catch (error) {
    console.error(`Error processing message for desk ${desk?.name}:`, error);
    callback(error);
  }
}

/**
 * Start polling for new emails from all desks with IMAP polling enabled
 */
export function startEmailPolling(interval = 60000): void {
  console.log(`Starting email polling every ${interval/1000} seconds`);
  
  // Fetch emails immediately from all desks
  fetchEmailsFromAllDesks().catch(err => {
    console.error('Error in initial email fetch:', err);
  });
  
  // Then fetch at regular intervals
  setInterval(() => {
    fetchEmailsFromAllDesks().catch(err => {
      console.error('Error fetching emails:', err);
    });
  }, interval);
}

/**
 * Fetch emails from all desks with IMAP polling enabled
 */
export async function fetchEmailsFromAllDesks(): Promise<void> {
  try {
    // Import storage here to avoid circular dependency
    const { storage } = await import('./storage');
    
    // Get all desks
    const desks = await storage.getDesks();
    
    // Filter desks that have IMAP polling enabled
    const pollingDesks = desks.filter(desk => 
      desk.useImapPolling && 
      desk.imapUser && 
      desk.imapPassword && 
      desk.imapHost
    );
    
    if (pollingDesks.length === 0) {
      console.log('No desks configured for IMAP polling');
      return;
    }
    
    console.log(`Polling emails from ${pollingDesks.length} desks`);
    
    // Process each desk sequentially to avoid overwhelming the server
    for (const desk of pollingDesks) {
      try {
        await fetchEmailsForDesk(desk);
      } catch (error) {
        console.error(`Failed to fetch emails for desk ${desk.name}:`, error);
        // Continue with other desks even if one fails
      }
    }
    
    console.log('Finished polling all desks');
  } catch (error) {
    console.error('Error in fetchEmailsFromAllDesks:', error);
    throw error;
  }
}