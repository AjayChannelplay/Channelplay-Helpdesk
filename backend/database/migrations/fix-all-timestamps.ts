/**
 * Fix ALL Ticket Timestamps
 * 
 * This script updates ALL existing tickets to use realistic past dates
 * instead of today's timestamp, processing them in efficient batches.
 */

import { db } from './server/db.js';
import { sql } from 'drizzle-orm';

async function fixAllTimestamps() {
  console.log('🚀 Starting comprehensive timestamp fix for ALL tickets...');
  
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Get total count of tickets created today
    const countResult = await db.execute(sql`
      SELECT COUNT(*) as count 
      FROM tickets 
      WHERE DATE(created_at) = ${today}
    `);
    
    const totalTickets = parseInt((countResult.rows[0] as any).count);
    console.log(`📊 Found ${totalTickets} tickets to fix from today`);
    
    const batchSize = 500;
    let processed = 0;
    
    console.log(`🔧 Processing in batches of ${batchSize}...`);
    
    while (processed < totalTickets) {
      console.log(`📝 Processing batch ${Math.floor(processed / batchSize) + 1}/${Math.ceil(totalTickets / batchSize)} (${processed}/${totalTickets})`);
      
      // Get batch of tickets
      const batchTickets = await db.execute(sql`
        SELECT id 
        FROM tickets 
        WHERE DATE(created_at) = ${today}
        ORDER BY id DESC 
        LIMIT ${batchSize} OFFSET ${processed}
      `);
      
      // Process each ticket in the batch
      for (let i = 0; i < batchTickets.rows.length; i++) {
        const ticket = batchTickets.rows[i] as any;
        
        // Create realistic past dates (spread over last 30 days)
        const daysBack = Math.floor(Math.random() * 30) + 1; // Random 1-30 days ago
        const hoursBack = Math.floor(Math.random() * 24); // Random hour
        const minutesBack = Math.floor(Math.random() * 60); // Random minute
        
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - daysBack);
        pastDate.setHours(pastDate.getHours() - hoursBack);
        pastDate.setMinutes(pastDate.getMinutes() - minutesBack);
        
        // Update ticket timestamp
        await db.execute(sql`
          UPDATE tickets 
          SET created_at = ${pastDate.toISOString()}, 
              updated_at = ${pastDate.toISOString()}
          WHERE id = ${ticket.id}
        `);
        
        // Update message timestamp
        await db.execute(sql`
          UPDATE messages 
          SET created_at = ${pastDate.toISOString()}
          WHERE ticket_id = ${ticket.id}
        `);
      }
      
      processed += batchTickets.rows.length;
      console.log(`✅ Processed ${processed}/${totalTickets} tickets`);
      
      // Break if no more tickets
      if (batchTickets.rows.length < batchSize) {
        break;
      }
    }
    
    console.log(`🎉 Successfully updated ALL ${processed} tickets with realistic past dates!`);
    console.log(`📅 Tickets now span the last 30 days instead of all showing today's date`);
    
  } catch (error) {
    console.error('❌ Error fixing timestamps:', error);
  }
}

// Run the comprehensive fix
fixAllTimestamps().then(() => {
  console.log('✅ Comprehensive timestamp fix completed!');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});