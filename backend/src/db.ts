import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

// Configure WebSocket for Neon Serverless
neonConfig.webSocketConstructor = ws;

// Use documented neon configuration options
// These settings improve connection stability
(neonConfig as any).wsMaxKeepAlive = 60_000; // Increased keep-alive 60 seconds
(neonConfig as any).fetchConnectionCache = true; // Use connection caching

// Verify database URL is set
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

console.log("Initializing database connection with enhanced reliability settings");

// Create connection pool with improved settings
export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 20, // Increase max connections
  idleTimeoutMillis: 30000, // Allow connections to remain idle longer
  connectionTimeoutMillis: 10000, // Increase connection timeout
});

// Define PostgreSQL error type
interface PostgresError extends Error {
  code?: string;
  detail?: string;
  position?: string;
  schema?: string;
  table?: string;
  column?: string;
  dataType?: string;
  constraint?: string;
}

// Add robust error handling for connection issues
pool.on('error', (err: PostgresError) => {
  console.error('Database connection error detected:', err);
  console.log('Connection will be automatically re-established on next query');
  
  // Log more detailed diagnostics for PostgreSQL errors
  if (err.code) {
    console.error(`Error code: ${err.code}, Error detail: ${err.detail || 'none'}`);
    
    // Check if this is a common PostgreSQL error that requires attention
    if (err.code === '57P01' || err.code === '57P02' || err.code === '57P03') {
      console.error('CRITICAL CONNECTION ERROR: Database server terminated unexpectedly');
    } else if (err.code === '3D000') {
      console.error('DATABASE NOT FOUND: The specified database does not exist');
    } else if (err.code === '28P01') {
      console.error('AUTHENTICATION ERROR: Invalid username or password');
    } else if (err.code === '53300') {
      console.error('CONNECTION LIMIT EXCEEDED: Too many connections to the database');
    }
  } else {
    console.error('Generic database error (no error code):', err.message);
  }
});

// Create drizzle ORM instance
export const db = drizzle(pool, { schema });

// Export a function to test database connectivity
export async function testDatabaseConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      console.log('✅ Database connection successful');
      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Database connection test failed:', error);
    return false;
  }
}