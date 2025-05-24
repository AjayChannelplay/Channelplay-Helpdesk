import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

/**
 * Check Emails Button Component
 * 
 * This component provides a button to manually check for new emails
 * instead of relying on continuous polling.
 */
export function CheckEmailsButton({ 
  onSuccess,
  variant = "secondary",
  size = "sm"
}: { 
  onSuccess?: (count: number) => void;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}) {
  const [isChecking, setIsChecking] = useState(false);
  const { toast } = useToast();

  const checkEmails = async () => {
    setIsChecking(true);
    
    try {
      const response = await apiRequest('/api/email/polling', {
        method: 'POST',
        body: JSON.stringify({
          action: 'check_now'
        })
      });
      
      if (response.success) {
        const message = response.newEmails > 0 
          ? `Found ${response.newEmails} new email${response.newEmails === 1 ? '' : 's'}`
          : 'No new emails found';
        
        toast({
          title: "Email Check Complete",
          description: message,
          variant: response.newEmails > 0 ? "default" : "secondary",
        });
        
        if (onSuccess) {
          onSuccess(response.newEmails);
        }
      } else {
        toast({
          title: "Email Check Failed",
          description: response.error || "Unknown error",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error checking emails:', error);
      toast({
        title: "Email Check Failed",
        description: "Could not connect to email service",
        variant: "destructive",
      });
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={checkEmails}
      disabled={isChecking}
      title="Check for new emails now"
    >
      {isChecking ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Checking...
        </>
      ) : (
        <>
          <RefreshCw className="mr-2 h-4 w-4" />
          Check Emails
        </>
      )}
    </Button>
  );
}