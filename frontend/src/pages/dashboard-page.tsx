import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import Navbar from "@/components/layout/navbar";
import { TicketList } from "@/components/tickets/ticket-list";
import ConversationView from "@/components/tickets/conversation-view";
import NewTicketForm from "@/components/tickets/new-ticket-form";
import TestTools from "@/components/tickets/test-tools";
import { Button } from "@/components/ui/button";

import { 
  Dialog, 
  DialogContent, 
  DialogDescription,
  DialogHeader,
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlusCircle, RefreshCw, Clock, SortAsc, SortDesc, ListFilter, Inbox, User as UserIcon } from "lucide-react";
import { Ticket, Desk } from "@shared/schema";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default function DashboardPage() {
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [isMobileView, setIsMobileView] = useState<boolean>(window.innerWidth < 768);
  const [showMobileConversation, setShowMobileConversation] = useState<boolean>(false);
  const [newTicketOpen, setNewTicketOpen] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<string>("createdAt");
  const [sortOrder, setSortOrder] = useState<string>("desc");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  // Default to null, will be set to the Default desk (id=1) once user desks are loaded
  const [deskFilter, setDeskFilter] = useState<number | null>(null);
  // Filter for assigned tickets: "all", "assigned", "unassigned", or a specific user ID
  const [assignmentFilter, setAssignmentFilter] = useState<string>("all");
  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [perPage] = useState<number>(25);
  
  // Fetch user's desks
  const { data: userDesks = [] } = useQuery<Desk[]>({
    queryKey: ["/api/user/desks"],
    queryFn: async () => {
      const response = await fetch("/api/user/desks");
      if (!response.ok) throw new Error("Failed to fetch user desks");
      return response.json();
    }
  });
  
  // Fetch users for assignment filter
  const { data: users = [] } = useQuery({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const response = await fetch("/api/users");
      if (!response.ok) throw new Error("Failed to fetch users");
      return response.json();
    }
  });
  
  // Fetch tickets with server-side sorting, filtering and pagination
  const { 
    data: ticketsData = { tickets: [], pagination: { total: 0, page: 1, perPage, totalPages: 1 } }, 
    isLoading: isLoadingTickets,
    isError: isTicketsError,
    refetch: refetchTickets
  } = useQuery({
    queryKey: ["/api/tickets", sortBy, sortOrder, statusFilter, deskFilter, assignmentFilter, currentPage, perPage],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (sortBy) params.append("sortBy", sortBy);
      if (sortOrder) params.append("sortOrder", sortOrder);
      if (statusFilter) params.append("status", statusFilter);
      if (deskFilter) params.append("deskId", String(deskFilter));
      
      // Add pagination parameters
      params.append("page", String(currentPage));
      params.append("perPage", String(perPage));
      
      // Handle assignment filtering
      if (assignmentFilter !== 'all') {
        if (assignmentFilter === 'assigned') {
          params.append("isAssigned", "true");
        } else if (assignmentFilter === 'unassigned') {
          params.append("isAssigned", "false");
        } else {
          params.append("assignedUserId", assignmentFilter);
        }
      }
      
      const response = await fetch(`/api/tickets?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch tickets");
      const data = await response.json();
      
      // If the API doesn't return a paginated response format yet, convert it
      if (Array.isArray(data)) {
        return {
          tickets: data,
          pagination: {
            total: data.length,
            page: currentPage,
            perPage,
            totalPages: Math.ceil(data.length / perPage) || 1
          }
        };
      }
      
      return data;
    },
    refetchInterval: 30000, // Auto refresh every 30 seconds
  });
  
  // Extract the tickets array and pagination info from the response
  const tickets = Array.isArray(ticketsData) ? ticketsData : (ticketsData.tickets || ticketsData.data || []);
  
  // Make sure we always have a valid pagination object even if API response format changes
  const paginationInfo = Array.isArray(ticketsData) 
    ? { total: tickets.length, page: currentPage, perPage, totalPages: Math.ceil(tickets.length / perPage) || 1 }
    : (ticketsData.pagination || {
        total: tickets.length,
        page: currentPage,
        perPage,
        totalPages: Math.ceil(tickets.length / perPage) || 1
      });
  
  const handleTicketSelect = (ticketId: number) => {
    setSelectedTicketId(ticketId);
    
    // Show conversation on mobile
    if (window.innerWidth < 768) {
      setShowMobileConversation(true);
    }
  };
  
  const handleBackToList = () => {
    setShowMobileConversation(false);
  };
  
  const handleNewTicketSuccess = () => {
    setNewTicketOpen(false);
    refetchTickets();
  };
  
  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await refetchTickets();
    setTimeout(() => setIsRefreshing(false), 500);
  };
  
  // Effect to set default desk filter to the default desk (id=1) when user desks are loaded
  useEffect(() => {
    if (userDesks.length > 0) {
      // Find the default desk (usually postmaster with ID=1)
      const defaultDesk = userDesks.find(desk => desk.isDefault) || userDesks.find(desk => desk.email.includes('postmaster'));
      if (defaultDesk && deskFilter === null) {
        setDeskFilter(defaultDesk.id);
      }
    }
  }, [userDesks, deskFilter]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      const isMobile = window.innerWidth < 768;
      setIsMobileView(isMobile);
      
      // Reset mobile view states when switching to desktop
      if (!isMobile) {
        setShowMobileConversation(false);
      }
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Navbar />
      
      {/* Action Button Bar */}
      <div className="w-full bg-white border-b border-slate-200 py-2">
        <div className="w-full px-2 sm:px-6 lg:px-8">
          <div className="flex flex-wrap justify-between items-center">
            {/* Tickets heading on the far left */}
            <div className="flex items-center flex-wrap gap-2 mb-2 md:mb-0">
              <h2 className="text-xl font-bold text-slate-800">Tickets</h2>
              {deskFilter && (
                <span className="text-sm font-medium bg-slate-100 px-2 py-1 rounded-md text-slate-600 truncate max-w-[180px] sm:max-w-[240px] lg:max-w-[320px]">
                  {userDesks.find((desk: Desk) => desk.id === deskFilter)?.name || ""}
                  <span className="hidden sm:inline-block">
                    {userDesks.find((desk: Desk) => desk.id === deskFilter)?.email ? 
                      ` (${userDesks.find((desk: Desk) => desk.id === deskFilter)?.email})` : ""}
                  </span>
                </span>
              )}
            </div>
            
            {/* Action buttons on the right */}
            <div className="flex flex-wrap items-center gap-2 justify-end w-full md:w-auto">
              {/* Sort Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-9 px-2 sm:px-3">
                    <Clock className="h-4 w-4 sm:mr-1" />
                    <SortAsc className="h-4 w-4 hidden sm:inline-block sm:mr-1" />
                    <span className="hidden sm:inline-block">Sort</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => { setSortBy("createdAt"); setSortOrder("desc"); }}>
                    <Clock className="h-4 w-4 mr-2 text-slate-500" />
                    Newest First
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setSortBy("createdAt"); setSortOrder("asc"); }}>
                    <Clock className="h-4 w-4 mr-2 text-slate-500" />
                    Oldest First
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => { setSortBy("subject"); setSortOrder("asc"); }}>
                    Subject (A-Z)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setSortBy("subject"); setSortOrder("desc"); }}>
                    Subject (Z-A)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              
              {/* Desk Filter Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-9 px-2 sm:px-3">
                    <Inbox className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline-block truncate max-w-[80px] sm:max-w-[100px] md:max-w-[120px] lg:max-w-[150px]">
                      {userDesks.find((desk: Desk) => desk.id === deskFilter)?.name || "All Desks"}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Filter by Desk</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setDeskFilter(null)}>
                    All Desks
                  </DropdownMenuItem>
                  {userDesks.map((desk: Desk) => (
                    <DropdownMenuItem key={desk.id} onClick={() => setDeskFilter(desk.id)}>
                      {desk.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              

              
              {/* Assignment Filter Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-9 px-2 sm:px-3">
                    <UserIcon className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline-block">
                      {assignmentFilter === 'all' ? 'All Agents' : 
                       assignmentFilter === 'assigned' ? 'Assigned' : 
                       assignmentFilter === 'unassigned' ? 'Unassigned' : 
                       users.find((u: { id: number, name: string }) => u.id.toString() === assignmentFilter)?.name || 'Agent'}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Filter by Assignment</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setAssignmentFilter('all')}>
                    All Agents
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setAssignmentFilter('assigned')}>
                    Assigned Tickets
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setAssignmentFilter('unassigned')}>
                    Unassigned Tickets
                  </DropdownMenuItem>
                  {users.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Assigned To</DropdownMenuLabel>
                      {users.map((user: { id: number, name: string }) => (
                        <DropdownMenuItem key={user.id} onClick={() => setAssignmentFilter(user.id.toString())}>
                          <Avatar className="h-5 w-5 mr-2">
                            <AvatarFallback className="text-[8px]">
                              {user.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().substring(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          {user.name}
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              
              <Button 
                size="sm" 
                variant="outline" 
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                className="h-9 px-2 sm:px-3"
              >
                <RefreshCw className={`h-4 w-4 sm:mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline-block">Sync</span>
              </Button>
              
              <Dialog open={newTicketOpen} onOpenChange={setNewTicketOpen}>
                <DialogTrigger asChild>
                  <Button 
                    size="sm" 
                    className="h-9 px-2 sm:px-3 bg-green-600 hover:bg-green-700 text-white"
                  >
                    <PlusCircle className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline-block">New Ticket</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>Create New Ticket</DialogTitle>
                    <DialogDescription>
                      Create a new support ticket and optionally send a confirmation email.
                    </DialogDescription>
                  </DialogHeader>
                  <NewTicketForm onSuccess={handleNewTicketSuccess} selectedDeskId={deskFilter} />
                </DialogContent>
              </Dialog>
              
              {/* Add Email Test Tools - Temporarily commented out */}
              {/* <TestTools tickets={tickets} onSuccess={() => refetchTickets()} /> */}
            </div>
          </div>
        </div>
      </div>
      
      <main className="flex-1 w-full flex flex-col md:flex-row md:space-x-0 pt-4 sm:pt-6 px-2 sm:px-6 lg:px-8">
        {/* Left Panel - Tickets List (25% width) */}
        <div 
          className={`w-full md:w-1/4 lg:w-1/4 md:flex-shrink-0 mb-4 md:mb-0 pr-4 ${
            isMobileView && showMobileConversation ? 'hidden' : 'block'
          }`}
        >
          <TicketList 
            tickets={tickets}
            isLoading={isLoadingTickets}
            isError={isTicketsError}
            selectedTicketId={selectedTicketId}
            onSelectTicket={handleTicketSelect}
            onStatusChange={() => refetchTickets()}
            selectedDesk={deskFilter ? userDesks.find((desk: Desk) => desk.id === deskFilter) || null : null}
            pagination={paginationInfo}
            onPageChange={(page) => setCurrentPage(page)}
          />
        </div>
        
        {/* Middle Panel - Conversation View (50% width) */}
        <div 
          className={`w-full md:w-2/4 lg:w-2/4 ${
            isMobileView && !showMobileConversation ? 'hidden' : 'block'
          }`}
        >
          <ConversationView
            ticketId={selectedTicketId}
            onBackClick={handleBackToList}
            onReplySuccess={() => refetchTickets()}
            isMobileView={isMobileView}
          />
        </div>
        
        {/* Right Panel - Analytics Panel (25% width) */}
        <div className="hidden md:block md:w-1/4 lg:w-1/4 pl-4">
          <div className="bg-white rounded-lg shadow-sm p-4 h-[calc(100vh-10rem)] overflow-y-auto">
            <div className="border-b border-slate-200 pb-3 mb-4">
              <h3 className="text-lg font-medium text-slate-800">Ticket Analytics</h3>
              <p className="text-xs text-slate-500 mt-1">
                Insights and information about the current ticket
              </p>
            </div>
            
            {selectedTicketId ? (
              <div className="space-y-4">
                <div className="bg-slate-50 p-3 rounded-md border border-slate-200">
                  <h4 className="text-sm font-medium text-slate-700 mb-2">Response Time</h4>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500">Analytics data will be shown here</span>
                  </div>
                </div>
                
                <div className="bg-slate-50 p-3 rounded-md border border-slate-200">
                  <h4 className="text-sm font-medium text-slate-700 mb-2">Similar Tickets</h4>
                  <div className="space-y-2">
                    <span className="text-xs text-slate-500">Similar ticket suggestions will appear here</span>
                  </div>
                </div>
                
                <div className="bg-slate-50 p-3 rounded-md border border-slate-200">
                  <h4 className="text-sm font-medium text-slate-700 mb-2">Customer History</h4>
                  <div className="space-y-2">
                    <span className="text-xs text-slate-500">Customer interaction history will be shown here</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-slate-500">
                <p className="text-sm">Select a ticket to view analytics</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}