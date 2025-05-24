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