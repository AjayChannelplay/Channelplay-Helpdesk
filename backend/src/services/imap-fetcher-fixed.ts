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
  connTimeout: 30000,
  keepalive: true,
  debug: process.env.NODE_ENV === 'development' ? console.log : undefined
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
}) {
  imapConfig = {
    ...imapConfig,
    ...config,
    tlsOptions: { rejectUnauthorized: false, servername: config.host }
  };
}

/**
 * Fetch emails for a specific desk using desk-specific IMAP configuration
 */
export function fetchEmailsForDesk(desk: any): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      // Use desk-specific IMAP configuration
      const deskImapConfig = {
        user: desk.imapUser,
        password: desk.imapPassword,
        host: desk.imapHost || 'imap.gmail.com',
        port: parseInt(desk.imapPort) || 993,
        tls: desk.imapSecure !== false,
        tlsOptions: { 
          rejectUnauthorized: false,
          servername: desk.imapHost || 'imap.gmail.com'
        },
        authTimeout: 30000,
        connTimeout: 30000,
        keepalive: true,
        debug: process.env.NODE_ENV === 'development' ? console.log : undefined
      };

      console.log(`🔗 Connecting to IMAP server for ${desk.name}...`);
      
      const imap = new Imap(deskImapConfig);
      
      imap.once('ready', () => {
        console.log(`📬 IMAP connection ready for ${desk.name}, opening mailbox...`);
        
        imap.openBox('INBOX', false, (err, box) => {
          if (err) {
            console.error(`Error opening mailbox for desk ${desk.name}:`, err);
            imap.end();
            return reject(err);
          }
          
          console.log(`📬 INBOX opened for ${desk.name}. Total messages: ${box.messages.total}, Unread: ${box.messages.new}`);
          
          // Search for unread messages
          imap.search(['UNSEEN'], (err, results) => {
            if (err) {
              console.error(`Search error for desk ${desk.name}:`, err);
              imap.end();
              return reject(err);
            }
            
            if (!results || results.length === 0) {
              console.log(`📭 No unread messages found for ${desk.name}`);
              imap.end();
              return resolve();
            }
            
            console.log(`📧 Found ${results.length} unread messages for desk ${desk.name}`);
            
            // Fetch messages with full structure including attachments
            const fetch = imap.fetch(results, { 
              bodies: '',
              struct: true,
              markSeen: true
            });
            
            let processedCount = 0;
            
            fetch.on('message', (msg, seqno) => {
              console.log(`Processing message ${seqno} for desk ${desk.name}`);
              
              let buffer = '';
              
              msg.on('body', (stream) => {
                stream.on('data', (chunk) => {
                  buffer += chunk.toString('utf8');
                });
                
                stream.once('end', () => {
                  processMessageForDesk(buffer, seqno, desk, (err) => {
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
    
    console.log(`\n=== PROCESSING EMAIL FOR DESK ${desk.name} ===`);
    console.log(`From: ${parsed.from?.text}`);
    console.log(`Subject: ${parsed.subject}`);
    console.log(`Date: ${parsed.date}`);
    console.log(`Message ID: ${parsed.messageId}`);
    
    // Extract email date with multiple fallbacks
    let emailDate = parsed.date;
    let dateSource = 'parsed-date';
    
    if (!emailDate && parsed.headers) {
      // Try to extract from Date header
      const dateHeader = parsed.headers.get('date');
      if (dateHeader) {
        try {
          emailDate = new Date(dateHeader.toString());
          dateSource = 'date-header';
          console.log(`📅 Using date from header: ${emailDate.toISOString()}`);
        } catch (e) {
          console.warn(`Failed to parse date header: ${dateHeader}`);
        }
      }
    }
    
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
    
    console.log(`📩 Using email timestamp: ${emailDate.toISOString()} (Source: ${dateSource})`);
    
    // Extract sender information
    const senderEmail = parsed.from?.value?.[0]?.address || '';
    const senderName = parsed.from?.value?.[0]?.name || senderEmail.split('@')[0] || 'Unknown';
    
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
            checksum: createHash('md5').update(attachment.content).digest('hex')
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
        createdAt: emailDate,
        ccRecipients: JSON.stringify([]),
        attachments: JSON.stringify(attachments),
        isSatisfactionResponse: false,
        satisfactionRating: null
      };
      
      await db.insert(messages).values(newMessage);
      
      // Update the ticket's updated timestamp to the email's timestamp
      await db.update(tickets)
        .set({ 
          updatedAt: emailDate,
          status: 'open' // Reopen ticket if it was closed
        })
        .where(eq(tickets.id, relatedTicketId));
        
      console.log(`Successfully added reply to ticket #${relatedTicketId} for desk ${desk.name} with ${attachments.length} attachments`);
    } else {
      console.log(`Creating new ticket for desk ${desk.name} with ${attachments.length} attachments`);
      
      // Create a new ticket assigned to this specific desk
      const newTicket: InsertTicket = {
        subject: parsed.subject || 'No Subject',
        customerName: senderName,
        customerEmail: senderEmail,
        status: 'open',
        deskId: desk.id,
        ccRecipients: JSON.stringify([])
      };
      
      const insertedTicket = await db.insert(tickets).values(newTicket).returning();
      const ticketId = insertedTicket[0].id;
      
      console.log(`Created new ticket #${ticketId} for desk ${desk.name}`);
      
      // Create the initial message with attachments
      const newMessage: InsertMessage = {
        ticketId: ticketId,
        content: content,
        sender: senderName,
        senderEmail: senderEmail,
        isAgent: false,
        messageId: messageId,
        createdAt: emailDate,
        ccRecipients: JSON.stringify([]),
        attachments: JSON.stringify(attachments),
        isSatisfactionResponse: false,
        satisfactionRating: null
      };
      
      await db.insert(messages).values(newMessage);
      
      console.log(`Successfully created ticket #${ticketId} with message and ${attachments.length} attachments for desk ${desk.name}`);
    }
    
    callback();
  } catch (error) {
    console.error(`Error processing message for desk ${desk.name}:`, error);
    callback(error);
  }
}

export { processMessageForDesk };