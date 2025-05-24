import * as React from 'react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Loader2, Server, Mail } from 'lucide-react';

// Schema for IMAP configuration
const imapConfigSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive().default(993),
  user: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  tls: z.boolean().default(true),
});

type ImapConfigValues = z.infer<typeof imapConfigSchema>;

interface ImapSetupDialogProps {
  children: React.ReactNode;
  onSuccess?: () => void;
}

export function ImapSetupDialog({ children, onSuccess }: ImapSetupDialogProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Default values for Gmail
  const defaultValues: Partial<ImapConfigValues> = {
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
  };

  // Setup form with validation
  const form = useForm<ImapConfigValues>({
    resolver: zodResolver(imapConfigSchema),
    defaultValues,
  });

  const onSubmit = async (data: ImapConfigValues) => {
    try {
      setIsSubmitting(true);
      console.log('Configuring IMAP with:', data);
      
      const response = await fetch('/api/email/imap/configure', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to configure IMAP');
      }
      
      // Test connection after configuring
      const testResponse = await fetch('/api/email/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ service: 'imap' }),
      });
      
      const testResult = await testResponse.json();
      
      if (testResponse.ok && testResult.success) {
        toast({
          title: 'IMAP configured successfully',
          description: 'Your email configuration is now set up and ready to fetch emails.',
        });
        
        // Start email polling
        await fetch('/api/email/polling', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'start', frequency: 300000 }), // Check every 5 minutes
        });
        
        // Refresh all ticket data
        queryClient.invalidateQueries({ queryKey: ['/api/tickets'] });
        
        if (onSuccess) {
          onSuccess();
        }
        
        setOpen(false);
      } else {
        throw new Error(testResult.error || 'Connection test failed');
      }
    } catch (error) {
      console.error('IMAP configuration error:', error);
      toast({
        title: 'Configuration failed',
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Configure Email Fetching</DialogTitle>
          <DialogDescription>
            Enter your IMAP server details to enable automatic email fetching.
            This is required for the "Fetch Emails Now" button to work.
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="host"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>IMAP Host</FormLabel>
                  <FormControl>
                    <Input placeholder="imap.gmail.com" {...field} />
                  </FormControl>
                  <FormDescription>
                    For Gmail, use imap.gmail.com
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="port"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Port</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="993" {...field} />
                  </FormControl>
                  <FormDescription>
                    Standard port is 993 for IMAP with TLS
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="user"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Username</FormLabel>
                  <FormControl>
                    <Input placeholder="your.email@gmail.com" {...field} />
                  </FormControl>
                  <FormDescription>
                    Usually your full email address
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password or App Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••••••••••" {...field} />
                  </FormControl>
                  <FormDescription>
                    For Gmail, use an App Password (not your regular password)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="tls"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Use TLS</FormLabel>
                    <FormDescription>
                      Enable secure connection (recommended)
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
            
            <DialogFooter className="pt-4">
              <Button 
                type="submit" 
                disabled={isSubmitting}
                className="w-full"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Configuring...
                  </>
                ) : (
                  <>
                    <Server className="mr-2 h-4 w-4" />
                    Save IMAP Configuration
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}