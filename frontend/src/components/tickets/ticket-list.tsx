import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import TicketItem from '@/components/tickets/ticket-item';
import { NewTicketDialog } from '@/components/tickets/new-ticket-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus, Mail, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';


interface Ticket {
  id: number;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  customerName: string;
  customerEmail: string;
  assignedToName: string | null;
  deskId: number;
  deskName: string;
}

interface PaginatedResponse {
  tickets: Ticket[];
  pagination: {
    totalItems: number;
    totalPages: number;
    currentPage: number;
    perPage: number;
  };
}

interface TicketListProps {
  deskId?: number;
  tickets?: Ticket[];
  isLoading?: boolean;
  isError?: boolean;
  selectedTicketId?: number | null;
  onSelectTicket?: (id: number) => void;
  onStatusChange?: () => void;
  selectedDesk?: any;
  pagination?: any;
  onPageChange?: (page: number) => void;
}

export function TicketList({ 
  deskId,
  tickets: propTickets,
  isLoading: propIsLoading,
  isError: propIsError,
  selectedTicketId,
  onSelectTicket,
  onStatusChange,
  selectedDesk,
  pagination: propPagination,
  onPageChange
}: TicketListProps) {
  console.log('TicketList props:', { propTickets, selectedTicketId, onSelectTicket });
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('updatedAt'); // Changed default to updatedAt
  const [sortOrder, setSortOrder] = useState('desc'); // Default to desc for newest first
  const [status, setStatus] = useState('open');
  const [localPage, setLocalPage] = useState(1);
  
  // Use the page from pagination if available, otherwise use local state
  const page = propPagination?.currentPage || localPage;

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const perPage = 10; // Match dashboard setting of 10 items per page

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState(searchTerm);
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 500);
    
    return () => clearTimeout(timer);
  }, [searchTerm]);
  
  // Use props data if provided, otherwise fall back to API route
  // This allows the component to work either with data passed directly or fetched on its own
  const usePropsData = propTickets !== undefined;
  
  // If deskId is provided and we should not use props data, construct API route
  const apiRoute = !usePropsData
    ? `/api/tickets?${new URLSearchParams({
        status,
        sortBy,
        sortOrder,
        ...(deskId ? { deskId: deskId.toString() } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        page: page.toString(),
        perPage: perPage.toString()
      }).toString()}`
    : null;
  
  const {
    data,
    isLoading: queryIsLoading,
    isError: queryIsError,
    error,
    refetch
  } = useQuery<PaginatedResponse>({
    queryKey: [apiRoute],
    throwOnError: false,
    staleTime: 30000, // Keep data fresh for 30 seconds to reduce API calls
    enabled: !usePropsData, // Only run the query if we're not using props data
  });
  
  // Use props values if provided, otherwise use query results
  const isLoading = usePropsData ? propIsLoading : queryIsLoading;
  const isError = usePropsData ? propIsError : queryIsError;

  // Use props data if provided, otherwise use data from query
  const tickets = usePropsData ? propTickets || [] : data?.tickets || [];
  const pagination = data?.pagination || {
    totalItems: 0,
    totalPages: 0,
    currentPage: 1,
    perPage: perPage
  };

  // Handle "Check Emails" success
  const handleEmailCheckSuccess = useCallback((count: number) => {
    if (count > 0) {
      refetch();
    }
  }, [refetch]);

  // Don't use automatic polling - we'll use manual refresh instead
  useEffect(() => {
    // Stop any continuous polling
    const stopPolling = async () => {
      try {
        await fetch(`${import.meta.env.VITE_API_URL}/api/email/polling`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            action: 'stop'
          }),
          credentials: 'include'
        });
        console.log('Stopped continuous email polling');
      } catch (error) {
        console.error('Error stopping email polling:', error);
      }
    };
    
    stopPolling();
    
    // Instead, do a one-time check on component load
    const checkEmailsOnce = async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/api/email/polling`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            action: 'check_now'
          }),
          credentials: 'include'
        });
        
        const data = await response.json();
        if (data.success) {
          console.log(`Email check successful. Found ${data.newEmails} new emails.`);
          if (data.newEmails > 0) {
            refetch();
          }
        } else {
          console.log('Email check completed with no new emails');
        }
      } catch (error) {
        console.error('Error checking emails:', error);
      }
    };
    
    // Only check emails on first load
    checkEmailsOnce();
  }, []);

  // Handle ticket selection
  const handleSelectTicket = (id: number) => {
    console.log(`Selecting ticket with ID: ${id}`, typeof id);
    if (onSelectTicket) {
      // Call the function passed from the parent component
      onSelectTicket(id);
      console.log('Called onSelectTicket with ID:', id);
    } else {
      // Fallback to the old behavior if onSelectTicket isn't provided
      console.log('No onSelectTicket provided, using location change fallback');
      setLocation(`/tickets/${id}`);
    }
  };

  // Pagination handlers
  const handlePreviousPage = useCallback(() => {
    if (page > 1) {
      const newPage = page - 1;
      if (onPageChange) {
        onPageChange(newPage);
      }
      setLocalPage(newPage);
    }
  }, [page, onPageChange]);

  const handleNextPage = useCallback(() => {
    if (page < pagination.totalPages) {
      const newPage = page + 1;
      if (onPageChange) {
        onPageChange(newPage);
      }
      setLocalPage(newPage);
    }
  }, [page, pagination.totalPages, onPageChange]);

  const goToPage = useCallback((pageNumber: number) => {
    if (pageNumber >= 1 && pageNumber <= pagination.totalPages) {
      if (onPageChange) {
        onPageChange(pageNumber);
      }
      setLocalPage(pageNumber);
    }
  }, [pagination.totalPages, onPageChange]);

  if (isError) {
    return (
      <Card className="p-4">
        <div className="text-center">
          <p className="text-red-500 mb-4">Error loading tickets: {(error as Error)?.message || 'Unknown error'}</p>
          <Button onClick={() => refetch()}>Try Again</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)] relative">
      <div className="flex justify-between items-center mb-4">
        <div className="flex-1 mr-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tickets..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        
        <div className="flex space-x-2">
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setLocalPage(1); // Reset to first page when changing status filter
            }}
            defaultValue="open"
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tickets</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Ticket content container */}
      <div className="pt-2 flex flex-col h-full">
        <div className="mb-2">
          <div className="text-sm font-medium">Tickets</div>
        </div>
        <div className="flex-1 overflow-auto mb-4">
          {isLoading ? (
            // Loading skeleton
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="p-4 border rounded-md">
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ))
          ) : tickets.length ? (
            // Ticket list with virtualized rendering for better performance
            <div className="space-y-2">
              {tickets.map((ticket) => (
                <TicketItem
                  key={ticket.id}
                  ticket={ticket as any /* Cast to avoid TypeScript errors */}
                  isSelected={selectedTicketId === ticket.id}
                  onSelect={() => {
                    console.log(`Ticket clicked: ${ticket.id}`);
                    handleSelectTicket(ticket.id);
                  }}
                  onStatusChange={() => onStatusChange ? onStatusChange() : null}
                />
              ))}
            </div>
          ) : (
            // Empty state
            <div className="text-center p-8 border border-dashed rounded-md">
              <Mail className="mx-auto h-12 w-12 text-muted-foreground mb-3" />
              <h3 className="text-lg font-medium mb-1">No tickets found</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {debouncedSearch
                  ? "No tickets match your search criteria"
                  : "Get started by creating your first ticket"}
              </p>
              <NewTicketDialog
                deskId={deskId}
                onSuccess={() => queryClient.invalidateQueries({ queryKey: ['/api/tickets'] })}
              >
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  New Ticket
                </Button>
              </NewTicketDialog>
            </div>
          )}
        </div>

        {/* Bottom row with pagination info and controls */}
        <div className="flex justify-between items-center mt-auto border-t pt-4 sticky bottom-0 bg-white">
          <div className="text-sm text-muted-foreground">
            {isLoading ? (
              <Skeleton className="h-4 w-32" />
            ) : (
              `Showing ${tickets.length} of ${pagination.totalItems} tickets (page ${pagination.currentPage} of ${pagination.totalPages || 1})`
            )}
          </div>
          
          {/* Pagination controls */}
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreviousPage}
              disabled={page === 1 || isLoading}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            
            <div className="flex items-center space-x-1">
              {/* Generate page buttons with ellipsis for large page counts */}
              {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                let pageNum;
                
                // Logic to show first, last, and pages around current
                if (pagination.totalPages <= 5) {
                  // If 5 or fewer pages, show all
                  pageNum = i + 1;
                } else if (page <= 3) {
                  // Near start
                  if (i < 4) {
                    pageNum = i + 1;
                  } else {
                    pageNum = pagination.totalPages;
                  }
                } else if (page >= pagination.totalPages - 2) {
                  // Near end
                  if (i === 0) {
                    pageNum = 1;
                  } else {
                    pageNum = pagination.totalPages - (4 - i);
                  }
                } else {
                  // Middle
                  if (i === 0) {
                    pageNum = 1;
                  } else if (i === 4) {
                    pageNum = pagination.totalPages;
                  } else {
                    pageNum = page + (i - 2);
                  }
                }
                
                // Show ellipsis instead of buttons for gaps
                if (
                  (pageNum > 2 && pageNum < page - 1) ||
                  (pageNum > page + 1 && pageNum < pagination.totalPages - 1)
                ) {
                  return <span key={i}>...</span>;
                }
                
                return (
                  <Button
                    key={i}
                    variant={pageNum === page ? 'default' : 'outline'}
                    size="sm"
                    className="w-8 h-8 p-0"
                    onClick={() => goToPage(pageNum)}
                    disabled={isLoading}
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={handleNextPage}
              disabled={page === pagination.totalPages || isLoading}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
