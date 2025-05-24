import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Mail } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface FetchEmailsButtonProps {
  onSuccess?: () => void;
  className?: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'link' | 'destructive';
}

/**
 * A button to manually trigger an immediate email fetch using the configured IMAP credentials
 * This ensures emails are captured immediately when the user wants to check for new messages
 */
export function FetchEmailsButton({ 
  onSuccess, 
  className = '', 
  variant = 'default' 
}: FetchEmailsButtonProps) {
  const [isFetching, setIsFetching] = useState(false);
  const { toast } = useToast();

  const fetchEmails = async () => {
    setIsFetching(true);
    
    try {
      const response = await apiRequest('/api/emails/fetch-now', {
        method: 'POST'
      });
      
      if (response.success) {
        toast({
          title: 'Fetching emails complete',
          description: 'Successfully checked for new emails',
          variant: 'default',
        });
        
        if (onSuccess) {
          onSuccess();
        }
      } else {
        toast({
          title: 'Failed to fetch emails',
          description: response.message || 'An error occurred while fetching emails',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error fetching emails:', error);
      toast({
        title: 'Error fetching emails',
        description: 'There was a problem communicating with the email server',
        variant: 'destructive',
      });
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <Button
      variant={variant}
      className={className}
      onClick={fetchEmails}
      disabled={isFetching}
    >
      {isFetching ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Fetching...
        </>
      ) : (
        <>
          <Mail className="mr-2 h-4 w-4" />
          Fetch Emails Now
        </>
      )}
    </Button>
  );
}