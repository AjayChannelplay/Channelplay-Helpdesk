/**
 * Admin Tools Module
 * 
 * This file contains special administrative functions like cleaning up data,
 * performing maintenance tasks, etc.
 */

import { Express, Request, Response } from 'express';
import { db } from './db';
import { messages, tickets } from '@shared/schema';
import { sql } from 'drizzle-orm';

/**
 * Delete all tickets and messages from the database
 */
export async function cleanupAllTickets() {
  console.log('Starting to delete all tickets and messages...');
  
  try {
    // First delete all messages since they reference tickets
    const deleteMessagesResult = await db.delete(messages);
    console.log(`Deleted ${deleteMessagesResult.rowCount} messages`);
    
    // Then delete all tickets
    const deleteTicketsResult = await db.delete(tickets);
    console.log(`Deleted ${deleteTicketsResult.rowCount} tickets`);
    
    return {
      success: true,
      messagesDeleted: deleteMessagesResult.rowCount,
      ticketsDeleted: deleteTicketsResult.rowCount
    };
  } catch (error) {
    console.error('Error deleting tickets and messages:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Register admin routes for maintenance tasks
 */
export function registerAdminRoutes(app: Express) {
  // Make sure only admin users can access these routes
  const isAdmin = (req: Request, res: Response, next: any) => {
    if (req.session && req.session.passport && req.session.passport.user) {
      const user = req.session.passport.user;
      if (user.role === 'admin') {
        return next();
      }
    }
    
    res.status(403).json({ error: 'Admin access required' });
  };

  // Route to delete all tickets and messages
  app.post('/api/admin/cleanup-tickets', isAdmin, async (req: Request, res: Response) => {
    try {
      const result = await cleanupAllTickets();
      
      if (result.success) {
        res.json({
          success: true,
          message: `Successfully deleted ${result.ticketsDeleted} tickets and ${result.messagesDeleted} messages`,
          ticketsDeleted: result.ticketsDeleted,
          messagesDeleted: result.messagesDeleted
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.error
        });
      }
    } catch (error) {
      console.error('Error in cleanup-tickets route:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}