/**
 * Desk-Specific Email Auto-Polling Service
 * 
 * This service automatically checks each desk's IMAP for unread emails and creates tickets
 */

import { imapService } from '../imap-service';
import { createTicketFromEmail } from '../email';

/**
 * Fetch emails for a specific desk and create tickets from them
 */
const fetchEmailsForDesk = async (desk: any) => {
  console.log(`Fetching emails for desk ${desk.name} (ID: ${desk.id})`);
  
  try {
    // Configure IMAP service for this desk
    const configured = imapService.configureForDesk(desk);
    if (!configured) {
      return { 
        success: false, 
        error: `IMAP configuration for desk ${desk.name} is incomplete` 
      };
    }
    
    // Connect to IMAP server
    const connectResult = await imapService.connect();
    if (!connectResult.success) {
      return { 
        success: false, 
        error: `Failed to connect to IMAP server for desk ${desk.name}: ${connectResult.error}` 
      };
    }
    
    // Fetch and process unread emails
    let newTicketsCount = 0;
    const fetchResult = await imapService.fetchUnreadEmails(async (emails) => {
      console.log(`Processing ${emails.length} new emails for desk ${desk.name}`);
      
      // Process each email
      for (const email of emails) {
        try {
          // Create ticket from email
          const ticketResult = await createTicketFromEmail(email, desk.id);
          if (ticketResult.success) {
            newTicketsCount++;
            console.log(`Created new ticket #${ticketResult.ticketId} from email`);
            
            // Mark the email as seen if ticket was created successfully
            if (email.uid) {
              await imapService.markSeen([email.uid]);
            }
          } else {
            console.error(`Failed to create ticket from email: ${ticketResult.error}`);
          }
        } catch (emailError) {
          console.error('Error processing email:', emailError);
        }
      }
    });
    
    // Disconnect from IMAP server
    imapService.disconnect();
    
    if (!fetchResult.success) {
      return { 
        success: false, 
        error: `Failed to fetch emails for desk ${desk.name}: ${fetchResult.error}` 
      };
    }
    
    return { 
      success: true, 
      newTickets: newTicketsCount 
    };
  } catch (error: any) {
    console.error(`Error in fetchEmailsForDesk for desk ${desk.name}:`, error);
    return { 
      success: false, 
      error: `Error fetching emails for desk ${desk.name}: ${error.message}` 
    };
  } finally {
    // Ensure IMAP connection is closed even if an error occurs
    imapService.disconnect();
  }
};
import { db } from '../db';
import { desks } from '../../database/schema';
import { eq } from 'drizzle-orm';

let pollingIntervals: Map<number, NodeJS.Timeout> = new Map();

/**
 * Start desk-specific email polling service
 */
export async function startGmailAutoPolling() {
  console.log('🔄 Starting desk-specific email auto-polling service...');
  
  try {
    // Get all desks with IMAP configuration
    const allDesks = await db.select().from(desks);
    
    let activePollingCount = 0;
    
    for (const desk of allDesks) {
      // Check if desk has complete IMAP configuration
      if (desk.useImapPolling && desk.imapUser && desk.imapPassword && desk.imapHost) {
        console.log(`Starting polling for desk: ${desk.name} (${desk.imapUser})`);
        startDeskPolling(desk);
        activePollingCount++;
      } else {
        console.log(`Skipping desk ${desk.name} - incomplete IMAP configuration or polling disabled`);
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
 * Check for new emails for a specific desk
 * @returns Result with success flag and number of new tickets
 */
export async function checkDeskForNewEmails(desk: any) {
  console.log(`🔍 Checking emails for desk: ${desk.name} (${desk.imapUser})`);
  
  try {
    const result = await fetchEmailsForDesk(desk);
    return result;
  } catch (error) {
    console.error(`Error fetching emails for desk ${desk.name}:`, error);
    // Return error result but don't throw to prevent stopping other desk polling
    return { 
      success: false, 
      error: `Error checking emails for desk ${desk.name}: ${error instanceof Error ? error.message : String(error)}` 
    };
  }
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