import React, { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getQueryFn, apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowLeft, MessageCircle, ChevronDown, ChevronUp, Users, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { Desk, Ticket as BaseTicket, Message } from "@shared/schema";
import ReplyForm from "./reply-form";
import { Skeleton } from "@/components/ui/skeleton";
import { LoginGuideDialog } from "@/components/ui/login-guide-dialog";
import { AttachmentPreviewDialog } from "@/components/ui/attachment-preview-dialog";
import { CCRecipientsDialog } from "@/components/ui/cc-recipients-dialog";
import { decodeSRSEmail, getInitials, formatEmailAddress, extractLatestReply, splitEmailThread } from "@/lib/email-utils";
import { useToast } from "@/hooks/use-toast";

// Define email segment interface 
interface EmailSegment {
  text: string;
  header: string;
  isQuoted: boolean;
  from?: string;
  to?: string;
  cc?: string;
  date?: string;
  subject?: string;
  htmlContent?: string;
}

// Define Attachment interface
interface Attachment {
  url: string;
  filename?: string;
  originalName?: string;
  name?: string;
  size?: number;
  mimetype?: string;
  contentType?: string;
  path?: string;
  messageId?: number;
}

// Define fully typed message interface for conversation view
interface ExtendedMessage {
  id: number;
  createdAt: Date;
  ticketId: number;
  content: string;
  sender: string;
  senderEmail: string;
  isAgent: boolean;
  messageId: string | null;
  ccRecipients?: string[];
  isSatisfactionResponse: boolean | null;
  satisfactionRating: number | null;
  attachments: Attachment[] | any[];
  mimetype?: string;
  contentType?: string;
  path?: string;
}

// Augmented Ticket type with desk and assigned user information
interface Ticket extends BaseTicket {
  desk?: Desk;
  assignedUser?: {
    id: number;
    name: string;
    username: string;
  };
  ccRecipients: string[]; // CC recipients is now a required field from the schema
}

// Define interface for component props
interface ConversationViewProps {
  ticketId: number | null;
  onBackClick: () => void;
  onReplySuccess: () => void;
  isMobileView: boolean;
}

interface ConversationViewContentProps {
  ticket: Ticket;
  messages: ExtendedMessage[];
  ticketId: number;
  isMobileView: boolean;
  onBackClick: () => void;
  onReplySuccess: () => void;
  refetch: () => void;
}

// Empty state when no ticket is selected
function EmptyState() {
  return (
    <div className="h-full flex items-center justify-center bg-white rounded-lg shadow-sm">
      <div className="text-center p-8">
        <div className="mx-auto h-20 w-20 text-slate-400 flex items-center justify-center rounded-full bg-slate-100 mb-4">
          <MessageCircle size={32} />
        </div>
        <h3 className="text-lg font-medium text-slate-900 mb-2">No Ticket Selected</h3>
        <p className="text-slate-500 mb-6 max-w-md">
          Select a ticket from the list to view its conversation history.
        </p>
      </div>
    </div>
  );
}

// Loading state
function LoadingState({ isMobileView, onBackClick }: { isMobileView: boolean; onBackClick: () => void }) {
  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden h-[calc(100vh-10rem)] flex flex-col mt-4 md:mt-0">
      {/* Loading state for header */}
      <div className="border-b border-slate-200 p-4">
        {isMobileView && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="mb-2" 
            onClick={onBackClick}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        )}
        <Skeleton className="h-6 w-1/3 mb-2" />
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      </div>
      
      {/* Loading state for messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

// Error state
function ErrorState({ onBackClick, refetch, error }: { onBackClick: () => void; refetch: () => void; error?: unknown }) {
  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden h-[calc(100vh-10rem)] flex flex-col mt-4 md:mt-0">
      <div className="border-b border-slate-200 p-4">
        <Button 
          variant="ghost" 
          size="sm" 
          className="mb-2" 
          onClick={onBackClick}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      </div>
      
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <div className="mx-auto h-20 w-20 flex items-center justify-center rounded-full bg-red-50 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-slate-900 mb-2">Error Loading Ticket Data</h3>
          <p className="text-slate-500 mb-6">
            {error instanceof Error 
              ? error.message 
              : "We couldn't load the ticket data. Please try again."}
          </p>
          <div className="space-x-2">
            <Button
              onClick={() => refetch()}
              variant="default"
              size="sm"
            >
              Try Again
            </Button>
            <Button
              onClick={onBackClick}
              variant="outline"
              size="sm"
            >
              Go Back
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConversationContent({ 
  ticket, 
  messages, 
  ticketId,
  isMobileView, 
  onBackClick,
  onReplySuccess,
  refetch
}: ConversationViewContentProps) {
  // No longer using thread toggle
  // State for attachment preview dialog
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  
  // Handle opening the attachment preview
  const handleOpenAttachment = (attachment: Attachment) => {
    setPreviewAttachment(attachment);
    setIsPreviewOpen(true);
  };
  
  // Handle closing the attachment preview
  const handleClosePreview = () => {
    setIsPreviewOpen(false);
  };
  
  // State for CC Recipients dialog
  const [isCcDialogOpen, setIsCcDialogOpen] = useState(false);
  
  // New approach: Directly use the ticket's CC recipients as the source of truth
  // Don't merge with message CC recipients to avoid over-complicating things
  
  // Get initial CC recipients directly from the ticket
  const initialCcRecipients = useMemo(() => {
    const ticketCCs = ticket.ccRecipients || [];
    console.log(`Initial CC recipients for ticket #${ticket.id}:`, ticketCCs);
    return [...ticketCCs]; // Create a new array copy to ensure proper comparison
  }, [ticket.id, ticket.ccRecipients, messages.length]);
  
  // Initialize state with the ticket's CC recipients
  const [ccRecipients, setCcRecipients] = useState<string[]>([]);
  const { toast } = useToast();
  
  // Reset CC recipients ONLY when the ticket ID changes
  useEffect(() => {
    console.log(`Ticket changed to #${ticketId}, setting initial CC recipients`);
    setCcRecipients(initialCcRecipients);
  }, [ticketId, initialCcRecipients]);
  
  // Utility function to decode SRS emails in CC lists
  const formatCcRecipients = (ccList: string[]) => {
    if (!ccList || ccList.length === 0) return '';
    
    return ccList.map(cc => {
      if (cc.includes('SRS=')) {
        const decoded = decodeSRSEmail(cc);
        return decoded.email;
      }
      return cc;
    }).join(', ');
  };
  
  // Handle adding a new CC recipient
  const handleAddCcRecipient = (email: string) => {
    // Extract the actual email part for comparison
    const normalizedNewEmail = extractEmailFromString(email);
    
    // Check if this email is already in the CC list by comparing extracted emails
    const emailExists = ccRecipients.some(existingEmail => {
      const normalizedExisting = extractEmailFromString(existingEmail);
      return normalizedExisting === normalizedNewEmail;
    });
    
    console.log(`Adding CC recipient: ${email}, normalized: ${normalizedNewEmail}, exists: ${emailExists}`);
    
    if (!emailExists) {
      const newCcList = [...ccRecipients, email];
      console.log('New CC list after addition:', newCcList);
      setCcRecipients(newCcList);
      updateTicketCcRecipients(newCcList);
    } else {
      console.log('Email already exists in CC list, not adding');
      toast({
        title: 'Duplicate Email',
        description: 'This email address is already in the CC list.',
        variant: 'destructive',
      });
    }
  };
  
  // Helper function to extract the actual email from a formatted string
  const extractEmailFromString = (formattedEmail: string): string => {
    // Case 1: SRS encoded emails
    if (formattedEmail.includes('SRS=')) {
      const decoded = decodeSRSEmail(formattedEmail);
      return decoded.email.toLowerCase().trim();
    }
    
    // Case 2: Standard "Name <email>" format
    if (formattedEmail.includes('<') && formattedEmail.includes('>')) {
      const match = formattedEmail.match(/<([^>]+)>/);
      if (match && match[1]) {
        return match[1].toLowerCase().trim();
      }
    }
    
    // Case 3: Just plain email
    return formattedEmail.toLowerCase().trim();
  };
  
  // Handle removing a CC recipient
  const handleRemoveCcRecipient = (email: string) => {
    console.log('Removing CC recipient:', email);
    
    // Extract the actual email address from the formatted string
    const emailToRemove = extractEmailFromString(email);
    console.log('Extracted email to remove:', emailToRemove);
    
    // Filter out the email to remove by comparing extracted email parts
    const newCcList = ccRecipients.filter(ccItem => {
      const ccEmail = extractEmailFromString(ccItem);
      const shouldKeep = ccEmail !== emailToRemove;
      console.log(`Comparing ${ccEmail} with ${emailToRemove}: keep = ${shouldKeep}`);
      return shouldKeep;
    });
    
    console.log('Previous CC list:', ccRecipients);
    console.log('New CC list after removal:', newCcList);
    
    setCcRecipients(newCcList);
    updateTicketCcRecipients(newCcList);
  };
  
  // Update CC recipients on the server
  const updateTicketCcRecipients = async (newCcList: string[]) => {
    try {
      console.log('Sending PATCH request to update CC recipients:', newCcList);
      
      // Update the ticket on the server
      const updatedTicket = await apiRequest('PATCH', `/api/tickets/${ticketId}`, {
        ccRecipients: newCcList
      });
      
      console.log('Server response after updating CC recipients:', updatedTicket);
      
      // Don't call refetch() here as it can trigger the useEffect and reset CCs
      // Instead, we'll keep using our local state
      
      toast({
        title: 'CC Recipients Updated',
        description: 'The CC list has been updated successfully.',
      });
    } catch (error) {
      console.error('Failed to update CC recipients:', error);
      
      // If there was an error, we should reset our local state to match the server's initial state
      setCcRecipients(initialCcRecipients);
      
      toast({
        title: 'Update Failed',
        description: 'Failed to update CC recipients. Please try again.',
        variant: 'destructive',
      });
    }
  };
  
  // Get status badge color
  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-green-500";
      case "pending":
        return "bg-yellow-500";
      case "closed":
        return "bg-gray-500";
      default:
        return "bg-slate-500";
    }
  };
  
  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden h-[calc(100vh-10rem)] flex flex-col mt-4 md:mt-0">
      {/* Email-like Conversation Header */}
      <div className="border-b border-slate-200 bg-white">
        {/* Top header with back button and ticket status */}
        <div className="p-4 flex items-center justify-between bg-white border-b border-slate-200">
          <div className="flex items-center">
            {isMobileView && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="mr-2" 
                onClick={onBackClick}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            
            <div className="flex items-center">
              <h2 className="text-md font-medium text-slate-800 mr-3">Ticket #{ticket.id}</h2>
              <Badge 
                variant="secondary"
                className={`${getStatusColor(ticket.status)} text-white hover:${getStatusColor(ticket.status)} shrink-0`}
              >
                {ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1)}
              </Badge>
              
              {/* Sync button to manually refresh conversation */}
              <Button
                variant="ghost"
                size="sm"
                className="ml-2 text-slate-500 hover:text-slate-700"
                onClick={() => {
                  refetch();
                  toast({
                    title: "Refreshing conversation",
                    description: "Getting the latest messages...",
                  });
                }}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          {/* Ticket resolution time for closed tickets */}
          {ticket.status === 'closed' && ticket.resolvedAt && (
            <div className="shrink-0 text-xs flex items-center text-green-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Resolved {new Date(ticket.resolvedAt).toLocaleString(undefined, {
                month: 'short', 
                day: 'numeric',
                hour: '2-digit', 
                minute: '2-digit'
              })}
            </div>
          )}
        </div>
        
        {/* Email header with subject and customer details */}
        <div className="px-4 py-3">
          <h3 className="text-lg font-medium text-slate-800 mb-2">{ticket.subject}</h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600">
            <div className="flex items-start">
              <div className="font-medium w-20">From:</div>
              <div className="truncate">
                {ticket.customerEmail && ticket.customerEmail.includes('SRS=') 
                  ? `${decodeSRSEmail(ticket.customerEmail).name} <${decodeSRSEmail(ticket.customerEmail).email}>` 
                  : ticket.customerName
                }
              </div>
            </div>
            
            <div className="flex items-start">
              <div className="font-medium w-20">Date:</div>
              <div>
                {/* Use the first message date (original email time) instead of ticket creation time */}
                {messages.length > 0 ? 
                  new Date(messages[0].createdAt).toLocaleString(undefined, {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short', 
                    day: 'numeric',
                    hour: '2-digit', 
                    minute: '2-digit'
                  })
                  : 
                  new Date(ticket.createdAt).toLocaleString(undefined, {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short', 
                    day: 'numeric',
                    hour: '2-digit', 
                    minute: '2-digit'
                  })
                }
              </div>
            </div>
            
            <div className="flex items-start">
              <div className="font-medium w-20">CC:</div>
              <div className="flex items-center gap-2 flex-wrap">
                {ccRecipients.length > 0 ? (
                  <>
                    {ccRecipients.slice(0, 3).map((recipient, index) => {
                      // Format recipient for display
                      let formattedName = recipient;
                      if (recipient.includes('SRS=')) {
                        const decoded = decodeSRSEmail(recipient);
                        formattedName = decoded.name || decoded.email;
                      } else if (recipient.includes('<') && recipient.includes('>')) {
                        const match = recipient.match(/(.+)\s+<(.+)>/);
                        if (match) {
                          formattedName = match[1].trim();
                        }
                      }
                      
                      return (
                        <Badge key={index} variant="outline" className="text-xs bg-white px-2 py-0.5 h-5">
                          {formattedName}
                        </Badge>
                      );
                    })}
                    
                    {ccRecipients.length > 3 && (
                      <Badge variant="outline" className="text-xs bg-white px-2 py-0.5 h-5">
                        +{ccRecipients.length - 3} more
                      </Badge>
                    )}
                  </>
                ) : (
                  <span className="text-slate-500 text-xs">No CC recipients</span>
                )}
                
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="h-6 text-xs py-0 px-2 flex items-center gap-1 ml-2"
                  onClick={() => setIsCcDialogOpen(true)}
                >
                  <Users className="h-3 w-3" />
                  {ccRecipients.length > 0 ? 'Edit' : 'Add'}
                </Button>
              </div>
            </div>
            
            {/* CC Recipients Dialog */}
            <CCRecipientsDialog
              open={isCcDialogOpen}
              onOpenChange={setIsCcDialogOpen}
              recipients={ccRecipients}
              onAddRecipient={handleAddCcRecipient}
              onRemoveRecipient={handleRemoveCcRecipient}
            />
            
            {ticket.assignedUser && (
              <div className="flex items-start">
                <div className="font-medium w-20">Assigned to:</div>
                <div className="flex items-center">
                  <Avatar className="h-5 w-5 mr-1">
                    <AvatarFallback className="text-[10px]">{getInitials(ticket.assignedUser.name)}</AvatarFallback>
                  </Avatar>
                  <span>{ticket.assignedUser.name}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Freshdesk-style Timeline Conversation */}
      <div className="flex-1 overflow-y-auto p-4" style={{ scrollBehavior: 'smooth' }}>
        
        {/* Freshdesk style timeline UI */}
        <div className="relative pl-6 pb-6">
          {/* Vertical timeline line */}
          <div className="absolute left-3 top-6 bottom-0 w-0.5 bg-slate-200"></div>
          
          {messages.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-slate-500">No messages in this conversation yet.</p>
            </div>
          ) : (
            messages.map((message, index) => (
              <div key={message.id} className="mb-6 relative">
                {/* Timeline circle */}
                <div 
                  className={`absolute left-0 w-6 h-6 rounded-full flex items-center justify-center z-10 border-2 ${message.isAgent ? 'bg-sky-100 border-white' : 'bg-slate-100 border-white'}`}
                >
                  <div className={`w-2 h-2 rounded-full ${message.isAgent ? 'bg-sky-500' : 'bg-slate-500'}`}></div>
                </div>
                
                {/* Message header with avatar */}
                <div className="flex mb-2 items-center">
                  <div className="ml-4 flex items-center">
                    <Avatar className={`h-8 w-8 mr-2 ${message.isAgent ? 'bg-sky-100' : 'bg-slate-200'}`}>
                      <AvatarFallback className={`${message.isAgent ? 'text-sky-600' : 'text-slate-600'} text-xs`}>
                        {!message.isAgent && message.senderEmail && message.senderEmail.includes('SRS=') 
                          ? getInitials(decodeSRSEmail(message.senderEmail).name)
                          : getInitials(message.sender)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="text-sm font-medium text-slate-800 flex items-center">
                        <span>
                          {!message.isAgent && message.senderEmail && message.senderEmail.includes('SRS=') 
                            ? decodeSRSEmail(message.senderEmail).name
                            : message.sender}
                        </span>
                        {message.isAgent && (
                          <Badge variant="outline" className="ml-2 text-xs bg-sky-50 text-sky-600 border-sky-200">
                            Support Agent
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">
                        {new Date(message.createdAt).toLocaleString(undefined, {
                          weekday: 'short',
                          month: 'short', 
                          day: 'numeric',
                          hour: '2-digit', 
                          minute: '2-digit'
                        })}
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Message content card */}
                <div className="ml-8 rounded-lg border border-slate-200 shadow-sm bg-white overflow-hidden">
                  {message.isSatisfactionResponse ? (
                    <div className="bg-green-50 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-md font-medium text-green-800">Customer Satisfaction Rating</h4>
                        {message.satisfactionRating && (
                          <div className="flex items-center">
                            <div className="text-2xl mr-2">
                              {message.satisfactionRating === 5 && "😃"}
                              {message.satisfactionRating === 4 && "🙂"}
                              {message.satisfactionRating === 3 && "😐"}
                              {message.satisfactionRating === 2 && "🙁"}
                              {message.satisfactionRating === 1 && "😡"}
                            </div>
                            <div className="font-medium">
                              {message.satisfactionRating === 5 && "Excellent"}
                              {message.satisfactionRating === 4 && "Good"}
                              {message.satisfactionRating === 3 && "Average"}
                              {message.satisfactionRating === 2 && "Poor"}
                              {message.satisfactionRating === 1 && "Bad"}
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="mb-2 mt-4">
                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                          <div 
                            className={`h-2.5 rounded-full ${
                              message.satisfactionRating === 5 ? 'bg-green-500' :
                              message.satisfactionRating === 4 ? 'bg-green-400' :
                              message.satisfactionRating === 3 ? 'bg-yellow-400' :
                              message.satisfactionRating === 2 ? 'bg-orange-400' :
                              'bg-red-500'
                            }`}
                            style={{ width: `${(message.satisfactionRating || 0) * 20}%` }}
                          ></div>
                        </div>
                      </div>
                      
                      <div className="text-sm text-slate-600 mt-2">
                        {message.content}
                      </div>
                    </div>
                  ) : (
                    <div className="p-4">
                      {/* Message content - show full email thread as received */}
                      <div className="prose prose-sm max-w-none">
                        {message.content && typeof message.content === 'string' && message.content.trim() !== '' ? (
                          // Show full email content as it was received
                          <div className="text-sm text-slate-700">
                            {/* Display the full content including thread history */}
                            {message.content.split('\n').map((paragraph, idx) => (
                              <p key={idx} className="mb-2">{paragraph || ' '}</p>
                            ))}
                          </div>
                        ) : (
                          // Different placeholders based on attachments
                          <p className="text-sm text-slate-500">
                            {(message.attachments && Array.isArray(message.attachments) && message.attachments.length > 0) ? 
                              `Email with ${message.attachments.length} attachment${message.attachments.length !== 1 ? 's' : ''}` : 
                              (message.content === '[Empty email]' ? 'Empty email received with no content' : 'No content available')}
                          </p>
                        )}
                      </div>
                      
                      {/* Attachments Section */}
                      {message.attachments && Array.isArray(message.attachments) && message.attachments.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-slate-100">
                          <div className="text-xs font-medium text-slate-700 mb-2">Attachments ({message.attachments.length})</div>
                          <div className="flex flex-wrap gap-2">
                            {message.attachments.map((attachment, idx) => {
                              // Skip rendering if attachment is null or not an object
                              if (!attachment || typeof attachment !== 'object') {
                                return null;
                              }
                              
                              // Safe property access with proper type casting
                              const attachmentObj = attachment as any;
                              
                              // Safely extract attachment properties with fallbacks
                              let fileName = typeof attachmentObj.originalName === 'string' ? attachmentObj.originalName :
                                            typeof attachmentObj.filename === 'string' ? attachmentObj.filename :
                                            typeof attachmentObj.name === 'string' ? attachmentObj.name :
                                            'Attachment';
                              
                              // Handle different URL formats
                              let fileUrl = '#';
                              if (typeof attachmentObj.url === 'string') {
                                fileUrl = attachmentObj.url;
                              }
                              
                              // Determine if a preview should be available
                              const fileExt = (fileName.split('.').pop() || '').toLowerCase();
                              const canPreview = ['jpg', 'jpeg', 'png', 'gif', 'pdf'].includes(fileExt);
                              
                              const standardizedAttachment: Attachment = {
                                url: fileUrl,
                                filename: fileName,
                                originalName: typeof attachmentObj.originalName === 'string' ? attachmentObj.originalName : undefined,
                                name: typeof attachmentObj.name === 'string' ? attachmentObj.name : undefined,
                                size: typeof attachmentObj.size === 'number' ? attachmentObj.size : undefined,
                                mimetype: typeof attachmentObj.mimetype === 'string' ? attachmentObj.mimetype : undefined,
                                contentType: typeof attachmentObj.contentType === 'string' ? attachmentObj.contentType : undefined,
                                path: typeof attachmentObj.path === 'string' ? attachmentObj.path : undefined,
                                messageId: message.id
                              };
                              
                              return (
                                <div key={idx} className="flex-none">
                                  <div 
                                    className={`
                                      border border-slate-200 rounded-md p-2 flex items-center 
                                      ${canPreview ? 'cursor-pointer hover:bg-slate-50' : ''}
                                    `}
                                    onClick={() => canPreview && handleOpenAttachment(standardizedAttachment)}
                                  >
                                    <div className="flex-shrink-0 mr-2">
                                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                      </svg>
                                    </div>
                                    <div className="flex-grow min-w-0">
                                      <div className="text-xs font-medium text-slate-700 truncate max-w-[120px]">
                                        {fileName}
                                      </div>
                                      {attachmentObj.size && (
                                        <div className="text-xs text-slate-500">
                                          {typeof attachmentObj.size === 'number' 
                                            ? Math.round(attachmentObj.size / 1024) + ' KB'
                                            : typeof attachmentObj.size === 'string' 
                                              ? attachmentObj.size
                                              : ''}
                                        </div>
                                      )}
                                    </div>
                                    {canPreview && (
                                      <div className="ml-2 flex-shrink-0 text-xs text-sky-600">
                                        Preview
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      
                      {/* Message metadata */}
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <details className="text-xs text-slate-500">
                          <summary className="cursor-pointer hover:text-slate-700">Show email details</summary>
                          <div className="mt-2 space-y-1 pl-3 border-l-2 border-slate-100">
                            {message.isAgent ? (
                              <>
                                <p>From: {ticket.desk?.name || "Support"} &lt;{formatEmailAddress(ticket.desk?.email || "postmaster")}&gt;</p>
                                <p>To: {
                                  ticket.customerEmail && ticket.customerEmail.includes('SRS=') 
                                    ? `${decodeSRSEmail(ticket.customerEmail).name} <${decodeSRSEmail(ticket.customerEmail).email}>` 
                                    : `${ticket.customerName} <${ticket.customerEmail}>`
                                }</p>
                                {message.ccRecipients && message.ccRecipients.length > 0 && (
                                  <p>CC: {formatCcRecipients(message.ccRecipients)}</p>
                                )}
                              </>
                            ) : (
                              <>
                                <p>From: {
                                  message.senderEmail && message.senderEmail.includes('SRS=') 
                                    ? `${decodeSRSEmail(message.senderEmail).name} <${decodeSRSEmail(message.senderEmail).email}>` 
                                    : message.senderEmail 
                                      ? `${message.sender} <${message.senderEmail}>` 
                                      : message.sender
                                }</p>
                                <p>To: {ticket.desk?.name || "Support"} &lt;{formatEmailAddress(ticket.desk?.email || "postmaster")}&gt;</p>
                                {message.ccRecipients && message.ccRecipients.length > 0 && (
                                  <p>CC: {formatCcRecipients(message.ccRecipients)}</p>
                                )}
                              </>
                            )}
                            {message.messageId && (
                              <p className="text-slate-400">Message ID: {message.messageId.slice(0, 12)}...</p>
                            )}
                          </div>
                        </details>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {/* Reply form section - only visible for open tickets */}
      {ticket.status !== 'closed' ? (
        <div className="border-t border-slate-200">
          <ReplyForm 
            ticketId={ticketId} 
            onSuccess={() => {
              refetch();
              onReplySuccess();
            }}
            isTicketClosed={false} 
            ticket={{
              id: ticket.id,
              status: ticket.status,
              customerEmail: ticket.customerEmail,
              customerName: ticket.customerName,
              subject: ticket.subject,
              createdAt: ticket.createdAt.toString(),
              resolvedAt: ticket.resolvedAt?.toString()
            }}
            latestMessage={messages.length > 0 ? {
              ccRecipients: messages[messages.length - 1].ccRecipients || []
            } : undefined}
          />
        </div>
      ) : (
        <div className="border-t border-slate-200 p-4">
          <div className="bg-blue-50 text-blue-800 p-3 rounded-md border border-blue-200 flex items-start gap-2">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium mb-1">Ticket Closed</h4>
              <p className="text-sm">
                This ticket was closed on {new Date(ticket.resolvedAt || ticket.updatedAt).toLocaleString()}. 
                For further assistance, please create a new ticket.
              </p>
            </div>
          </div>
        </div>
      )}
      
      {/* Attachment Preview Dialog */}
      <AttachmentPreviewDialog
        isOpen={isPreviewOpen}
        onClose={handleClosePreview}
        attachment={previewAttachment}
      />
    </div>
  );
}

export default function ConversationView({
  ticketId,
  onBackClick,
  onReplySuccess,
  isMobileView
}: ConversationViewProps) {
  console.log(`ConversationView rendering with ticketId: ${ticketId}`);
  
  // Fetch ticket and messages with enhanced configuration
  const { 
    data,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery({
    queryKey: [`/api/tickets/${ticketId}`],
    queryFn: getQueryFn({ on401: "throw" }), // Explicitly set 401 behavior to throw errors
    enabled: !!ticketId,
    retry: (failureCount, error) => {
      // Don't retry on authentication errors
      if (error.message?.includes('401') || error.message?.toLowerCase().includes('unauthorized')) {
        console.warn('Auth error detected, not retrying');
        return false;
      }
      return failureCount < 2; // Otherwise retry up to 2 times
    },
    retryDelay: 1000, // Wait 1 second between retries
    // Auto-refresh data every 15 seconds to show new replies automatically
    refetchInterval: 15000,
    refetchIntervalInBackground: true
  });
  
  // Add debug logs for API responses
  useEffect(() => {
    if (data) {
      console.log(`Ticket data loaded successfully for ID ${ticketId}:`, data);
      const typedData = data as {ticket?: any, messages?: any[]};
      if (!typedData.ticket) {
        console.error("Missing ticket data in response");
      }
      if (!typedData.messages) {
        console.error("Missing messages data in response");
      } else {
        console.log(`Loaded ${typedData.messages.length} messages for ticket #${ticketId}`);
      }
    }
    if (error) {
      console.error(`Error loading ticket data for ID ${ticketId}:`, error);
    }
  }, [data, error, ticketId]);

  // Empty state when no ticket is selected
  if (!ticketId) {
    return <EmptyState />;
  }
  
  // Loading state
  if (isLoading) {
    return <LoadingState isMobileView={isMobileView} onBackClick={onBackClick} />;
  }
  
  // Error state
  if (isError || !data) {
    return <ErrorState onBackClick={onBackClick} refetch={refetch} error={error} />;
  }
  
  // Check if data has the expected structure
  const ticketData = data as any;
  
  // Enhanced debugging
  console.log(`Detailed ticketData response:`, JSON.stringify(ticketData));
  
  if (!ticketData || typeof ticketData !== 'object') {
    console.error("Data is not an object:", ticketData);
    return <ErrorState 
      onBackClick={onBackClick} 
      refetch={refetch} 
      error={new Error(`Invalid response: ${typeof ticketData} instead of object`)} 
    />;
  }
  
  if (!ticketData.ticket) {
    console.error("Missing 'ticket' in data:", ticketData);
    return <ErrorState 
      onBackClick={onBackClick} 
      refetch={refetch} 
      error={new Error("Server response missing ticket data")} 
    />;
  }
  
  if (!ticketData.messages) {
    console.error("Missing 'messages' in data:", ticketData);
    return <ErrorState 
      onBackClick={onBackClick} 
      refetch={refetch} 
      error={new Error("Server response missing messages data")} 
    />;
  }
  
  if (!Array.isArray(ticketData.messages)) {
    console.error("'messages' is not an array:", ticketData.messages);
    return <ErrorState 
      onBackClick={onBackClick} 
      refetch={refetch} 
      error={new Error("Server returned invalid messages format")} 
    />;
  }
  
  // Safe cast data to our expected types
  const ticket = ticketData.ticket as Ticket;
  const messages = ticketData.messages.map((msg: any) => {
    // Process attachments safely to ensure they're in the expected format
    let attachments: Attachment[] = [];
    
    if (msg.attachments && Array.isArray(msg.attachments)) {
      attachments = msg.attachments.filter((a: any) => a && typeof a === 'object');
    }
    
    return {
      ...msg,
      attachments: attachments
    } as ExtendedMessage;
  })
  // Sort messages in descending order (newest first)
  .sort((a: ExtendedMessage, b: ExtendedMessage) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Main content when data is available
  return (
    <ConversationContent 
      ticket={ticket} 
      messages={messages}
      ticketId={ticketId}
      isMobileView={isMobileView}
      onBackClick={onBackClick}
      onReplySuccess={onReplySuccess}
      refetch={refetch}
    />
  );
}
