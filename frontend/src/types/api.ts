// API Response Types - These should match backend response formats
export interface Ticket {
  id: number;
  subject: string;
  status: string;
  customerName: string;
  customerEmail: string;
  deskId: number | null;
  assignedUserId: number | null;
  ccRecipients: string[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface Message {
  id: number;
  ticketId: number;
  content: string;
  sender: string;
  senderEmail: string;
  isAgent: boolean;
  messageId: string | null;
  createdAt: string | null;
  isSatisfactionResponse: boolean;
  satisfactionRating: number | null;
  ccRecipients: string[];
  attachments: Attachment[];
}

export interface Attachment {
  filename: string;
  contentType: string;
  size: number;
  content: string;
}

export interface Desk {
  id: number;
  name: string;
  email: string;
  forwardingEmail: string;
  description: string | null;
  isDefault: boolean;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
  smtpSecure: boolean;
  smtpFromName: string;
  useDirectEmail: boolean;
  imapHost: string;
  imapPort: string;
  imapUser: string;
  imapPassword: string;
  imapSecure: boolean;
  useImapPolling: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  updatedAt: string;
  requiresSetup: boolean;
  isVerified: boolean;
}

export interface Statistics {
  nps: number;
  totalRatings: number;
  promoters: number;
  detractors: number;
  passives: number;
  totalTickets: number;
  openTickets: number;
  resolvedTickets: number;
  averageResolutionTime: number;
}

// API Request Types
export interface CreateTicketRequest {
  subject: string;
  customerName: string;
  customerEmail: string;
  content: string;
  ccRecipients?: string[];
  deskId?: number;
}

export interface CreateMessageRequest {
  content: string;
  ccRecipients?: string[];
  attachments?: File[];
}

export interface CreateDeskRequest {
  name: string;
  email: string;
  description?: string;
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPassword?: string;
  smtpSecure?: boolean;
  smtpFromName?: string;
  useDirectEmail?: boolean;
  imapHost?: string;
  imapPort?: string;
  imapUser?: string;
  imapPassword?: string;
  imapSecure?: boolean;
  useImapPolling?: boolean;
}

export interface UpdateDeskRequest extends Partial<CreateDeskRequest> {
  id: number;
}

export interface CreateUserRequest {
  username: string;
  name: string;
  email: string;
  password: string;
  role: string;
}

export interface UpdateUserRequest extends Partial<CreateUserRequest> {
  id: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  message: string;
}

// API Response Wrappers
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
}

export interface TicketsResponse extends PaginatedResponse<Ticket> {}

export interface TicketWithMessages {
  ticket: Ticket;
  messages: Message[];
  desk: Desk;
}