import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useState } from "react";
import { AlertCircle, Trash2 } from "lucide-react";

/**
 * Admin Page Component
 * 
 * This page provides administrative functions including the ability to
 * delete all tickets from the system.
 */
export default function AdminPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [isConfirming, setIsConfirming] = useState(false);

  // Mutation for deleting all tickets
  const cleanupTicketsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/admin/cleanup-tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete tickets');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "All tickets deleted",
        description: "All tickets and their messages have been successfully deleted from the system.",
      });
      // Invalidate tickets cache
      queryClient.invalidateQueries({ queryKey: ['/api/tickets'] });
      setIsConfirming(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error deleting tickets",
        description: `There was a problem deleting tickets: ${error.message}`,
        variant: "destructive",
      });
      setIsConfirming(false);
    }
  });

  const handleDeleteAllTickets = () => {
    // Show confirmation step first
    setIsConfirming(true);
  };

  const confirmDeleteAllTickets = () => {
    // Actually perform the deletion
    cleanupTicketsMutation.mutate();
  };

  const cancelDeleteAllTickets = () => {
    setIsConfirming(false);
  };

  return (
    <div className="container py-10">
      <h1 className="text-3xl font-bold mb-6">System Administration</h1>
      
      <Tabs defaultValue="data">
        <TabsList className="mb-6">
          <TabsTrigger value="data">Data Management</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
        </TabsList>
        
        <TabsContent value="data">
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-red-600">Danger Zone</CardTitle>
                <CardDescription>
                  These actions are irreversible. Please proceed with caution.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Alert variant="destructive" className="mb-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Warning</AlertTitle>
                  <AlertDescription>
                    Deleting all tickets will permanently remove them from the system.
                    This action cannot be undone. All ticket data and messages will be lost.
                  </AlertDescription>
                </Alert>

                {isConfirming ? (
                  <div className="bg-red-50 dark:bg-red-950 p-4 rounded-md border border-red-200 dark:border-red-800">
                    <p className="text-lg font-semibold mb-2">Are you absolutely sure?</p>
                    <p className="mb-4">
                      This will permanently delete <strong>all tickets</strong> from the database.
                      You cannot undo this action.
                    </p>
                    <div className="flex gap-2">
                      <Button 
                        variant="destructive" 
                        onClick={confirmDeleteAllTickets}
                        disabled={cleanupTicketsMutation.isPending}
                      >
                        {cleanupTicketsMutation.isPending ? "Deleting..." : "Yes, Delete Everything"}
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={cancelDeleteAllTickets}
                        disabled={cleanupTicketsMutation.isPending}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button 
                    variant="destructive" 
                    onClick={handleDeleteAllTickets}
                    className="gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete All Tickets
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        
        <TabsContent value="system">
          <Card>
            <CardHeader>
              <CardTitle>System Information</CardTitle>
            </CardHeader>
            <CardContent>
              <p>This section will contain system information and diagnostics.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}