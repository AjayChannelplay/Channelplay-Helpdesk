import { useState, useEffect } from 'react';
import { useLocation, Link } from 'wouter';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

export default function ExternalAccessPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState<string>('Authenticating...');

  useEffect(() => {
    const authenticate = async () => {
      const params = new URLSearchParams(window.location.search);
      const encryptedEmail = params.get('email');
      
      if (!encryptedEmail) {
        setStatus('error');
        setMessage('No encrypted email provided');
        return;
      }

      try {
        // Call the API endpoint with the encrypted email as query parameter
        const response = await apiRequest(
          'GET', 
          `/api/external-access?email=${encodeURIComponent(encryptedEmail)}`
        );
        
        const data = await response.json();
        
        if (response.ok && data.success) {
          setStatus('success');
          setMessage('Authentication successful. Redirecting to your tickets...');
          
          // Show success toast
          toast({
            title: 'Authentication successful',
            description: 'Welcome to ChannelPlay Support',
          });
          
          // Redirect to tickets page after a short delay
          setTimeout(() => {
            setLocation(data.redirectUrl || '/tickets');
          }, 1500);
        } else {
          setStatus('error');
          setMessage(data.message || 'Authentication failed');
          
          // Show error toast
          toast({
            title: 'Authentication failed',
            description: data.message || 'Please try again or contact support',
            variant: 'destructive',
          });
        }
      } catch (error) {
        console.error('External access error:', error);
        setStatus('error');
        setMessage('Failed to authenticate. Please try again or contact support.');
        
        toast({
          title: 'Authentication error',
          description: 'An unexpected error occurred',
          variant: 'destructive',
        });
      }
    };

    authenticate();
  }, [setLocation, toast]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <Card className="w-full max-w-md mx-auto">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center text-center p-6">
            <div className="mb-6">
              {status === 'loading' && (
                <Loader2 className="h-16 w-16 text-primary animate-spin" />
              )}
              {status === 'success' && (
                <CheckCircle2 className="h-16 w-16 text-green-500" />
              )}
              {status === 'error' && (
                <AlertCircle className="h-16 w-16 text-red-500" />
              )}
            </div>
            
            <h2 className="text-2xl font-bold mb-2">
              {status === 'loading' && 'Authenticating...'}
              {status === 'success' && 'Authentication Successful'}
              {status === 'error' && 'Authentication Failed'}
            </h2>
            
            <p className="text-gray-600 mb-6">{message}</p>
            
            {status === 'error' && (
              <div className="flex flex-col space-y-4 w-full">
                <Button asChild variant="outline">
                  <Link href="/auth">
                    Go to Login
                  </Link>
                </Button>
                
                <Button variant="link" asChild>
                  <a href="mailto:help@channelplay.in">
                    Contact Support
                  </a>
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}