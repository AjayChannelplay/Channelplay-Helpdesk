import { users, type User, type InsertUser, tickets, type Ticket, type InsertTicket, messages, type Message, type InsertMessage, desks, type Desk, type InsertDesk, deskAssignments, type DeskAssignment, type InsertDeskAssignment } from "@shared/schema";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcrypt";
import { db, pool } from "./db";
import { eq, desc, asc, or, inArray, sql } from "drizzle-orm";

const PostgresSessionStore = connectPg(session);

export interface IStorage {
  // User management
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, userData: Partial<Omit<InsertUser, "password"> & { isVerified?: boolean }>): Promise<User | undefined>;
  updateUserPassword(id: number, password: string): Promise<User | undefined>;
  deleteUser(id: number): Promise<boolean>;
  setResetToken(email: string, token: string, expiryHours: number): Promise<boolean>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  clearResetToken(userId: number): Promise<boolean>;
  generateOTP(userId: number): Promise<string>;
  verifyOTP(userId: number, otp: string): Promise<boolean>;
  getUserByOTP(otp: string): Promise<User | undefined>;
  updateUserVerification(userId: number, isVerified: boolean): Promise<boolean>;
  updateUserSetupRequired(userId: number, requiresSetup: boolean): Promise<boolean>;
  
  // Desk management
  getDesks(): Promise<Desk[]>;
  getDeskById(id: number): Promise<Desk | undefined>;
  getDeskByEmail(email: string): Promise<Desk | undefined>;
  getDefaultDesk(): Promise<Desk | undefined>;
  createDesk(desk: InsertDesk): Promise<Desk>;
  updateDesk(id: number, deskData: Partial<InsertDesk>): Promise<Desk | undefined>;
  deleteDesk(id: number): Promise<boolean>;
  
  // Message management with enhanced capabilities for email threading
  getAllMessages(): Promise<Message[]>; // Added for improved email thread detection
  
  // Desk assignments
  getDeskAssignments(userId?: number, deskId?: number): Promise<DeskAssignment[]>;
  assignUserToDesk(userId: number, deskId: number): Promise<DeskAssignment>;
  removeUserFromDesk(userId: number, deskId: number): Promise<boolean>;
  getUserDesks(userId: number): Promise<Desk[]>;
  getDeskUsers(deskId: number): Promise<User[]>;
  
  // Ticket management
  getTickets(options?: {
    sortBy?: string;
    sortOrder?: string;
    deskId?: number;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<Ticket[]>;
  getTicketsCount(options?: {
    deskId?: number;
    status?: string;
  }): Promise<number>;
  getTicketById(id: number): Promise<Ticket | undefined>;
  createTicket(ticket: InsertTicket): Promise<Ticket>;
  updateTicket(id: number, updates: Partial<Ticket>): Promise<Ticket | undefined>;
  updateTicketStatus(id: number, status: string): Promise<Ticket | undefined>;
  
  // Message management
  getMessagesByTicketId(ticketId: number): Promise<Message[]>;
  getMessagesByExactId(messageId: string): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  
  sessionStore: session.Store;
}

export class DatabaseStorage implements IStorage {
  // In-memory OTP cache for fallback when DB columns don't exist yet
  private _otpCache: {[userId: number]: {otp: string, expiry: Date}} = {};
  sessionStore: session.Store;

  constructor() {
    this.sessionStore = new PostgresSessionStore({ 
      pool, 
      createTableIfMissing: true 
    });
    
    // Initialize database with default users
    this.initializeDatabase();
  }
  
  private async initializeDatabase() {
    try {
      // Check if admin user exists
      const adminUser = await this.getUserByUsername("admin");
      if (!adminUser) {
        // Create admin user
        await this.createUser({
          username: "admin",
          password: "password123",
          name: "Admin User",
          email: "admin@example.com",
          role: "admin",
          isVerified: true,
          requiresSetup: false
        });
        
        console.log("Admin user created successfully");
      }
      
      // Check if agent user exists
      const agentUser = await this.getUserByUsername("agent");
      if (!agentUser) {
        // Create agent user
        await this.createUser({
          username: "agent",
          password: "password",
          name: "John Doe",
          email: "agent@example.com"
        });
        
        console.log("Agent user created successfully");
      }

      // Default desk auto-creation disabled per user request
      console.log("Default desk auto-creation is disabled");
      
      // Check for tickets without a deskId and assign them to the default desk
      const defaultDeskExists = await this.getDefaultDesk();
      if (defaultDeskExists) {
        // Update all tickets without a desk to use the default desk
        try {
          await db.update(tickets)
            .set({ deskId: defaultDeskExists.id })
            .where(eq(tickets.deskId, null));
          console.log("Updated orphaned tickets to use the default desk");
        } catch (err) {
          console.error("Error updating orphaned tickets:", err);
        }
      }
    } catch (error) {
      console.error("Error initializing database:", error);
    }
  }

  async getUser(id: number): Promise<User | undefined> {
    try {
      // First try using a simpler query with all needed columns
      const { rows } = await pool.query(
        `SELECT id, username, password, name, email, role, created_at, updated_at, 
         reset_token, reset_token_expiry, requires_setup, is_verified
         FROM users WHERE id = $1`, [id]
      );
      
      if (rows.length === 0) return undefined;
      
      // Return a user object with proper verification status
      const row = rows[0];
      return {
        id: Number(row.id),
        username: String(row.username),
        password: String(row.password),
        name: String(row.name),
        email: String(row.email),
        role: String(row.role || 'agent'),
        createdAt: new Date(String(row.created_at)),
        updatedAt: new Date(String(row.updated_at)),
        resetToken: row.reset_token,
        resetTokenExpiry: row.reset_token_expiry ? new Date(String(row.reset_token_expiry)) : null,
        requiresSetup: Boolean(row.requires_setup),
        // Set OTP fields
        otpCode: null,
        otpExpiry: null,
        isVerified: Boolean(row.is_verified)
      };
    } catch (error) {
      console.error("Error in getUser:", error);
      return undefined;
    }
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    try {
      // First try using a simpler query with fewer columns
      const { rows } = await pool.query(
        `SELECT id, username, password, name, email, role, created_at, updated_at, 
         reset_token, reset_token_expiry, requires_setup, is_verified
         FROM users WHERE username = $1`, [username]
      );
      
      if (rows.length === 0) return undefined;
      
      // Return a user object with proper OTP fields
      const row = rows[0];
      return {
        id: Number(row.id),
        username: String(row.username),
        password: String(row.password),
        name: String(row.name),
        email: String(row.email),
        role: String(row.role || 'agent'),
        createdAt: new Date(String(row.created_at)),
        updatedAt: new Date(String(row.updated_at)),
        resetToken: row.reset_token,
        resetTokenExpiry: row.reset_token_expiry ? new Date(String(row.reset_token_expiry)) : null,
        requiresSetup: Boolean(row.requires_setup),
        // Set OTP fields
        otpCode: null,
        otpExpiry: null,
        isVerified: row.is_verified ? true : false
      };
    } catch (error) {
      console.error("Error in getUserByUsername:", error);
      return undefined;
    }
  }
  
  async getUserByEmail(email: string): Promise<User | undefined> {
    try {
      // First try using a simpler query with all needed columns
      const { rows } = await pool.query(
        `SELECT id, username, password, name, email, role, created_at, updated_at, 
         reset_token, reset_token_expiry, requires_setup, is_verified
         FROM users WHERE email = $1`, [email]
      );
      
      if (rows.length === 0) return undefined;
      
      // Return a user object with proper verification status
      const row = rows[0];
      return {
        id: Number(row.id),
        username: String(row.username),
        password: String(row.password),
        name: String(row.name),
        email: String(row.email),
        role: String(row.role || 'agent'),
        createdAt: new Date(String(row.created_at)),
        updatedAt: new Date(String(row.updated_at)),
        resetToken: row.reset_token,
        resetTokenExpiry: row.reset_token_expiry ? new Date(String(row.reset_token_expiry)) : null,
        requiresSetup: Boolean(row.requires_setup),
        // Set OTP fields
        otpCode: null,
        otpExpiry: null,
        isVerified: Boolean(row.is_verified)
      };
    } catch (error) {
      console.error("Error in getUserByEmail:", error);
      return undefined;
    }
  }
  
  async getUsers(): Promise<User[]> {
    try {
      // First try using a simpler query with all needed columns
      const { rows } = await pool.query(
        `SELECT id, username, password, name, email, role, created_at, updated_at, 
         reset_token, reset_token_expiry, requires_setup, is_verified
         FROM users ORDER BY username`
      );
      
      // Return user objects with proper verification status
      return rows.map(row => ({
        id: Number(row.id),
        username: String(row.username),
        password: String(row.password),
        name: String(row.name),
        email: String(row.email),
        role: String(row.role || 'agent'),
        createdAt: new Date(String(row.created_at)),
        updatedAt: new Date(String(row.updated_at)),
        resetToken: row.reset_token,
        resetTokenExpiry: row.reset_token_expiry ? new Date(String(row.reset_token_expiry)) : null,
        requiresSetup: Boolean(row.requires_setup),
        // Set OTP fields
        otpCode: null,
        otpExpiry: null,
        isVerified: Boolean(row.is_verified)
      }));
    } catch (error) {
      console.error("Error in getUsers:", error);
      return [];
    }
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    try {
      // Hash the password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(insertUser.password, salt);
      
      // First try the ORM approach
      try {
        const [user] = await db.insert(users)
          .values({
            ...insertUser,
            password: hashedPassword
          })
          .returning();
        
        return user;
      } catch (ormError) {
        // If it fails due to missing columns, try direct SQL
        console.log('ORM insert failed, falling back to direct SQL:', (ormError as Error).message);
        
        // Use a direct SQL query with all required columns
        const { rows } = await pool.query(
          `INSERT INTO users (username, password, name, email, role, requires_setup, is_verified) 
           VALUES ($1, $2, $3, $4, $5, $6, $7) 
           RETURNING id, username, name, email, role, created_at, updated_at, requires_setup, is_verified`,
          [
            insertUser.username,
            hashedPassword,
            insertUser.name,
            insertUser.email,
            insertUser.role || 'agent',
            insertUser.requiresSetup === undefined ? false : insertUser.requiresSetup,
            insertUser.isVerified === undefined ? false : insertUser.isVerified
          ]
        );
        
        if (rows.length === 0) {
          throw new Error('Failed to create user');
        }
        
        // Return a user object with correct isVerified field
        const row = rows[0];
        return {
          id: Number(row.id),
          username: String(row.username),
          password: hashedPassword, // We need to return this for login to work
          name: String(row.name),
          email: String(row.email),
          role: String(row.role || 'agent'),
          createdAt: new Date(String(row.created_at)),
          updatedAt: new Date(String(row.updated_at)),
          resetToken: null,
          resetTokenExpiry: null,
          requiresSetup: Boolean(row.requires_setup),
          // Set OTP fields and use the returned isVerified value
          otpCode: null,
          otpExpiry: null,
          isVerified: Boolean(row.is_verified)
        };
      }
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }
  
  async updateUser(id: number, userData: Partial<Omit<InsertUser, "password"> & { isVerified?: boolean }>): Promise<User | undefined> {
    try {
      // First try with ORM
      try {
        const [updatedUser] = await db.update(users)
          .set({
            ...userData,
            updatedAt: new Date()
          })
          .where(eq(users.id, id))
          .returning();
          
        return updatedUser;
      } catch (ormError) {
        // If ORM fails, try direct SQL approach
        console.log('ORM update failed, falling back to direct SQL:', (ormError as Error).message);
        
        // Build SET clause dynamically based on what properties are in userData
        const updateParts = [];
        const values = [];
        let paramIndex = 1;
        
        if (userData.username !== undefined) {
          updateParts.push(`username = $${paramIndex}`);
          values.push(userData.username);
          paramIndex++;
        }
        
        if (userData.name !== undefined) {
          updateParts.push(`name = $${paramIndex}`);
          values.push(userData.name);
          paramIndex++;
        }
        
        if (userData.email !== undefined) {
          updateParts.push(`email = $${paramIndex}`);
          values.push(userData.email);
          paramIndex++;
        }
        
        if (userData.role !== undefined) {
          updateParts.push(`role = $${paramIndex}`);
          values.push(userData.role);
          paramIndex++;
        }
        
        if (userData.requiresSetup !== undefined) {
          updateParts.push(`requires_setup = $${paramIndex}`);
          values.push(userData.requiresSetup);
          paramIndex++;
        }
        
        if (userData.isVerified !== undefined) {
          updateParts.push(`is_verified = $${paramIndex}`);
          values.push(userData.isVerified);
          paramIndex++;
        }
        
        // Always update updated_at
        updateParts.push(`updated_at = $${paramIndex}`);
        values.push(new Date());
        paramIndex++;
        
        // Add the ID for the WHERE clause
        values.push(id);
        
        if (updateParts.length === 0) {
          // Nothing to update
          return await this.getUser(id);
        }
        
        const query = `
          UPDATE users 
          SET ${updateParts.join(', ')} 
          WHERE id = $${paramIndex} 
          RETURNING id, username, name, email, role, created_at, updated_at, requires_setup, is_verified
        `;
        
        const { rows } = await pool.query(query, values);
        
        if (rows.length === 0) {
          return undefined;
        }
        
        // Return user with proper isVerified field
        const row = rows[0];
        return {
          id: Number(row.id),
          username: String(row.username),
          // We need to get the password from the DB
          password: (await this.getUser(id))?.password || '',
          name: String(row.name),
          email: String(row.email),
          role: String(row.role || 'agent'),
          createdAt: new Date(String(row.created_at)),
          updatedAt: new Date(String(row.updated_at)),
          resetToken: null,
          resetTokenExpiry: null,
          requiresSetup: Boolean(row.requires_setup),
          // Set OTP fields
          otpCode: null,
          otpExpiry: null,
          isVerified: Boolean(row.is_verified)
        };
      }
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }
  
  async updateUserPassword(id: number, password: string): Promise<User | undefined> {
    try {
      console.log(`Updating password for user ID ${id}`);
      
      // If the password is already hashed (from the auth.ts hashPassword function), use it directly
      // Otherwise, hash it here
      let hashedPassword = password;
      if (!password.includes('.')) { // Simple check if it's not already in our hash format
        console.log('Password needs hashing, performing hash operation');
        const salt = await bcrypt.genSalt(10);
        hashedPassword = await bcrypt.hash(password, salt);
      } else {
        console.log('Password appears to already be hashed, using as-is');
      }
      
      console.log('Using direct SQL for password update to ensure reliability');
      // Always use direct SQL for password updates to ensure it works correctly
      const query = `
        UPDATE users 
        SET password = $1, updated_at = $2, reset_token = NULL, reset_token_expiry = NULL
        WHERE id = $3 
        RETURNING id, username, password, name, email, role, created_at, updated_at, requires_setup, is_verified
      `;
      
      const { rows } = await pool.query(query, [
        hashedPassword, 
        new Date(), 
        id
      ]);
      
      if (rows.length === 0) {
        console.log(`No user found with ID ${id}, password update failed`);
        return undefined;
      }
      
      // Return user with the updated password and proper isVerified field
      const row = rows[0];
      console.log(`Password updated successfully for user ${row.username} (ID: ${row.id})`);
      
      return {
        id: Number(row.id),
        username: String(row.username),
        password: String(row.password), // Return the stored hashed password from the DB
        name: String(row.name),
        email: String(row.email),
        role: String(row.role || 'agent'),
        createdAt: new Date(String(row.created_at)),
        updatedAt: new Date(String(row.updated_at)),
        resetToken: null,
        resetTokenExpiry: null,
        requiresSetup: Boolean(row.requires_setup),
        // Set OTP fields
        otpCode: null,
        otpExpiry: null,
        isVerified: Boolean(row.is_verified)
      };
    } catch (error) {
      console.error('Error updating user password:', error);
      throw error;
    }
  }
  
  async deleteUser(id: number): Promise<boolean> {
    // Use a transaction to ensure all operations succeed or fail together
    const client = await pool.connect();
    
    try {
      // First check if user exists
      const user = await this.getUser(id);
      if (!user) {
        console.log(`User with ID ${id} not found for deletion`);
        return false;
      }
      
      console.log(`Starting transaction to delete user ${id} (${user.username})`);
      await client.query('BEGIN');
      
      try {
        // 1. Check and handle tickets assigned to this user
        console.log(`Checking for tickets assigned to user ${id}`);
        const ticketUpdate = await client.query(
          `UPDATE tickets SET assigned_user_id = NULL WHERE assigned_user_id = $1 RETURNING id`,
          [id]
        );
        console.log(`Unassigned ${ticketUpdate.rowCount} tickets from user ${id}`);
        
        // 2. Delete all desk assignments for this user
        console.log(`Removing desk assignments for user ${id}`);
        const deskResult = await client.query(
          `DELETE FROM desk_assignments WHERE user_id = $1 RETURNING desk_id`,
          [id]
        );
        console.log(`Removed ${deskResult.rowCount} desk assignments for user ${id}`);
        
        // 3. Delete the user
        console.log(`Deleting user ${id}`);
        const result = await client.query(
          `DELETE FROM users WHERE id = $1 RETURNING id, username`,
          [id]
        );
        
        await client.query('COMMIT');
        
        console.log(`User deletion complete. Deleted user ${id} (${user.username}). Affected rows: ${result.rowCount}`);
        return result.rowCount > 0;
      } catch (innerError) {
        // If any operation fails, roll back the transaction
        await client.query('ROLLBACK');
        console.error(`Error during user deletion transaction for user ${id}:`, innerError);
        
        // Log more specific errors based on error codes
        if (innerError.code === '23503') {
          console.error(`Foreign key constraint violation. User ${id} has related data that prevents deletion.`);
        }
        
        return false;
      }
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error("Error during transaction rollback:", rollbackError);
      }
      
      console.error(`Error in deleteUser for user ${id}:`, error);
      return false;
    } finally {
      client.release();
    }
  }
  
  async setResetToken(email: string, token: string, expiryHours: number = 24): Promise<boolean> {
    try {
      const user = await this.getUserByEmail(email);
      if (!user) return false;
      
      const expiry = new Date();
      expiry.setHours(expiry.getHours() + expiryHours);
      
      try {
        // First try with ORM
        await db.update(users)
          .set({
            resetToken: token,
            resetTokenExpiry: expiry,
            updatedAt: new Date()
          })
          .where(eq(users.id, user.id));
      } catch (ormError) {
        // If ORM fails, try direct SQL
        console.log('ORM reset token update failed, falling back to direct SQL:', (ormError as Error).message);
        
        const query = `
          UPDATE users 
          SET reset_token = $1, reset_token_expiry = $2, updated_at = $3
          WHERE id = $4
        `;
        
        await pool.query(query, [token, expiry, new Date(), user.id]);
      }
      
      return true;
    } catch (error) {
      console.error("Error setting reset token:", error);
      return false;
    }
  }
  
  async getUserByResetToken(token: string): Promise<User | undefined> {
    try {
      // Get current time
      const now = new Date();
      
      try {
        // First try ORM approach
        const [user] = await db.select()
          .from(users)
          .where(eq(users.resetToken, token));
        
        // Check if token is expired
        if (user && user.resetTokenExpiry && new Date(user.resetTokenExpiry) > now) {
          return user;
        }
      } catch (ormError) {
        // If ORM fails, try direct SQL
        console.log('ORM getUserByResetToken failed, falling back to direct SQL:', (ormError as Error).message);
        
        const { rows } = await pool.query(
          `SELECT id, username, password, name, email, role, created_at, updated_at, 
           reset_token, reset_token_expiry, requires_setup
           FROM users WHERE reset_token = $1`, [token]
        );
        
        if (rows.length === 0) return undefined;
        
        const row = rows[0];
        // Check if token is expired
        if (row.reset_token_expiry && new Date(String(row.reset_token_expiry)) > now) {
          // Return user with default values for missing fields
          return {
            id: Number(row.id),
            username: String(row.username),
            password: String(row.password),
            name: String(row.name),
            email: String(row.email),
            role: String(row.role || 'agent'),
            createdAt: new Date(String(row.created_at)),
            updatedAt: new Date(String(row.updated_at)),
            resetToken: row.reset_token,
            resetTokenExpiry: row.reset_token_expiry ? new Date(String(row.reset_token_expiry)) : null,
            requiresSetup: Boolean(row.requires_setup),
            // Set default values for OTP fields
            otpCode: null,
            otpExpiry: null,
            isVerified: false
          };
        }
      }
      
      return undefined;
    } catch (error) {
      console.error("Error finding user by reset token:", error);
      return undefined;
    }
  }
  
  async clearResetToken(userId: number): Promise<boolean> {
    try {
      try {
        // First try with ORM
        await db.update(users)
          .set({
            resetToken: null,
            resetTokenExpiry: null,
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));
      } catch (ormError) {
        // If ORM fails, try direct SQL
        console.log('ORM clearResetToken failed, falling back to direct SQL:', (ormError as Error).message);
        
        await pool.query(
          `UPDATE users SET reset_token = NULL, reset_token_expiry = NULL, updated_at = $1 
           WHERE id = $2`, 
          [new Date(), userId]
        );
      }
      
      return true;
    } catch (error) {
      console.error("Error clearing reset token:", error);
      return false;
    }
  }
  
  async generateOTP(userId: number): Promise<string> {
    try {
      // Generate a 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      console.log(`Generated OTP for user ${userId}: ${otp}`);
      
      // Set expiry for 15 minutes
      const expiry = new Date();
      expiry.setMinutes(expiry.getMinutes() + 15);
      console.log(`OTP expiry set to: ${expiry.toISOString()}`);
      
      // Always store in memory cache regardless of DB status
      this._otpCache[userId] = {
        otp: otp,
        expiry: expiry
      };
      console.log(`Stored OTP in memory cache for user ${userId}`);
      
      try {
        // Try to update with ORM first
        console.log(`Attempting to store OTP in database for user ${userId}`);
        await db.update(users)
          .set({
            otpCode: otp,
            otpExpiry: expiry,
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));
        console.log(`Successfully stored OTP in database for user ${userId}`);
      } catch (error) {
        // Log the error but continue since we have the memory cache as backup
        const ormError = error as Error;
        console.log(`OTP DB storage failed, will use memory cache. Error: ${ormError.message}`);
        
        // Try fallback to direct SQL
        try {
          console.log(`Attempting direct SQL OTP storage for user ${userId}`);
          const query = `
            UPDATE users 
            SET otp_code = $1, otp_expiry = $2, updated_at = $3
            WHERE id = $4
          `;
          
          await pool.query(query, [otp, expiry, new Date(), userId]);
          console.log(`Direct SQL OTP storage successful for user ${userId}`);
        } catch (sqlError) {
          console.log(`Direct SQL OTP storage also failed: ${(sqlError as Error).message}`);
          console.log(`Will rely solely on memory cache for user ${userId}'s OTP`);
        }
      }
      
      return otp;
    } catch (error) {
      console.error("Error generating OTP:", error);
      throw error;
    }
  }
  
  async verifyOTP(userId: number, otp: string): Promise<boolean> {
    try {
      // Get the user
      const user = await this.getUser(userId);
      if (!user) {
        console.log(`User with ID ${userId} not found for OTP verification`);
        return false;
      }
      
      // Check if OTP is in memory cache first (fallback if columns don't exist yet)
      const now = new Date();
      console.log(`Verifying OTP for user ${userId}, current time: ${now.toISOString()}`);
      
      // Check memory cache first (if we're using it as a fallback)
      if (this._otpCache && this._otpCache[userId]) {
        console.log(`Found OTP in memory cache for user ${userId}`);
        const cachedOtp = this._otpCache[userId];
        console.log(`Cache data: OTP first digits ${cachedOtp.otp.substring(0, 2)}****, expiry: ${cachedOtp.expiry.toISOString()}, expired: ${cachedOtp.expiry < now}`);
        console.log(`Submitted OTP first digits: ${otp.substring(0, 2)}****`);
        console.log(`OTP match: ${cachedOtp.otp === otp}, Expiry valid: ${cachedOtp.expiry > now}`);
        
        if (cachedOtp.otp === otp && cachedOtp.expiry > now) {
          // Clear the cache entry
          console.log(`Valid OTP from cache for user ${userId}, clearing cache entry`);
          delete this._otpCache[userId];
          
          // Try to update the verified status in DB if column exists
          try {
            console.log(`Updating user ${userId} isVerified status in database`);
            await db.update(users)
              .set({
                isVerified: true,
                updatedAt: new Date()
              })
              .where(eq(users.id, userId));
            console.log(`Successfully updated isVerified status for user ${userId}`);
          } catch (error) {
            // Silently ignore if column doesn't exist yet
            const dbError = error as Error;
            console.log(`Could not update isVerified status: ${dbError.message}`);
          }
          
          return true;
        }
        console.log(`Invalid OTP from cache for user ${userId}: code mismatch or expired`);
        return false;
      } else {
        console.log(`No OTP in memory cache for user ${userId}, checking database`);
      }
      
      // Fallback to checking DB if not in memory cache
      if (user.otpCode) {
        console.log(`DB OTP check: stored=${user.otpCode.substring(0, 2)}****, submitted=${otp.substring(0, 2)}****`);
        console.log(`OTP expiry in DB: ${user.otpExpiry ? new Date(user.otpExpiry).toISOString() : 'none'}`);
        console.log(`OTP expired: ${user.otpExpiry ? new Date(user.otpExpiry) < now : 'N/A'}`); 
        console.log(`OTP match: ${user.otpCode === otp}`);
      } else {
        console.log(`No OTP code stored in database for user ${userId}`);
      }
      
      if (
        user.otpCode === otp && 
        user.otpExpiry && 
        new Date(user.otpExpiry) > now
      ) {
        console.log(`Valid OTP from database for user ${userId}`);
        try {
          // Mark user as verified and clear OTP
          console.log(`Updating user ${userId} as verified and clearing OTP in database`);
          await db.update(users)
            .set({
              isVerified: true,
              otpCode: null,
              otpExpiry: null,
              updatedAt: new Date()
            })
            .where(eq(users.id, userId));
          console.log(`Successfully updated verification status for user ${userId}`);
        } catch (error) {
          const dbError = error as Error;
          console.log(`Error updating verification status: ${dbError.message}`);
        }
        
        return true;
      }
      
      // Last attempt: Direct comparison regardless of expiry (for testing/debugging)
      if (user.otpCode === otp) {
        console.log(`OTP code matches but may be expired for user ${userId}`);
      }
      
      console.log(`OTP verification failed for user ${userId}: invalid code or expired`);
      return false;
    } catch (error) {
      console.error("Error verifying OTP:", error);
      return false;
    }
  }
  
  async getUserByOTP(otp: string): Promise<User | undefined> {
    try {
      const now = new Date();
      
      // First check in-memory cache
      for (const [userId, cachedData] of Object.entries(this._otpCache)) {
        if (cachedData.otp === otp && cachedData.expiry > now) {
          // Found matching OTP in cache, get the user
          return this.getUser(parseInt(userId));
        }
      }
      
      // If not in cache, try DB (may fail if column doesn't exist yet)
      try {
        // Find user with matching OTP that hasn't expired
        const [user] = await db.select()
          .from(users)
          .where(eq(users.otpCode, otp));
        
        // Check if OTP is expired
        if (user && user.otpExpiry && new Date(user.otpExpiry) > now) {
          return user;
        }
      } catch (error) {
        const dbError = error as Error;
        console.log('Could not query by OTP:', dbError.message);
      }
      
      return undefined;
    } catch (error) {
      console.error("Error finding user by OTP:", error);
      return undefined;
    }
  }
  
  /**
   * Update user verification status
   * @param userId User ID
   * @param isVerified Whether the user is verified
   * @returns Success status
   */
  async updateUserVerification(userId: number, isVerified: boolean): Promise<boolean> {
    try {
      console.log(`Updating verification status for user ${userId} to ${isVerified}`);
      
      try {
        // Try ORM approach first
        await db.update(users)
          .set({
            isVerified,
            // If we're verifying the user, also clear any OTP
            ...(isVerified ? { otpCode: null, otpExpiry: null } : {})
          })
          .where(eq(users.id, userId));
      } catch (ormError) {
        // Fall back to direct SQL
        console.log('ORM update failed, falling back to direct SQL:', (ormError as Error).message);
        
        await pool.query(
          `UPDATE users SET 
            is_verified = $1, 
            otp = $2, 
            otp_expires_at = $3,
            updated_at = NOW()
           WHERE id = $4`,
          [isVerified, null, null, userId]
        );
      }
      
      // Also update OTP cache if we're verifying this user
      if (isVerified && this._otpCache[userId]) {
        delete this._otpCache[userId];
      }
      
      console.log(`Successfully updated verification status for user ${userId}`);
      return true;
    } catch (error) {
      console.error(`Error updating verification for user ${userId}:`, error);
      return false;
    }
  }
  
  /**
   * Update whether a user requires first-time setup
   * @param userId User ID
   * @param requiresSetup Whether the user requires setup
   * @returns Success status
   */
  async updateUserSetupRequired(userId: number, requiresSetup: boolean): Promise<boolean> {
    try {
      console.log(`Updating setup required status for user ${userId} to ${requiresSetup}`);
      
      try {
        // Try ORM approach first
        await db.update(users)
          .set({ 
            requiresSetup,
            updatedAt: new Date() 
          })
          .where(eq(users.id, userId));
      } catch (ormError) {
        // Fall back to direct SQL
        console.log('ORM update failed, falling back to direct SQL:', (ormError as Error).message);
        
        await pool.query(
          `UPDATE users SET 
            requires_setup = $1, 
            updated_at = NOW()
           WHERE id = $2`,
          [requiresSetup, userId]
        );
      }
      
      console.log(`Successfully updated setup required status for user ${userId}`);
      return true;
    } catch (error) {
      console.error(`Error updating setup required for user ${userId}:`, error);
      return false;
    }
  }
  
  // This original method is intentionally left empty as it's replaced by the version at the end of the class
  async getTickets(_deskId?: number): Promise<Ticket[]> {
    return this.getTicketsByDesk(_deskId);
  }
  
  async getTicketById(id: number): Promise<Ticket | undefined> {
    console.log(`DB: Getting ticket with ID: ${id}`);
    try {
      const [ticket] = await db.select()
        .from(tickets)
        .where(eq(tickets.id, id));
        
      if (ticket) {
        console.log(`DB: Found ticket ${id}: Subject: "${ticket.subject}", Status: ${ticket.status}, DeskId: ${ticket.deskId}, AssignedUserId: ${ticket.assignedUserId || 'none'}`);
      } else {
        console.log(`DB: No ticket found with ID ${id}`);
      }
      
      return ticket;
    } catch (error) {
      console.error(`DB: Error fetching ticket ${id}:`, error);
      
      try {
        // Try a more basic query without ORM
        const { rows } = await pool.query(
          `SELECT id, subject, status, customer_name, customer_email, 
           created_at, updated_at, desk_id, assigned_user_id, resolved_at 
           FROM tickets WHERE id = $1`, [id]
        );
        
        if (rows.length === 0) {
          return undefined;
        }
        
        const row = rows[0];
        // Convert to our expected format
        return {
          id: Number(row.id),
          subject: String(row.subject),
          status: String(row.status),
          customerName: String(row.customer_name),
          customerEmail: String(row.customer_email),
          createdAt: new Date(String(row.created_at)),
          updatedAt: new Date(String(row.updated_at)),
          deskId: row.desk_id ? Number(row.desk_id) : null,
          assignedUserId: row.assigned_user_id ? Number(row.assigned_user_id) : null,
          resolvedAt: row.resolved_at ? new Date(String(row.resolved_at)) : null
        };
      } catch (fallbackError) {
        console.error("Critical error fetching ticket by ID:", fallbackError);
        return undefined;
      }
    }
  }
  
  async createTicket(insertTicket: InsertTicket): Promise<Ticket> {
    try {
      console.log(`🎫 Creating new ticket with desk ID ${insertTicket.deskId || 'none'}`);
      
      // Verify the desk exists if a desk ID is provided
      if (insertTicket.deskId) {
        const desk = await this.getDeskById(insertTicket.deskId);
        if (desk) {
          console.log(`✓ Verified desk ${desk.name} (${desk.email}) exists with ID ${desk.id}`);
        } else {
          console.log(`⚠️ WARNING: Desk ID ${insertTicket.deskId} does not exist in database. This may cause issues.`);
        }
      }
      
      // If a desk is specified but no assigned user, implement round-robin assignment
      if (insertTicket.deskId && !insertTicket.assignedUserId) {
        console.log(`🔄 Starting round-robin assignment for desk ID ${insertTicket.deskId}`);
        
        // Get a list of all assigned users for this desk to verify
        const deskUsers = await this.getDeskUsers(insertTicket.deskId);
        console.log(`👥 Available users for desk ID ${insertTicket.deskId}: ${deskUsers.length > 0 ? 
          deskUsers.map(u => `${u.name} (ID: ${u.id})`).join(', ') : 
          'None - no auto-assignment possible'}`);
          
        const assignedUserId = await this.getNextUserForDeskAssignment(insertTicket.deskId);
        
        if (assignedUserId) {
          insertTicket.assignedUserId = assignedUserId;
          const assignedUser = await this.getUser(assignedUserId);
          console.log(`✅ Assigned ticket to user ${assignedUser?.name || 'Unknown'} (ID: ${assignedUserId}) via round-robin`);
        } else {
          console.log(`⚠️ No users available for assignment to desk ${insertTicket.deskId}`);
        }
      } else if (insertTicket.assignedUserId) {
        console.log(`🔒 Ticket already assigned to user ID ${insertTicket.assignedUserId}, skipping round-robin`);
      } else {
        console.log(`⚠️ No desk ID provided, cannot assign ticket via round-robin`);
      }

      const [ticket] = await db.insert(tickets)
        .values({
          ...insertTicket,
          status: insertTicket.status || 'open',
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .returning();
      
      console.log(`✅ Created ticket #${ticket.id} with subject "${ticket.subject}" and assignedUserId=${ticket.assignedUserId || 'none'}`);
      return ticket;
    } catch (error) {
      console.error("❌ Error creating ticket with round-robin assignment:", error);
      // Fallback: create ticket without assignment
      console.log(`⚠️ Using fallback ticket creation without assignment due to error`);
      const [ticket] = await db.insert(tickets)
        .values({
          ...insertTicket,
          status: insertTicket.status || 'open',
          assignedUserId: null, // Explicitly remove any assignment that might have failed
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .returning();
        
      return ticket;
    }
  }
  
  // Helper method to get the next user for round-robin assignment
  async getNextUserForDeskAssignment(deskId: number): Promise<number | null> {
    try {
      console.log(`🔄 Starting round-robin assignment for desk ID ${deskId}`);
      
      // Get desk info for better logging
      const deskInfo = await this.getDeskById(deskId);
      console.log(`📋 Desk info: ${deskInfo ? `${deskInfo.name} (${deskInfo.email})` : 'Unknown desk'}`);
      
      // Get all users assigned to this desk
      const users = await this.getDeskUsers(deskId);
      if (users.length === 0) {
        console.log(`⚠️ No users assigned to desk ${deskId} - can't assign ticket`);
        return null; // No users assigned to desk
      }
      
      console.log(`👥 Found ${users.length} users assigned to desk ${deskId}: ${users.map(u => `${u.name} (ID: ${u.id})`).join(', ')}`);
      
      // Get most recent ticket assigned to any of these users
      const userIds = users.map(user => user.id);
      
      // Create placeholders for SQL query
      const placeholders = userIds.map((_, i) => `$${i + 2}`).join(',');
      
      // Query to find the most recently assigned ticket for this desk
      const query = `
        SELECT assigned_user_id, created_at
        FROM tickets
        WHERE desk_id = $1 AND assigned_user_id IN (${placeholders})
        ORDER BY created_at DESC
        LIMIT 1
      `;
      
      const params = [deskId, ...userIds];
      console.log(`🔍 Looking for most recent ticket assignment for desk ${deskId} with users: ${userIds.join(', ')}`);
      const { rows } = await pool.query(query, params);
      
      let nextUserId: number;
      
      if (rows.length === 0) {
        // No previous assignments, return first user
        nextUserId = users[0].id;
        console.log(`🆕 No previous assignment found. Assigning to first user: ${users[0].name} (ID: ${nextUserId})`);
      } else {
        // Find the index of the last assigned user
        const lastAssignedUserId = Number(rows[0].assigned_user_id);
        const lastAssignedUserIndex = userIds.indexOf(lastAssignedUserId);
        
        console.log(`🔍 Last ticket for desk ${deskId} was assigned to user ID ${lastAssignedUserId}`);
        
        if (lastAssignedUserIndex === -1) {
          // User no longer in the list, assign to first user
          nextUserId = users[0].id;
          console.log(`⚠️ Last assigned user ID ${lastAssignedUserId} is no longer assigned to desk. Assigning to first user: ${users[0].name} (ID: ${nextUserId})`);
        } else {
          // Get the next user in the round-robin (or loop back to the beginning)
          const nextUserIndex = (lastAssignedUserIndex + 1) % users.length;
          nextUserId = users[nextUserIndex].id;
          console.log(`✅ Round-robin: Previous assignment was to user at index ${lastAssignedUserIndex}, next is index ${nextUserIndex}: ${users[nextUserIndex].name} (ID: ${nextUserId})`);
        }
      }
      
      return nextUserId;
    } catch (error) {
      console.error(`❌ Error getting next user for desk ${deskId}:`, error);
      return null;
    }
  }
  
  async updateTicket(id: number, updates: Partial<Ticket>): Promise<Ticket | undefined> {
    // Prepare update data
    const updateData: any = { 
      ...updates,
      updatedAt: new Date() 
    };
    
    const [updatedTicket] = await db.update(tickets)
      .set(updateData)
      .where(eq(tickets.id, id))
      .returning();
      
    return updatedTicket;
  }

  async updateTicketStatus(id: number, status: string): Promise<Ticket | undefined> {
    const updateData: any = { 
      status, 
      updatedAt: new Date() 
    };
    
    // Set resolvedAt timestamp when ticket is closed
    if (status === 'closed') {
      updateData.resolvedAt = new Date();
    }
    
    const [updatedTicket] = await db.update(tickets)
      .set(updateData)
      .where(eq(tickets.id, id))
      .returning();
      
    return updatedTicket;
  }
  
  async getMessagesByTicketId(ticketId: number): Promise<Message[]> {
    console.log(`[DB MESSAGES] Getting messages for ticket ID: ${ticketId}`);
    
    if (!ticketId || isNaN(ticketId)) {
      console.error(`[DB MESSAGES] Invalid ticket ID: ${ticketId}`);
      return [];
    }
    
    try {
      // Create the query with all fields explicitly selected
      const query = db.select({
        id: messages.id,
        ticketId: messages.ticketId,
        content: messages.content,
        sender: messages.sender,
        senderEmail: messages.senderEmail,
        isAgent: messages.isAgent,
        messageId: messages.messageId,
        createdAt: messages.createdAt,
        isSatisfactionResponse: messages.isSatisfactionResponse,
        satisfactionRating: messages.satisfactionRating,
        ccRecipients: messages.ccRecipients,
        attachments: messages.attachments
      })
      .from(messages)
      .where(eq(messages.ticketId, ticketId))
      .orderBy(asc(messages.createdAt));
      
      console.log(`[DB MESSAGES] Executing query: ${query.toSQL().sql} with params: ${ticketId}`);
      
      const results = await query;
      
      // Ensure attachments and ccRecipients are properly formatted
      const messagesWithValidData = results.map(msg => {
        // Handle attachments
        // Initialize with empty array if null/undefined
        if (!msg.attachments) {
          msg.attachments = [];
        }
        
        // Try to parse JSON string if not already an array
        if (typeof msg.attachments === 'string') {
          try {
            msg.attachments = JSON.parse(msg.attachments);
          } catch (e) {
            console.warn(`[DB MESSAGES] Failed to parse attachments JSON for message ID ${msg.id}:`, e);
            msg.attachments = [];
          }
        }
        
        // Ensure it's an array in all cases
        if (!Array.isArray(msg.attachments)) {
          console.warn(`[DB MESSAGES] Attachments not an array for message ID ${msg.id}, got:`, typeof msg.attachments);
          msg.attachments = [];
        }
        
        // Handle ccRecipients
        // Initialize with empty array if null/undefined
        if (!msg.ccRecipients) {
          msg.ccRecipients = [];
        }
        
        // Try to parse JSON string if not already an array
        if (typeof msg.ccRecipients === 'string') {
          try {
            msg.ccRecipients = JSON.parse(msg.ccRecipients);
          } catch (e) {
            console.warn(`[DB MESSAGES] Failed to parse ccRecipients JSON for message ID ${msg.id}:`, e);
            msg.ccRecipients = [];
          }
        }
        
        // Ensure it's an array in all cases
        if (!Array.isArray(msg.ccRecipients)) {
          console.warn(`[DB MESSAGES] ccRecipients not an array for message ID ${msg.id}, got:`, typeof msg.ccRecipients);
          msg.ccRecipients = [];
        }
        
        return msg;
      });
      
      console.log(`[DB MESSAGES] Found ${results.length} messages for ticket ${ticketId}`);
      
      // Debug the message structure
      if (results.length > 0) {
        console.log(`[DB MESSAGES] First message: ID=${results[0].id}, From=${results[0].sender} <${results[0].senderEmail}>, IsAgent=${results[0].isAgent}, ContentLength=${results[0].content?.length || 0}, HasAttachments=${Array.isArray(results[0].attachments) && results[0].attachments.length > 0}`);
        console.log(`[DB MESSAGES] Message IDs: ${results.map(m => m.id).join(', ')}`);
      } else {
        console.log(`[DB MESSAGES] No messages found for ticket ${ticketId}`);
      }
      
      return messagesWithValidData;
    } catch (error) {
      console.error(`DB: Error fetching messages for ticket ${ticketId}:`, error);
      throw error;
    }
  }
  
  async getMessagesByExactId(messageId: string): Promise<Message[]> {
    if (!messageId) return [];
    
    console.log(`Looking for message with exact ID: ${messageId}`);
    return await db.select()
      .from(messages)
      .where(eq(messages.messageId, messageId));
  }
  
  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    // Format attachments properly if they exist
    let formattedMessage = {
      ...insertMessage,
      isAgent: insertMessage.isAgent || false
    };

    // Ensure attachments are properly formatted as JSON
    if (insertMessage.attachments) {
      console.log(`Processing attachments for new message: ${Array.isArray(insertMessage.attachments) ? insertMessage.attachments.length : 'not an array'} attachments`);
      
      // If attachments is already an array, make sure it's properly structured
      if (Array.isArray(insertMessage.attachments)) {
        // Map attachments to ensure they have the necessary properties
        formattedMessage.attachments = insertMessage.attachments.map(att => {
          // Skip null or non-object attachments
          if (!att || typeof att !== 'object') return null;
          
          // Create a standardized attachment object
          return {
            url: att.url || att.dataUrl || '',
            filename: att.filename || att.originalName || att.name || 'attachment',
            originalName: att.originalName || att.filename || att.name || 'attachment',
            size: att.size || 0,
            mimetype: att.mimetype || att.content_type || att.contentType || 'application/octet-stream'
          };
        }).filter(Boolean); // Remove any null entries
      } else if (typeof insertMessage.attachments === 'string') {
        // If it's a string, try to parse it as JSON
        try {
          const parsed = JSON.parse(insertMessage.attachments);
          if (Array.isArray(parsed)) {
            formattedMessage.attachments = parsed;
          } else {
            formattedMessage.attachments = [parsed];
          }
        } catch (e) {
          console.warn(`Failed to parse attachments JSON string: ${e.message}`);
          formattedMessage.attachments = [];
        }
      } else {
        // If it's some other format, convert to empty array
        console.warn(`Unexpected attachments format: ${typeof insertMessage.attachments}`);
        formattedMessage.attachments = [];
      }
      
      console.log(`Formatted ${Array.isArray(formattedMessage.attachments) ? formattedMessage.attachments.length : 0} attachments for database storage`);
    }

    // Insert the message with properly formatted attachments
    const [message] = await db.insert(messages)
      .values(formattedMessage)
      .returning();
    
    // Update the related ticket's updatedAt time
    await this.updateTicketStatus(insertMessage.ticketId, (await this.getTicketById(insertMessage.ticketId))?.status || 'open');
    
    return message;
  }

  // Desk management methods
  async getDesks(): Promise<Desk[]> {
    try {
      return await db.select().from(desks).orderBy(desks.name);
    } catch (error) {
      console.error('Error getting desks:', error);
      return [];
    }
  }

  async getDeskById(id: number): Promise<Desk | undefined> {
    try {
      const [desk] = await db.select().from(desks).where(eq(desks.id, id));
      return desk;
    } catch (error) {
      console.error(`Error getting desk by ID ${id}:`, error);
      return undefined;
    }
  }

  async getDeskByEmail(email: string): Promise<Desk | undefined> {
    try {
      // Extract local part (before @) from the email address
      const localPart = email.split('@')[0].toLowerCase();
      console.log(`Looking for desk by email: ${email}, extracted local part: ${localPart}`);
      
      // First try to find exact match
      let desksFound = await db.select().from(desks).where(eq(desks.email, email));
      
      // If no exact match found, try matching just the local part
      if (desksFound.length === 0) {
        desksFound = await db.select().from(desks).where(eq(desks.email, localPart));
        if (desksFound.length > 0) {
          console.log(`Found desk by local part (${localPart}): ${desksFound[0].name}`);
        } else {
          console.log(`No desk found for email ${email} or local part ${localPart}`);
        }
      } else {
        console.log(`Found desk by exact email (${email}): ${desksFound[0].name}`);
      }
      
      return desksFound[0];
    } catch (error) {
      console.error(`Error getting desk by email ${email}:`, error);
      return undefined;
    }
  }

  async getDefaultDesk(): Promise<Desk | undefined> {
    try {
      const [desk] = await db.select().from(desks).where(eq(desks.isDefault, true));
      return desk;
    } catch (error) {
      console.error('Error getting default desk:', error);
      return undefined;
    }
  }

  async createDesk(insertDesk: InsertDesk): Promise<Desk> {
    try {
      // If this is being set as default, unset any existing defaults
      if (insertDesk.isDefault) {
        await db.update(desks)
          .set({ isDefault: false })
          .where(eq(desks.isDefault, true));
      }

      // Make sure email doesn't already exist
      const existingDesk = await this.getDeskByEmail(insertDesk.email);
      if (existingDesk) {
        throw new Error(`Desk with email ${insertDesk.email} already exists`);
      }

      const [desk] = await db.insert(desks)
        .values({
          ...insertDesk,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .returning();

      return desk;
    } catch (error) {
      console.error('Error creating desk:', error);
      throw error;
    }
  }

  async updateDesk(id: number, deskData: Partial<InsertDesk>): Promise<Desk | undefined> {
    try {
      // If this is being set as default, unset any existing defaults
      if (deskData.isDefault) {
        await db.update(desks)
          .set({ isDefault: false })
          .where(eq(desks.isDefault, true));
      }

      // Check if email is being changed and make sure it doesn't already exist
      if (deskData.email) {
        const existingDesk = await this.getDeskByEmail(deskData.email);
        if (existingDesk && existingDesk.id !== id) {
          throw new Error(`Desk with email ${deskData.email} already exists`);
        }
      }

      const [updatedDesk] = await db.update(desks)
        .set({
          ...deskData,
          updatedAt: new Date()
        })
        .where(eq(desks.id, id))
        .returning();

      return updatedDesk;
    } catch (error) {
      console.error(`Error updating desk ${id}:`, error);
      throw error;
    }
  }

  async deleteDesk(id: number): Promise<boolean> {
    try {
      // Cannot delete default desk
      const desk = await this.getDeskById(id);
      if (!desk) {
        return false;
      }

      // Allow deletion of any desk, including the default desk

      // Delete all tickets and messages associated with this desk
      const ticketCount = await db.select({ 
        count: sql`count(*)::integer` 
      })
        .from(tickets)
        .where(eq(tickets.deskId, id));
      
      const ticketCountValue = Number(ticketCount[0].count);
      if (ticketCountValue > 0) {
        console.log(`Deleting ${ticketCountValue} tickets and their messages from desk ${id}`);
        
        // First delete all messages associated with tickets in this desk
        await db.delete(messages)
          .where(
            sql`ticket_id IN (SELECT id FROM tickets WHERE desk_id = ${id})`
          );
        
        // Then delete all tickets in this desk
        await db.delete(tickets)
          .where(eq(tickets.deskId, id));
          
        console.log(`Successfully deleted all tickets and messages from desk ${id}`);
      }

      // Delete desk assignments first
      await db.delete(deskAssignments)
        .where(eq(deskAssignments.deskId, id));

      // Delete the desk
      await db.delete(desks)
        .where(eq(desks.id, id));

      return true;
    } catch (error) {
      console.error(`Error deleting desk ${id}:`, error);
      if (error instanceof Error) {
        throw new Error(`Failed to delete desk: ${error.message}`);
      }
      throw new Error(`Failed to delete desk: unknown error`);
    }
  }

  // Desk assignments methods
  async getDeskAssignments(userId?: number, deskId?: number): Promise<DeskAssignment[]> {
    try {
      // Build SQL query with conditions - use the correct table name
      let sqlQuery = 'SELECT * FROM user_desk_assignments';
      const params: any[] = [];
      const conditions: string[] = [];
      
      if (userId !== undefined) {
        conditions.push('user_id = $' + (params.length + 1));
        params.push(userId);
      }
      
      if (deskId !== undefined) {
        conditions.push('desk_id = $' + (params.length + 1));
        params.push(deskId);
      }
      
      if (conditions.length > 0) {
        sqlQuery += ' WHERE ' + conditions.join(' AND ');
      }
      
      // Execute query
      const { rows } = await pool.query(sqlQuery, params);
      
      // Map results to DeskAssignment objects
      return rows.map(row => ({
        id: Number(row.id),
        userId: Number(row.user_id),
        deskId: Number(row.desk_id),
        createdAt: new Date(String(row.created_at))
      }));
    } catch (error) {
      console.error('Error getting desk assignments:', error);
      return [];
    }
  }

  async assignUserToDesk(userId: number, deskId: number): Promise<DeskAssignment> {
    try {
      console.log(`STORAGE: Starting assignment of user ${userId} to desk ${deskId}`);
      
      // Check if user and desk exist
      const user = await this.getUser(userId);
      if (!user) {
        console.log(`STORAGE: User ${userId} not found`);
        throw new Error(`User with ID ${userId} not found`);
      }
      console.log(`STORAGE: User ${userId} found: ${user.name}`);

      const desk = await this.getDeskById(deskId);
      if (!desk) {
        console.log(`STORAGE: Desk ${deskId} not found`);
        throw new Error(`Desk with ID ${deskId} not found`);
      }
      console.log(`STORAGE: Desk ${deskId} found: ${desk.name}`);

      // First, check if assignment already exists
      const checkQuery = `SELECT * FROM desk_assignments WHERE user_id = $1 AND desk_id = $2`;
      const checkResult = await pool.query(checkQuery, [userId, deskId]);
      console.log(`STORAGE: Existing assignment check - found ${checkResult.rows.length} records`);
      
      if (checkResult.rows.length > 0) {
        // Assignment already exists, return it
        const existingRow = checkResult.rows[0];
        console.log(`STORAGE: Assignment already exists, returning existing:`, existingRow);
        return {
          id: Number(existingRow.id),
          userId: Number(existingRow.user_id),
          deskId: Number(existingRow.desk_id),
          createdAt: new Date(String(existingRow.created_at))
        };
      }

      // Create a new assignment - remove ON CONFLICT to see actual errors
      const insertQuery = `
        INSERT INTO desk_assignments (user_id, desk_id, created_at)
        VALUES ($1, $2, NOW())
        RETURNING id, user_id, desk_id, created_at
      `;
      
      console.log(`STORAGE: Inserting new assignment with query:`, insertQuery);
      console.log(`STORAGE: Parameters:`, [userId, deskId]);
      
      const insertResult = await pool.query(insertQuery, [userId, deskId]);
      console.log(`STORAGE: Insert result:`, {
        rowCount: insertResult.rowCount,
        rows: insertResult.rows
      });
      
      if (insertResult.rows.length === 0) {
        console.log(`STORAGE: No rows returned from insert, checking for existing assignment`);
        // If insertion failed but it's not due to duplicate, re-check if it exists
        const recheckResult = await pool.query(checkQuery, [userId, deskId]);
        if (recheckResult.rows.length > 0) {
          const existingRow = recheckResult.rows[0];
          console.log(`STORAGE: Found existing assignment on recheck:`, existingRow);
          return {
            id: Number(existingRow.id),
            userId: Number(existingRow.user_id),
            deskId: Number(existingRow.desk_id),
            createdAt: new Date(String(existingRow.created_at))
          };
        }
        console.log(`STORAGE: No assignment found even after recheck - this is an error`);
        throw new Error('Failed to create desk assignment');
      }
      
      // Map the result to a DeskAssignment object
      const row = insertResult.rows[0];
      const result = {
        id: Number(row.id),
        userId: Number(row.user_id),
        deskId: Number(row.desk_id),
        createdAt: new Date(String(row.created_at))
      };
      console.log(`STORAGE: Successfully created assignment:`, result);
      return result;
    } catch (error) {
      console.error(`STORAGE: Error assigning user ${userId} to desk ${deskId}:`, error);
      throw error;
    }
  }

  async removeUserFromDesk(userId: number, deskId: number): Promise<boolean> {
    try {
      console.log(`STORAGE: Removing user ${userId} from desk ${deskId}`);
      
      // Use raw SQL for more reliable results
      const query = `DELETE FROM desk_assignments WHERE user_id = $1 AND desk_id = $2`;
      const result = await pool.query(query, [userId, deskId]);
      
      console.log(`STORAGE: Delete result:`, {
        rowCount: result.rowCount,
        command: result.command
      });

      if (result.rowCount === 0) {
        console.log(`STORAGE: No assignment found to delete for user ${userId} and desk ${deskId}`);
        return false;
      }

      console.log(`STORAGE: Successfully removed user ${userId} from desk ${deskId}`);
      return true;
    } catch (error) {
      console.error(`STORAGE: Error removing user ${userId} from desk ${deskId}:`, error);
      return false;
    }
  }

  async getUserDesks(userId: number): Promise<Desk[]> {
    try {
      // First check if user exists
      const user = await this.getUser(userId);
      if (!user) {
        throw new Error(`User with ID ${userId} not found`);
      }

      // For admin users, always return all desks regardless of assignments
      if (user.role === 'admin') {
        return await this.getDesks();
      }
      
      // For regular users, get desks they're assigned to
      const userAssignments = await this.getDeskAssignments(userId);
      if (userAssignments.length === 0) {
        // If no assignments, return just the default desk
        const defaultDesk = await this.getDefaultDesk();
        return defaultDesk ? [defaultDesk] : [];
      }

      // Get all desks by IDs
      const deskIds = userAssignments.map(a => a.deskId);
      
      // Use raw SQL for more reliable results
      if (deskIds.length === 0) return [];
      
      const placeholders = deskIds.map((_, i) => `$${i + 1}`).join(',');
      const query = `SELECT * FROM desks WHERE id IN (${placeholders})`;
      const { rows } = await pool.query(query, deskIds);
      
      // Map the results to Desk objects
      return rows.map(row => ({
        id: Number(row.id),
        name: String(row.name),
        email: String(row.email),
        description: row.description ? String(row.description) : null,
        isDefault: Boolean(row.is_default),
        createdAt: new Date(String(row.created_at)),
        updatedAt: new Date(String(row.updated_at))
      }));
    } catch (error) {
      console.error(`Error getting desks for user ${userId}:`, error);
      return [];
    }
  }

  async getDeskUsers(deskId: number): Promise<User[]> {
    try {
      console.log(`Getting users for desk ${deskId}`);
      
      // First check if desk exists
      const desk = await this.getDeskById(deskId);
      if (!desk) {
        console.log(`Desk ${deskId} not found`);
        throw new Error(`Desk with ID ${deskId} not found`);
      }

      console.log(`Desk ${deskId} found: ${desk.name}`);

      // Get all user assignments to this desk using direct SQL for better debugging
      const assignmentsQuery = `SELECT * FROM desk_assignments WHERE desk_id = $1`;
      const assignmentsResult = await pool.query(assignmentsQuery, [deskId]);
      
      console.log(`Found ${assignmentsResult.rows.length} assignments for desk ${deskId}:`, assignmentsResult.rows);

      if (assignmentsResult.rows.length === 0) {
        console.log(`No assignments found for desk ${deskId}`);
        // If default desk, return all admin users
        if (desk.isDefault) {
          console.log(`Desk ${deskId} is default, returning admin users`);
          const adminUsers = await db.select().from(users).where(eq(users.role, 'admin'));
          return adminUsers;
        } else {
          console.log(`Desk ${deskId} is not default, returning empty array`);
          return [];
        }
      }

      // Get all users by IDs
      const userIds = assignmentsResult.rows.map(row => Number(row.user_id));
      console.log(`User IDs for desk ${deskId}:`, userIds);
      
      // If no user IDs, return empty array
      if (userIds.length === 0) {
        console.log(`No user IDs found for desk ${deskId}`);
        return [];
      }
      
      // Query the database using raw SQL for more reliable results
      const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',');
      const query = `SELECT * FROM users WHERE id IN (${placeholders})`;
      const { rows } = await pool.query(query, userIds);
      
      console.log(`Found ${rows.length} users for desk ${deskId}:`, rows.map(r => ({ id: r.id, name: r.name })));
      
      // Map the results to User objects
      const users = rows.map(row => ({
        id: Number(row.id),
        username: String(row.username),
        password: '',  // Don't include actual password
        name: String(row.name),
        email: String(row.email),
        role: String(row.role || 'agent'),
        createdAt: new Date(String(row.created_at)),
        updatedAt: new Date(String(row.updated_at)),
        resetToken: null,  // Don't include sensitive data
        resetTokenExpiry: null,
        requiresSetup: Boolean(row.requires_setup),
        otpCode: null,
        otpExpiry: null,
        isVerified: Boolean(row.is_verified)
      }));

      console.log(`Returning ${users.length} users for desk ${deskId}`);
      return users;
    } catch (error) {
      console.error(`Error getting users for desk ${deskId}:`, error);
      return [];
    }
  }

  // Method to get tickets with support for pagination
  async getTickets(options?: {
    sortBy?: string;
    sortOrder?: string;
    deskId?: number;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<Ticket[]> {
    try {
      console.log(`Getting tickets with options:`, options);
      let query = db.select().from(tickets);
      
      // Apply filters
      if (options?.deskId !== undefined) {
        query = query.where(eq(tickets.deskId, options.deskId));
      }
      
      if (options?.status !== undefined) {
        query = query.where(eq(tickets.status, options.status));
      }
      
      // Apply sorting
      if (options?.sortBy) {
        const sortField = options.sortBy as keyof typeof tickets;
        if (sortField && tickets[sortField]) {
          if (options.sortOrder === 'asc') {
            query = query.orderBy(asc(tickets[sortField]));
          } else {
            query = query.orderBy(desc(tickets[sortField]));
          }
        }
      } else {
        // Default sort by created date descending
        query = query.orderBy(desc(tickets.createdAt));
      }
      
      // Apply pagination
      if (options?.limit !== undefined) {
        query = query.limit(options.limit);
        
        if (options?.offset !== undefined) {
          query = query.offset(options.offset);
        }
      }
      
      return await query;
    } catch (error) {
      console.error('Error getting tickets:', error);
      return [];
    }
  }
  
  // Get total count of tickets for pagination
  async getTicketsCount(options?: {
    deskId?: number;
    status?: string;
  }): Promise<number> {
    try {
      const countResult = await db
        .select({ count: sql`count(*)` })
        .from(tickets)
        .where(
          // Apply filters if provided
          options?.deskId !== undefined && options?.status !== undefined
            ? and(
                eq(tickets.deskId, options.deskId),
                eq(tickets.status, options.status)
              )
            : options?.deskId !== undefined
            ? eq(tickets.deskId, options.deskId)
            : options?.status !== undefined
            ? eq(tickets.status, options.status)
            : undefined
        );
      
      return Number(countResult[0]?.count || 0);
    } catch (error) {
      console.error('Error counting tickets:', error);
      return 0;
    }
  }
  
  // Get all messages in the system - used for advanced email thread detection
  // Performance optimized to only retrieve minimal fields needed for thread matching
  async getAllMessages(): Promise<Message[]> {
    console.log("[DB MESSAGES] Fetching messages for email thread detection (optimized version)");
    try {
      // Create the query with ONLY fields needed for threading to improve performance
      const query = db.select({
        id: messages.id,
        ticketId: messages.ticketId,
        messageId: messages.messageId,
        createdAt: messages.createdAt
      })
      .from(messages)
      .where(
        // Only include messages with non-null messageIds (they're the only ones useful for threading)
        // This significantly reduces the data load
        messages.messageId.isNotNull()
      )
      .orderBy(desc(messages.createdAt))
      .limit(1000); // Reduced limit for better performance
      
      const results = await query;
      console.log(`[DB MESSAGES] Retrieved ${results.length} messages for thread detection (optimized)`);
      
      // Since we're only using id, ticketId, and messageId for threading detection,
      // we don't need to do any complex processing on these results
      // This is much faster than the previous implementation
      return results as Message[];
    } catch (error) {
      console.error("[DB MESSAGES] Error fetching all messages:", error);
      
      // Fallback to raw query if ORM fails
      try {
        console.log("[DB MESSAGES] Falling back to raw query for fetching all messages");
        const { rows } = await pool.query(
          `SELECT id, ticket_id, content, sender, sender_email, is_agent, 
          message_id, created_at, cc_recipients, attachments 
          FROM messages ORDER BY created_at DESC LIMIT 2000`
        );
        
        console.log(`[DB MESSAGES] Retrieved ${rows.length} messages using raw query`);
        
        return rows.map(row => ({
          id: Number(row.id),
          ticketId: Number(row.ticket_id),
          content: String(row.content || ''),
          sender: String(row.sender || ''),
          senderEmail: String(row.sender_email || ''),
          isAgent: Boolean(row.is_agent),
          createdAt: new Date(String(row.created_at)),
          messageId: row.message_id || null,
          attachments: this.parseJsonField(row.attachments, []),
          ccRecipients: this.parseJsonField(row.cc_recipients, [])
        }));
      } catch (fallbackError) {
        console.error("[DB MESSAGES] Critical error in fallback query for all messages:", fallbackError);
        return [];
      }
    }
  }
  
  // Utility to safely parse JSON fields
  private parseJsonField(field: any, defaultValue: any): any {
    if (!field) return defaultValue;
    
    if (typeof field === 'string') {
      try {
        return JSON.parse(field);
      } catch (e) {
        return defaultValue;
      }
    }
    
    return field;
  }
}

// Initialize database storage
export const storage = new DatabaseStorage();
