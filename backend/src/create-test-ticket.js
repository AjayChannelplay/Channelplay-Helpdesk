/**
 * Test script to create a ticket and test Gmail direct SMTP
 * 
 * This script creates a test ticket using the direct Gmail SMTP connection
 * to verify that the "via helpdesk.1office.in" problem is fixed.
 */

import nodemailer from 'nodemailer';
import { pool } from './db.js';
import crypto from 'crypto';

async function createTestTicket() {
  try {
    console.log("Creating test ticket through direct Gmail SMTP...");
    
    // First get desk info from database
    const desk = await getDeskInfo();
    
    if (!desk || !desk.smtp_user || !desk.smtp_password) {
      console.log("No desk with Gmail SMTP configuration found");
      return;
    }
    
    console.log(`Using desk: ${desk.name} with SMTP user: ${desk.smtp_user}`);
    
    // Create the ticket in the database
    const ticketId = await createTicketInDatabase({
      subject: "Test Ticket via Direct Gmail " + new Date().toISOString(),
      customerName: "Test Customer",
      customerEmail: "ajay.kumar22@channelplay.in", // Replace with test recipient
      deskId: desk.id
    });
    
    if (!ticketId) {
      console.log("Failed to create ticket in database");
      return;
    }
    
    console.log(`Created ticket #${ticketId} in database`);
    
    // Send confirmation email using Gmail SMTP directly
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: desk.smtp_user,
        pass: desk.smtp_password
      }
    });
    
    // The key is to use the object format for the "from" field
    const emailContent = `
      Thank you for contacting us. Your support ticket #${ticketId} has been created.
      
      Subject: Test Ticket via Direct Gmail
      
      Your Message:
      This is a test message to verify the email format is correct and there's no "via helpdesk.1office.in" text in the headers.
      
      Our team will respond to your inquiry as soon as possible. You can reply directly to this email to add more information to your ticket.
      ChannelPlay Help Desk
    `;
    
    const messageId = `<ticket-${ticketId}-new-${Date.now()}-${crypto.randomBytes(6).toString('hex')}@gmail.com>`;
    
    const result = await transporter.sendMail({
      from: {
        name: desk.name || 'Gmail Support',
        address: desk.smtp_user  // Must match authenticated Gmail account
      },
      to: "ajay.kumar22@channelplay.in", // Replace with test recipient
      subject: `[Ticket #${ticketId}] Test Ticket via Direct Gmail`,
      text: emailContent,
      html: `<div>${emailContent.replace(/\n/g, "<br>")}</div>`,
      headers: {
        'Message-ID': messageId,
        'References': messageId,
        'X-Priority': '1',
        'Importance': 'high'
      }
    });
    
    console.log("Email sent successfully");
    if (result && result.messageId) {
      console.log(`Message ID: ${result.messageId}`);
    }
    
    console.log("Test completed successfully");
  } catch (error) {
    console.error("Error creating test ticket:", error);
  } finally {
    // Close the database connection
    await pool.end();
  }
}

// Get the first desk with SMTP configuration
async function getDeskInfo() {
  try {
    const result = await pool.query(`
      SELECT id, name, smtp_user, smtp_password
      FROM desks
      WHERE smtp_user IS NOT NULL 
        AND smtp_password IS NOT NULL
      LIMIT 1
    `);
    
    if (result.rows.length > 0) {
      return result.rows[0];
    }
    return null;
  } catch (error) {
    console.error("Error getting desk info:", error);
    return null;
  }
}

// Create a ticket in the database
async function createTicketInDatabase({ subject, customerName, customerEmail, deskId }) {
  try {
    const result = await pool.query(`
      INSERT INTO tickets
        (subject, status, customer_name, customer_email, desk_id, created_at, updated_at)
      VALUES
        ($1, 'open', $2, $3, $4, NOW(), NOW())
      RETURNING id
    `, [subject, customerName, customerEmail, deskId]);
    
    if (result.rows.length > 0) {
      return result.rows[0].id;
    }
    return null;
  } catch (error) {
    console.error("Error creating ticket in database:", error);
    return null;
  }
}

// Run the test
createTestTicket().catch(console.error);