import { pgTable, text, serial, integer, boolean, timestamp, foreignKey, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Define tables first
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("agent"),
  requiresSetup: boolean("requires_setup").default(false),
  resetToken: text("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
  otpCode: text("otp_code"),
  otpExpiry: timestamp("otp_expiry"),
  isVerified: boolean("is_verified").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Desk table for multi-desk support
export const desks = pgTable("desks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(), // email prefix for this desk, e.g. "support" for support@helpdesk.1office.in
  forwardingEmail: text("redirect_email"), // email address to forward messages to
  description: text("description"),
  isDefault: boolean("is_default").default(false), // if true, this is the default desk for new tickets
  
  // SMTP Configuration
  smtpHost: text("smtp_host"),
  smtpPort: text("smtp_port"),
  smtpUser: text("smtp_user"),
  smtpPassword: text("smtp_password"),
  smtpSecure: boolean("smtp_secure").default(false),
  smtpFromName: text("smtp_from_name"),
  useDirectEmail: boolean("use_direct_email").default(false), // if true, use direct SMTP instead of Mailgun
  
  // IMAP Configuration  
  imapHost: text("imap_host"),
  imapPort: text("imap_port"),
  imapUser: text("imap_user"),
  imapPassword: text("imap_password"),
  imapSecure: boolean("imap_secure").default(false),
  useImapPolling: boolean("use_imap_polling").default(false), // if true, poll IMAP for new emails
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Many-to-many relationship between users and desks
export const deskAssignments = pgTable("desk_assignments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deskId: integer("desk_id").notNull().references(() => desks.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tickets = pgTable("tickets", {
  id: serial("id").primaryKey(),
  subject: text("subject").notNull(),
  status: text("status").notNull().default("open"),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  deskId: integer("desk_id").references(() => desks.id), // which desk this ticket belongs to
  assignedUserId: integer("assigned_user_id").references(() => users.id), // which user this ticket is assigned to
  ccRecipients: jsonb("cc_recipients").default([]), // Store CC recipients at the ticket level
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  sender: text("sender").notNull(),
  senderEmail: text("sender_email").notNull(),
  isAgent: boolean("is_agent").notNull().default(false),
  messageId: text("message_id"),
  referenceIds: text("reference_ids"), // References header from email
  inReplyTo: text("in_reply_to"),     // In-Reply-To header from email
  ccRecipients: jsonb("cc_recipients").default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  isSatisfactionResponse: boolean("is_satisfaction_response").default(false),
  satisfactionRating: integer("satisfaction_rating"),
  attachments: jsonb("attachments").default([]),
  emailSent: boolean("email_sent").default(false), // Track if email notification was sent
});

// Define relations after all tables are defined
export const usersRelations = relations(users, ({ many }) => ({
  messages: many(messages),
  deskAssignments: many(deskAssignments),
  assignedTickets: many(tickets),
}));

export const desksRelations = relations(desks, ({ many, one }) => ({
  deskAssignments: many(deskAssignments),
  tickets: many(tickets),
}));

export const deskAssignmentsRelations = relations(deskAssignments, ({ one }) => ({
  user: one(users, {
    fields: [deskAssignments.userId],
    references: [users.id],
  }),
  desk: one(desks, {
    fields: [deskAssignments.deskId],
    references: [desks.id],
  }),
}));

export const ticketsRelations = relations(tickets, ({ many, one }) => ({
  messages: many(messages),
  desk: one(desks, {
    fields: [tickets.deskId],
    references: [desks.id],
  }),
  assignedUser: one(users, {
    fields: [tickets.assignedUserId],
    references: [users.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  ticket: one(tickets, {
    fields: [messages.ticketId],
    references: [tickets.id],
  }),
}));

// Define insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  name: true,
  email: true,
  role: true,
  requiresSetup: true,
  isVerified: true,
});

export const insertDeskSchema = createInsertSchema(desks).pick({
  name: true,
  email: true,
  forwardingEmail: true,
  description: true,
  isDefault: true,
  // SMTP Configuration
  smtpHost: true,
  smtpPort: true,
  smtpUser: true,
  smtpPassword: true,
  smtpSecure: true,
  smtpFromName: true,
  useDirectEmail: true,
  // IMAP Configuration
  imapHost: true,
  imapPort: true,
  imapUser: true,
  imapPassword: true,
  imapSecure: true,
  useImapPolling: true,
});

export const insertDeskAssignmentSchema = createInsertSchema(deskAssignments).pick({
  userId: true,
  deskId: true,
});

export const insertTicketSchema = createInsertSchema(tickets).pick({
  subject: true,
  status: true,
  customerName: true,
  customerEmail: true,
  deskId: true,
  assignedUserId: true,
  ccRecipients: true,
});

export const insertMessageSchema = createInsertSchema(messages).pick({
  ticketId: true,
  content: true,
  sender: true,
  senderEmail: true,
  isAgent: true,
  messageId: true,
  ccRecipients: true,
  isSatisfactionResponse: true,
  satisfactionRating: true,
  attachments: true,
  emailSent: true,
  createdAt: true, // Allow manual createdAt for agent replies and authentic email dates
});

// Define types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertDesk = z.infer<typeof insertDeskSchema>;
export type Desk = typeof desks.$inferSelect;

export type InsertDeskAssignment = z.infer<typeof insertDeskAssignmentSchema>;
export type DeskAssignment = typeof deskAssignments.$inferSelect;

export type Ticket = typeof tickets.$inferSelect;
export type InsertTicket = z.infer<typeof insertTicketSchema>;

export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
