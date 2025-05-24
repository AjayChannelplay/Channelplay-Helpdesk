import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Navbar from "@/components/layout/navbar";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarIcon, BarChart3, ChevronsRight, Clock, Trophy, Paperclip, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TestEmailDialog } from "@/components/ui/test-email-dialog";

import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRange } from "react-day-picker";

// Define the expected data structure from the statistics API
interface StatisticsData {
  nps: number;
  respondedTickets: number;
  avgResponseTime: number;
  responsesCount: number;
  avgResolutionTime: number;
  resolvedTicketsCount: number;
}



export default function HomePage() {
  const { toast } = useToast();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(new Date().getFullYear(), new Date().getMonth(), 1), // First day of current month
    to: new Date(), // Today
  });

  // Helper function to format date as YYYY-MM-DD for API
  const formatDateForApi = (date: Date | undefined) => {
    if (!date) return '';
    return format(date, "yyyy-MM-dd");
  };

  // Query for performance statistics
  const { data: statistics, isLoading: isLoadingStats } = useQuery<StatisticsData>({
    queryKey: [
      "/api/statistics", 
      formatDateForApi(dateRange?.from), 
      formatDateForApi(dateRange?.to)
    ],
    queryFn: async () => {
      if (!dateRange?.from || !dateRange?.to) {
        throw new Error("Date range not selected");
      }
      
      const params = new URLSearchParams({
        startDate: formatDateForApi(dateRange.from),
        endDate: formatDateForApi(dateRange.to)
      });
      
      const response = await fetch(`/api/statistics?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch statistics");
      }
      return response.json();
    }
  });

  // Format duration in hours, minutes
  const formatDuration = (hours: number) => {
    // The API returns values in hours with decimal points (e.g. 1.5 hours)
    if (hours === 0) {
      return "< 1 hr";
    }
    
    if (hours < 1) {
      // Convert to minutes for sub-hour durations
      const minutes = Math.round(hours * 60);
      return `${minutes} min`;
    }
    
    // For one hour or more, format hours and minutes
    const wholeHours = Math.floor(hours);
    const remainingMinutes = Math.round((hours - wholeHours) * 60);
    
    if (remainingMinutes === 0) {
      return `${wholeHours} hr`;
    }
    
    return `${wholeHours} hr ${remainingMinutes} min`;
  };

  // Format NPS score
  const formatNPS = (score: number) => {
    return Math.round(score);
  };

  // Determine the color for the NPS score based on its value
  const getNpsColorClass = (score: number) => {
    if (score >= 50) return "text-green-600";
    if (score >= 0) return "text-yellow-600";
    return "text-red-600";
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Navbar />
      
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
            <p className="text-slate-600 mt-1">
              Overview of your support performance metrics
            </p>
          </div>
          
          <div className="mt-4 md:mt-0">
            {/* Date Range Picker */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !dateRange && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, "LLL dd, y")} -{" "}
                        {format(dateRange.to, "LLL dd, y")}
                      </>
                    ) : (
                      format(dateRange.from, "LLL dd, y")
                    )
                  ) : (
                    <span>Pick a date range</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={(range) => {
                    if (range?.from && range?.to) {
                      setDateRange(range);
                    }
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-6 grid-cols-1 md:grid-cols-3">
          {/* NPS Score Card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-medium flex items-center">
                <Trophy className="mr-2 h-5 w-5 text-amber-500" />
                Net Promoter Score
              </CardTitle>
              <CardDescription>
                Based on customer satisfaction responses
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingStats ? (
                <div className="flex items-center space-x-4">
                  <Skeleton className="h-12 w-16" />
                  <Skeleton className="h-4 w-[200px]" />
                </div>
              ) : (
                <div className="flex items-baseline">
                  <span className={`text-4xl font-bold ${getNpsColorClass(statistics?.nps || 0)}`}>
                    {statistics ? formatNPS(statistics.nps) : "N/A"}
                  </span>
                  <span className="ml-2 text-slate-500 text-sm">/ 100</span>
                </div>
              )}
              <p className="text-sm text-slate-500 mt-2">
                {isLoadingStats ? (
                  <Skeleton className="h-4 w-[180px]" />
                ) : (
                  `From ${statistics?.respondedTickets || 0} customer responses`
                )}
              </p>
            </CardContent>
            {/* CardFooter removed as requested */}
          </Card>
          
          {/* Response Time Card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-medium flex items-center">
                <Clock className="mr-2 h-5 w-5 text-blue-500" />
                Avg. Response Time
              </CardTitle>
              <CardDescription>
                During business hours (9am-5pm, Mon-Fri)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingStats ? (
                <div className="flex items-center space-x-4">
                  <Skeleton className="h-12 w-24" />
                  <Skeleton className="h-4 w-[180px]" />
                </div>
              ) : (
                <div className="flex items-baseline">
                  <span className="text-4xl font-bold text-slate-900">
                    {statistics ? formatDuration(statistics.avgResponseTime) : "N/A"}
                  </span>
                </div>
              )}
              <p className="text-sm text-slate-500 mt-2">
                {isLoadingStats ? (
                  <Skeleton className="h-4 w-[180px]" />
                ) : (
                  `From ${statistics?.responsesCount || 0} agent responses`
                )}
              </p>
            </CardContent>
            {/* CardFooter removed as requested */}
          </Card>
          
          {/* Resolution Time Card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-medium flex items-center">
                <BarChart3 className="mr-2 h-5 w-5 text-green-500" />
                Avg. Resolution Time
              </CardTitle>
              <CardDescription>
                For tickets closed in selected period
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingStats ? (
                <div className="flex items-center space-x-4">
                  <Skeleton className="h-12 w-24" />
                  <Skeleton className="h-4 w-[180px]" />
                </div>
              ) : (
                <div className="flex items-baseline">
                  <span className="text-4xl font-bold text-slate-900">
                    {statistics ? formatDuration(statistics.avgResolutionTime) : "N/A"}
                  </span>
                </div>
              )}
              <p className="text-sm text-slate-500 mt-2">
                {isLoadingStats ? (
                  <Skeleton className="h-4 w-[180px]" />
                ) : (
                  `From ${statistics?.resolvedTicketsCount || 0} resolved tickets`
                )}
              </p>
            </CardContent>
            {/* CardFooter removed as requested */}
          </Card>
        </div>



        {/* Quick Links or Additional Information */}
        <div className="mt-8">
          <h2 className="text-xl font-semibold text-slate-800 mb-4">Quick Actions</h2>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            <Link href="/tickets">
              <Button variant="outline" className="w-full justify-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                View All Tickets
              </Button>
            </Link>
            <Link href="/tickets">
              <Button variant="outline" className="w-full justify-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                Create New Ticket
              </Button>
            </Link>
            <Link href="/users">
              <Button variant="outline" className="w-full justify-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                Manage Users
              </Button>
            </Link>
            <Link href="/email-settings">
              <Button variant="outline" className="w-full justify-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                Email Settings
              </Button>
            </Link>
            <div className="w-full">
              <TestEmailDialog />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}