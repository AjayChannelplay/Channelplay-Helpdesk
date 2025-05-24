import pg from '@neondatabase/serverless';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { config } from 'dotenv';

const { Pool } = pg;

async function runMigration() {
  try {
    console.log('Starting migration...');
    
    // Connect to the database
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    
    // Test the connection
    const client = await pool.connect();
    console.log('Connected to database');
    
    try {
      // Check if attachments column exists 
      const checkColumnQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'messages' AND column_name = 'attachments';
      `;
      
      const checkResult = await client.query(checkColumnQuery);
      
      if (checkResult.rowCount === 0) {
        console.log('Adding attachments column to messages table...');
        
        // Add the attachments column if it doesn't exist
        await client.query(`
          ALTER TABLE messages 
          ADD COLUMN attachments JSONB DEFAULT '[]'::jsonb;
        `);
        
        console.log('Successfully added attachments column to messages table');
      } else {
        console.log('Attachments column already exists in messages table');
      }
      
      console.log('Migration completed successfully');
    } finally {
      client.release();
    }
    
    await pool.end();
    
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigration();