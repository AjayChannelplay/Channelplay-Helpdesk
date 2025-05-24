import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { TicketItem } from '@/components/tickets/ticket-item';
import { NewTicketDialog } from '@/components/tickets/new-ticket-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Plus, Mail, MailX, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
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
}

export function TicketList({ deskId }: TicketListProps) {
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('updatedAt'); // Changed default to updatedAt
  const [sortOrder, setSortOrder] = useState('desc'); // Default to desc for newest first
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('all');

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const perPage = 15; // Reduced per page for better performance

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState(searchTerm);
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 500);
    
    return () => clearTimeout(timer);
  }, [searchTerm]);
  
  // API route changes based on filters
  const apiRoute = `/api/tickets?sortBy=${sortBy}&sortOrder=${sortOrder}&page=${page}&perPage=${perPage}${
    deskId ? `&deskId=${deskId}` : ''
  }${status !== 'all' ? `&status=${status}` : ''}${
    debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''
  }`;

  // React Query for data fetching with proper pagination
  const {
    data,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery<PaginatedResponse>({
    queryKey: [apiRoute],
    throwOnError: false,
    staleTime: 30000, // Keep data fresh for 30 seconds to reduce API calls
  });

  const tickets = data?.tickets || [];
  const pagination = data?.pagination || {
    totalItems: 0,
    totalPages: 0,
    currentPage: 1,
    perPage: perPage
  };

  // Handle "Check Emails" success
  const handleEmailCheckSuccess = (count: number) => {
    if (count > 0) {
      refetch();
    }
  };

  // Don't use automatic polling - we'll use manual refresh instead
  useEffect(() => {
    // Stop any continuous polling
    const stopPolling = async () => {
      try {
        await apiRequest('/api/email/polling', {
          method: 'POST',
          body: JSON.stringify({
            action: 'stop'
          })
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
        const response = await apiRequest('/api/email/polling', {
          method: 'POST',
          body: JSON.stringify({
            action: 'check_now'
          })
        });
        
        if (response.success && response.newEmails > 0) {
          refetch();
        }
      } catch (error) {
        console.error('Error checking emails on load:', error);
      }
    };
    
    // Only check emails on first load
    checkEmailsOnce();
  }, []);

  // Handle ticket selection
  const handleSelectTicket = (id: number) => {
    setLocation(`/tickets/${id}`);
  };

  // Pagination handlers
  const handlePreviousPage = useCallback(() => {
    if (page > 1) {
      setPage(page - 1);
    }
  }, [page]);

  const handleNextPage = useCallback(() => {
    if (page < pagination.totalPages) {
      setPage(page + 1);
    }
  }, [page, pagination.totalPages]);

  const goToPage = useCallback((pageNumber: number) => {
    if (pageNumber >= 1 && pageNumber <= pagination.totalPages) {
      setPage(pageNumber);
    }
  }, [pagination.totalPages]);

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
    <div className="flex flex-col h-full">
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
          
          <NewTicketDialog
            deskId={deskId}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['/api/tickets'] });
              toast({
                title: "Ticket Created",
                description: "New ticket has been created successfully"
              });
            }}
          >
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              New Ticket
            </Button>
          </NewTicketDialog>
        </div>
      </div>

      <div className="flex justify-between items-center mb-4">
        <Tabs
          defaultValue="all"
          className="w-full"
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(1); // Reset to first page when changing status filter
          }}
        >
          <TabsList>
            <TabsTrigger value="all">All Tickets</TabsTrigger>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="closed">Closed</TabsTrigger>
          </TabsList>
          
          <TabsContent value="all">
            <div className="pt-2">
              <div className="flex justify-between items-center mb-2">
                <div className="text-sm text-muted-foreground">
                  {isLoading ? (
                    <Skeleton className="h-4 w-20" />
                  ) : (
                    `Showing ${tickets.length} of ${pagination.totalItems} tickets (page ${pagination.currentPage} of ${pagination.totalPages || 1})`
                  )}
                </div>
                <div className="flex space-x-2">
                  <Select
                    value={sortBy}
                    onValueChange={(value) => {
                      setSortBy(value);
                      setPage(1); // Reset to first page when changing sort
                    }}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="updatedAt">Last Updated</SelectItem>
                      <SelectItem value="createdAt">Date Created</SelectItem>
                      <SelectItem value="subject">Subject</SelectItem>
                      <SelectItem value="priority">Priority</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={sortOrder}
                    onValueChange={(value) => {
                      setSortOrder(value);
                      setPage(1); // Reset to first page when changing order
                    }}
                  >
                    <SelectTrigger className="w-[120px]">
                      <SelectValue placeholder="Order" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="desc">Newest First</SelectItem>
                      <SelectItem value="asc">Oldest First</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
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
                  <div className="space-y-2 will-change-transform">
                    {tickets.map((ticket) => (
                      <TicketItem
                        key={ticket.id}
                        ticket={ticket}
                        onClick={() => handleSelectTicket(ticket.id)}
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

              {/* Pagination controls */}
              {pagination.totalPages > 1 && (
                <div className="flex justify-between items-center mt-4">
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
              )}
            </div>
          </TabsContent>
          
          <TabsContent value="open">
            {/* Similar content structure for open tickets */}
          </TabsContent>
          
          <TabsContent value="closed">
            {/* Similar content structure for closed tickets */}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}