import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { decodeSRSEmail, formatEmailAddress } from "@/lib/email-utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Paperclip, FileText, AlertCircle, CheckCircle, X, Mail, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

interface ReplyFormProps {
  ticketId: number;
  onSuccess: () => void;
  isTicketClosed: boolean;
  ticket: {
    id: number;
    status: string;
    customerEmail: string;
    customerName: string;
    subject: string;
    createdAt: string;
    resolvedAt?: string;
    ccRecipients?: string[]; // Add CC recipients to the ticket interface
  };
  latestMessage?: {
    ccRecipients?: string[];
  };
}

export default function ReplyForm({
  ticketId,
  onSuccess,
  isTicketClosed,
  ticket,
  latestMessage
}: ReplyFormProps) {
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [showSatisfactionQuestion, setShowSatisfactionQuestion] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileInputRef, setFileInputRef] = useState<HTMLInputElement | null>(null);
  // Get all CC recipients from both the ticket and the latest message
  const getInitialCcRecipients = (): string[] => {
    const uniqueCCs = new Set<string>();
    
    // Add CC recipients from the ticket if available
    if (ticket.ccRecipients && Array.isArray(ticket.ccRecipients)) {
      ticket.ccRecipients.forEach(cc => uniqueCCs.add(cc));
    }
    
    // Add CC recipients from the latest message if available
    if (latestMessage?.ccRecipients && Array.isArray(latestMessage.ccRecipients)) {
      latestMessage.ccRecipients.forEach(cc => uniqueCCs.add(cc));
    }
    
    return Array.from(uniqueCCs);
  };
  
  const [ccRecipients, setCcRecipients] = useState<string[]>(getInitialCcRecipients());
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Function to send ticket closure notification
  const sendClosureNotification = async () => {
    try {
      console.log("Sending closure notification for ticket:", ticketId);
      const response = await apiRequest("POST", `/api/tickets/${ticketId}/resolve-notification`, {
        customerEmail: ticket.customerEmail,
        customerName: ticket.customerName,
        subject: ticket.subject
      });
      const data = await response.json();
      console.log("Closure notification response:", data);
      return data;
    } catch (error) {
      console.error("Failed to send closure notification:", error);
      // We don't need to show this error to the user as the ticket is still resolved
      toast({
        title: "Note",
        description: "Ticket was resolved, but we couldn't send the feedback email. The support team has been notified.",
        variant: "default"
      });
    }
  };
  
  // Status update mutation
  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      const res = await apiRequest("PATCH", `/api/tickets/${ticketId}/status`, { status });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tickets/${ticketId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      onSuccess();
      
      // Send ticket closure notification
      sendClosureNotification();
      
      toast({
        title: "Ticket resolved",
        description: "The ticket has been permanently closed and customer has been notified.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to update ticket status",
        description: error.message,
        variant: "destructive",
      });
    }
  });
  
  // Reply mutation
  const replyMutation = useMutation({
    mutationFn: async (content: string) => {
      // Set submitting state to show loading indicators
      setIsSubmitting(true);
      
      // Create FormData to handle files
      const formData = new FormData();
      formData.append("content", content);
      
      // Add any CC recipients if present
      if (ccRecipients.length > 0) {
        formData.append("ccRecipients", JSON.stringify(ccRecipients));
      }
      
      // Add any selected files to the form data
      selectedFiles.forEach(file => {
        formData.append("attachments", file);
      });
      
      // Use fetch directly for FormData, as apiRequest doesn't support formData
      const res = await fetch(`/api/tickets/${ticketId}/messages`, {
        method: "POST",
        body: formData,
        credentials: "include"
      });
      
      // Enhanced error handling, similar to apiRequest
      if (res.status === 401) {
        console.warn("401 Unauthorized - Session expired when sending attachment");
        // Store the current URL to redirect back after login
        const currentPath = window.location.pathname;
        if (currentPath !== '/auth' && currentPath !== '/') {
          console.log('Storing redirect path for after login:', currentPath);
          sessionStorage.setItem('redirectAfterLogin', currentPath);
        }
        throw new Error("Your session has expired. Please log in again.");
      }
      
      if (!res.ok) {
        let errorMessage = "Failed to send reply";
        try {
          const errorData = await res.json();
          errorMessage = errorData.message || errorMessage;
        } catch (e) {
          // If parsing JSON fails, use status text
          errorMessage = res.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      
      return await res.json();
    },
    onSuccess: (message) => {
      setContent("");
      setSelectedFiles([]);
      // Use the correct query key format for invalidation
      queryClient.invalidateQueries({ queryKey: [`/api/tickets/${ticketId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      onSuccess();
      toast({
        title: "Reply sent",
        description: "Your response has been sent to the customer.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to send reply",
        description: error.message,
        variant: "destructive",
      });
    }
  });
  
  // File handling functions
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setSelectedFiles(prev => [...prev, ...newFiles]);
    }
  };
  
  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };
  
  const handleAttachClick = () => {
    // Trigger file input click
    fileInputRef?.click();
  };
  
  // CC recipients handling is now managed in the conversation-view component

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    
    // Pass ccRecipients in the form data
    const formData = new FormData();
    formData.append("content", content);
    
    // Add CC recipients
    if (ccRecipients.length > 0) {
      formData.append("ccRecipients", JSON.stringify(ccRecipients));
    }
    
    // Add attachments
    selectedFiles.forEach(file => {
      formData.append("attachments", file);
    });
    
    // Use replySendWithFormData instead of replyMutation.mutate
    replySendWithFormData(formData);
  };
  
  // Send form data with CC recipients and attachments
  const replySendWithFormData = async (formData: FormData) => {
    try {
      setIsSubmitting(true);
      // Use fetch directly for FormData
      const res = await fetch(`/api/tickets/${ticketId}/messages`, {
        method: "POST",
        body: formData,
        credentials: "include"
      });
      
      // Error handling
      if (res.status === 401) {
        console.warn("401 Unauthorized - Session expired when sending attachment");
        // Store the current URL to redirect back after login
        const currentPath = window.location.pathname;
        if (currentPath !== '/auth' && currentPath !== '/') {
          console.log('Storing redirect path for after login:', currentPath);
          sessionStorage.setItem('redirectAfterLogin', currentPath);
        }
        throw new Error("Your session has expired. Please log in again.");
      }
      
      if (!res.ok) {
        let errorMessage = "Failed to send reply";
        try {
          const errorData = await res.json();
          errorMessage = errorData.message || errorMessage;
        } catch (e) {
          // If parsing JSON fails, use status text
          errorMessage = res.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      
      const data = await res.json();
      
      // Success handlers
      setContent("");
      setSelectedFiles([]); 
      // Note: CC Recipients management moved to conversation-view
      
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: [`/api/tickets/${ticketId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      
      onSuccess();
      
      toast({
        title: "Reply sent",
        description: "Your response has been sent to the customer.",
      });
      
      return data;
    } catch (error: any) {
      // Error toast
      toast({
        title: "Failed to send reply",
        description: error.message,
        variant: "destructive",
      });
      
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Disable form if ticket is closed
  if (isTicketClosed) {
    return (
      <div className="border-t border-slate-200 p-4">
        <Alert className="mb-3 bg-blue-50 border-blue-200 text-blue-800">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            This ticket has been permanently closed. For further assistance, please create a new ticket.
          </AlertDescription>
        </Alert>
        
        <Textarea
          placeholder="This ticket is closed. You cannot reply to it."
          rows={3}
          disabled
          className="mb-3"
        />
        
        <div className="flex justify-between items-center">
          <div className="flex space-x-2">
            <Button variant="outline" size="sm" disabled>
              <Paperclip className="h-4 w-4 mr-1" /> Attach File
            </Button>
          </div>
          
          <Button type="button" disabled>
            Send Reply
          </Button>
        </div>
      </div>
    );
  }
  
  // Get properly formatted recipient information for display
  const getFormattedRecipient = () => {
    // Check if the email is SRS-encoded
    if (ticket.customerEmail && ticket.customerEmail.includes('SRS=')) {
      const decoded = decodeSRSEmail(ticket.customerEmail);
      return `${decoded.name} <${decoded.email}>`;
    }
    return `${ticket.customerName} <${ticket.customerEmail}>`;
  };
  
  return (
    <div className="border-t border-slate-200 p-4">
      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <Textarea
            id="reply-content"
            rows={3}
            placeholder="Type your reply..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={replyMutation.isPending}
            className="block w-full rounded-md"
          />
        </div>
        
        {/* Note: CC Recipients section has been moved to the ticket header */}
        
        {/* Display selected files */}
        {selectedFiles.length > 0 && (
          <div className="mb-3 border rounded-md p-2 bg-gray-50">
            <div className="text-sm font-medium mb-1">Attachments ({selectedFiles.length})</div>
            <div className="flex flex-wrap gap-2">
              {selectedFiles.map((file, index) => (
                <div key={index} className="flex items-center gap-1 bg-white py-1 px-2 rounded border text-xs">
                  <FileText className="h-3 w-3" />
                  <span className="truncate max-w-[120px]">{file.name}</span>
                  <button 
                    type="button" 
                    onClick={() => removeFile(index)} 
                    className="text-red-500 hover:text-red-700"
                    disabled={replyMutation.isPending}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="flex justify-between items-center">
          <div className="flex space-x-2">
            <Button 
              variant="outline" 
              size="sm" 
              type="button" 
              disabled={isSubmitting}
              onClick={handleAttachClick}
            >
              <Paperclip className="h-4 w-4 mr-1" /> Attach File
            </Button>
            
            {/* Hidden file input */}
            <input
              type="file"
              ref={input => setFileInputRef(input)}
              onChange={handleFileChange}
              multiple
              style={{ display: 'none' }}
            />
          </div>
          
          <div className="flex space-x-2">
            <Button
              type="button"
              variant="outline"
              disabled={statusMutation.isPending || replyMutation.isPending}
              onClick={() => statusMutation.mutate("closed")}
              className="bg-green-600 border-green-600 text-white hover:bg-green-700 hover:text-white hover:border-green-700"
            >
              {statusMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-1" />
              )}
              Resolve Ticket
            </Button>
            
            <Button 
              type="submit" 
              disabled={isSubmitting || !content.trim()}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" /> 
                  Sending...
                </>
              ) : (
                "Send Reply"
              )}
            </Button>
          </div>
        </div>
        
        {/* Ticket Resolution Time */}
        {ticket && (
          <div className="flex mt-4 text-xs text-slate-500 justify-between">
            <div>
              <span className="font-medium">Created:</span> {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
            </div>
            {ticket.status === "closed" && ticket.resolvedAt && (
              <div>
                <span className="font-medium">Resolved:</span> {formatDistanceToNow(new Date(ticket.resolvedAt), { addSuffix: true })}
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
