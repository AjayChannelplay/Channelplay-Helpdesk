/**
 * Email Threading Integration
 * 
 * This file contains the code to integrate enhanced email threading into the Mailgun webhook handler.
 * It should be incorporated into the routes.ts file in the appropriate section that handles incoming emails.
 */

// Import the threading utilities
import { findRelatedTicket, updateMessageReferences } from './email-threading';

// Integrate this logic into the webhook handler that processes incoming emails
// Add this inside the webhook route handler before ticket creation

/**
 * Example integration of the email threading logic in the webhook handler
 * (This should be adapted to match your specific webhook handling code)
 */

// Inside the webhook handler for Mailgun
app.post("/api/webhook/mailgun", async (req, res) => {
  try {
    // Parse the email data from the webhook
    const emailData = await mailgunService.parseWebhook(req.body, req.files as any[]);

    // Extract email threading headers
    const { messageId, references, inReplyTo } = emailData;
    
    console.log(`Processing incoming email with Message-ID: ${messageId}`);
    console.log(`References: ${references || 'none'}`);
    console.log(`In-Reply-To: ${inReplyTo || 'none'}`);

    // Check if this is a reply to an existing ticket
    let existingTicketId = null;
    
    // Use the new threading logic to find related tickets
    if (references || inReplyTo) {
      existingTicketId = await findRelatedTicket(messageId, references, inReplyTo);
      
      if (existingTicketId) {
        console.log(`Found related ticket #${existingTicketId} based on email headers`);
      } else {
        console.log('No related ticket found based on email headers');
      }
    }

    // If we found an existing ticket, add the message to it
    if (existingTicketId) {
      // Add the message to the existing ticket
      const newMessage = {
        ticketId: existingTicketId,
        content: emailData.body,
        sender: emailData.sender,
        senderEmail: emailData.recipient,
        isAgent: false,
        messageId: emailData.messageId,
        referenceIds: references,  // Store References header
        inReplyTo: inReplyTo,      // Store In-Reply-To header
        ccRecipients: emailData.ccRecipients || [],
        attachments: emailData.attachments || []
      };

      const message = await storage.createMessage(newMessage);
      console.log(`Added message to existing ticket #${existingTicketId}`);

      // Update the ticket status to open if it was waiting_for_customer
      await storage.updateTicketStatus(existingTicketId, 'open');
      console.log(`Updated ticket #${existingTicketId} status to 'open'`);

      // Respond to the webhook
      res.status(200).send('Email processed as reply');
    } else {
      // This is a new ticket, proceed with creation as normal
      // Create a new ticket and message

      // Create ticket
      const newTicket = {
        subject: emailData.subject,
        status: 'open',
        customerName: emailData.sender,
        customerEmail: emailData.recipient,
        deskId: targetDeskId,
        ccRecipients: emailData.ccRecipients || []
      };

      const ticket = await storage.createTicket(newTicket);
      console.log(`Created new ticket #${ticket.id}`);

      // Create message
      const newMessage = {
        ticketId: ticket.id,
        content: emailData.body,
        sender: emailData.sender,
        senderEmail: emailData.recipient,
        isAgent: false,
        messageId: emailData.messageId,
        referenceIds: references,  // Store References header
        inReplyTo: inReplyTo,      // Store In-Reply-To header
        ccRecipients: emailData.ccRecipients || [],
        attachments: emailData.attachments || []
      };

      const message = await storage.createMessage(newMessage);
      console.log(`Added message to new ticket #${ticket.id}`);

      // Respond to the webhook
      res.status(200).send('Email processed as new ticket');
    }
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send('Error processing webhook');
  }
});