import pg from 'pg';
const { Pool } = pg;

// Create a database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Add IMAP columns to the desks table
    console.log('Adding IMAP configuration columns to desks table...');
    
    // Check if columns already exist
    const checkResult = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'desks' AND column_name = 'imap_host'
    `);
    
    if (checkResult.rows.length === 0) {
      await client.query(`
        ALTER TABLE desks 
        ADD COLUMN IF NOT EXISTS imap_host TEXT,
        ADD COLUMN IF NOT EXISTS imap_port TEXT,
        ADD COLUMN IF NOT EXISTS imap_user TEXT,
        ADD COLUMN IF NOT EXISTS imap_password TEXT,
        ADD COLUMN IF NOT EXISTS imap_secure BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS use_imap_polling BOOLEAN DEFAULT FALSE
      `);
      console.log('IMAP columns added successfully');
    } else {
      console.log('IMAP columns already exist, skipping migration');
    }
    
    await client.query('COMMIT');
    console.log('Migration completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    pool.end();
  }
}

runMigration()
  .then(() => {
    console.log('Migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration script failed:', error);
    process.exit(1);
  });