import { z } from "zod";

// User schemas
export const insertUserSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Must be a valid email address"),
  role: z.enum(["admin", "agent", "manager"]).default("agent"),
  requiresSetup: z.boolean().default(false),
  isVerified: z.boolean().default(false)
});

export type InsertUser = z.infer<typeof insertUserSchema>;

export interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  role: "admin" | "agent" | "manager";
  requiresSetup: boolean;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

// Alias for User to match backend naming
export type SelectUser = User;

// Desk schemas
export interface Desk {
  id: number;
  name: string;
  email: string;
  forwardingEmail: string | null;
  description: string | null;
  isDefault: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPassword: string | null;
  smtpSecure: boolean;
  smtpFromName: string | null;
  useDirectEmail: boolean;
  imapHost: string | null;
  imapPort: number | null;
  imapUser: string | null;
  imapPassword: string | null;
  imapSecure: boolean;
  useImapPolling: boolean;
  createdAt: string;
  updatedAt: string;
}

// Ticket schemas
export interface Ticket {
  id: number;
  subject: string;
  status: string;
  priority: string;
  customerName: string;
  customerEmail: string;
  deskId: number;
  deskName: string;
  assignedUserId: number | null;
  assignedToName: string | null;
  ccRecipients: string[] | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

// DeskAssignment schemas
export interface DeskAssignment {
  id: number;
  userId: number;
  deskId: number;
  createdAt: string;
}

// Message schemas
export interface Message {
  id: number;
  ticketId: number;
  content: string;
  sender: string;
  senderEmail: string;
  isAgent: boolean;
  messageId: string | null;
  referenceIds?: string | null;
  inReplyTo?: string | null;
  ccRecipients: string[] | null;
  isSatisfactionResponse: boolean;
  satisfactionRating: number | null;
  attachments: Attachment[] | null;
  emailSent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  filename: string;
  path: string;
  size: number;
  mimeType: string;
}

// Insert schemas
export const insertTicketSchema = z.object({
  subject: z.string().min(2, "Subject must be at least 2 characters"),
  customerName: z.string().min(2, "Name must be at least 2 characters"),
  customerEmail: z.string().email("Must be a valid email address"),
  deskId: z.number().optional(),
  assignedUserId: z.number().optional(),
  ccRecipients: z.array(z.string()).optional(),
  status: z.string().default("open")
});

export type InsertTicket = z.infer<typeof insertTicketSchema>;

export const insertMessageSchema = z.object({
  ticketId: z.number(),
  content: z.string().min(1, "Content cannot be empty"),
  sender: z.string(),
  senderEmail: z.string().email(),
  isAgent: z.boolean().default(false),
  messageId: z.string().optional(),
  ccRecipients: z.array(z.string()).optional(),
  isSatisfactionResponse: z.boolean().default(false),
  satisfactionRating: z.number().optional(),
  attachments: z.array(z.any()).optional(),
  emailSent: z.boolean().default(false)
});

export type InsertMessage = z.infer<typeof insertMessageSchema>;

export const insertDeskSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Must be a valid email address"),
  forwardingEmail: z.string().email().optional(),
  description: z.string().optional(),
  isDefault: z.boolean().default(false),
  smtpHost: z.string().optional(),
  smtpPort: z.number().optional(),
  smtpUser: z.string().optional(),
  smtpPassword: z.string().optional(),
  smtpSecure: z.boolean().default(false),
  smtpFromName: z.string().optional(),
  useDirectEmail: z.boolean().default(false),
  imapHost: z.string().optional(),
  imapPort: z.number().optional(),
  imapUser: z.string().optional(),
  imapPassword: z.string().optional(),
  imapSecure: z.boolean().default(false),
  useImapPolling: z.boolean().default(false)
});

export type InsertDesk = z.infer<typeof insertDeskSchema>;

export const insertDeskAssignmentSchema = z.object({
  userId: z.number(),
  deskId: z.number()
});

export type InsertDeskAssignment = z.infer<typeof insertDeskAssignmentSchema>;
