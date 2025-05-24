import { useState, useEffect } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { Check, Clock, RefreshCcw, Loader2, UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Ticket } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { decodeSRSEmail, getInitials } from "@/lib/email-utils";

interface ExtendedTicket extends Ticket {
  assignedUser?: {
    id: number;
    name: string;
    username: string;
  };
}

interface TicketItemProps {
  ticket: ExtendedTicket;
  isSelected: boolean;
  onSelect: () => void;
  onStatusChange: () => void;
}

export default function TicketItem({
  ticket,
  isSelected,
  onSelect,
  onStatusChange
}: TicketItemProps) {
  const { toast } = useToast();
  const [isHovered, setIsHovered] = useState(false);
  const isMobile = useIsMobile();
  
  // Get formatted customer email that handles SRS decoding
  const getFormattedCustomerEmail = () => {
    if (ticket.customerEmail && ticket.customerEmail.includes('SRS=')) {
      const decoded = decodeSRSEmail(ticket.customerEmail);
      return `${decoded.name} <${decoded.email}>`;
    }
    return ticket.customerName;
  };
  
  // Format ticket creation date - use exact date format to match Gmail timestamps
  const formattedDate = new Date(ticket.createdAt).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short', 
    day: 'numeric',
    hour: '2-digit', 
    minute: '2-digit'
  });
  
  // Get status badge color and style
  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-green-500";
      case "pending":
        return "bg-yellow-500";
      case "closed":
        return "bg-gray-600";
      default:
        return "bg-slate-500";
    }
  };
  
  // Get badge extra classes based on status
  const getStatusBadgeClasses = (status: string) => {
    if (status === "closed") {
      return "flex items-center gap-1";
    }
    return "";
  };
  
  // Status update mutation
  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      const res = await apiRequest("PATCH", `/api/tickets/${ticket.id}/status`, { status: newStatus });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      onStatusChange();
      toast({
        title: "Status updated",
        description: `Ticket status changed to ${updateStatusMutation.variables}`,
      });
    },
    onError: (error) => {
      toast({
        title: "Status update failed",
        description: error.message,
        variant: "destructive",
      });
    }
  });
  
  // Status change handlers
  const handlePending = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateStatusMutation.mutate("pending");
  };
  
  const handleReopen = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateStatusMutation.mutate("open");
  };
  
  return (
    <div
      className={`border-b border-slate-200 cursor-pointer hover:bg-slate-50 transition ${
        isSelected ? "bg-blue-50 border-l-2 sm:border-l-4 border-primary-500" : ""
      }`}
      onClick={onSelect}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="p-3 sm:p-4">
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-sm font-medium text-slate-900 truncate max-w-[70%] sm:max-w-[80%]">
            {ticket.subject}
          </h3>
          <Badge 
            variant="secondary"
            className={`${getStatusColor(ticket.status)} text-white hover:${getStatusColor(ticket.status)} text-xs shrink-0 ${getStatusBadgeClasses(ticket.status)}`}
          >
            {ticket.status === "closed" && <Check className="h-3 w-3" />}
            {ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1)}
          </Badge>
        </div>
        
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-2 gap-1">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-slate-500 truncate max-w-full">
              {getFormattedCustomerEmail()}
            </span>
            
            {ticket.assignedUser && (
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <Avatar className="h-4 w-4">
                  <AvatarFallback className="text-[8px]">{getInitials(ticket.assignedUser.name)}</AvatarFallback>
                </Avatar>
                <span className="flex items-center">
                  <UserIcon className="h-3 w-3 mr-1 text-slate-400" />
                  Assigned to: {ticket.assignedUser.name}
                </span>
              </div>
            )}
          </div>
          
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs text-slate-500 shrink-0">Created: {formattedDate}</span>
            {ticket.status === "closed" && (
              <span className="text-xs text-slate-500 shrink-0">
                Resolved: {new Date((ticket as any).resolvedAt || ticket.updatedAt).toLocaleString(undefined, {
                  weekday: 'short',
                  month: 'short', 
                  day: 'numeric',
                  hour: '2-digit', 
                  minute: '2-digit'
                })}
              </span>
            )}
          </div>
        </div>
        
        {/* Actions */}
        {(isHovered || isSelected || isMobile) && !updateStatusMutation.isPending && (
          <div className="mt-2 flex flex-wrap gap-2">
            {ticket.status === "open" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 py-1 text-xs"
                onClick={handlePending}
              >
                <Clock className="h-3 w-3 mr-1" /> 
                <span>Pending</span>
              </Button>
            )}
            
            {ticket.status === "pending" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 py-1 text-xs"
                onClick={handleReopen}
              >
                <RefreshCcw className="h-3 w-3 mr-1" /> 
                <span>Reopen</span>
              </Button>
            )}
          </div>
        )}
        
        {/* Loading state */}
        {updateStatusMutation.isPending && (
          <div className="mt-2">
            <Button size="sm" variant="outline" className="h-7 px-2 py-1 text-xs" disabled>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Updating...
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
