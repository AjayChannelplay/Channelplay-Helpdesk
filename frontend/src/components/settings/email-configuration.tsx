import * as React from 'react';
import { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Copy, Info, CheckCircle, Mail, Mailbox, ExternalLink, Server } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Alert, AlertDescription } from '@/components/ui/alert';

// Define schema for email configuration form
const emailConfigSchema = z.object({
  deskId: z.number(),
  name: z.string().min(1, "Support email name is required"),
  emailAlias: z.string().min(1, "Email alias is required").email("Must be a valid email"),
  enableForwarding: z.boolean().optional().default(true)
});

type EmailConfigFormValues = z.infer<typeof emailConfigSchema>;

interface EmailConfigurationProps {
  deskId?: number;
}

export default function EmailConfiguration({ deskId }: EmailConfigurationProps) {
  const { toast } = useToast();
  const [selectedDeskId, setSelectedDeskId] = useState<number | undefined>(deskId);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [activeAccordion, setActiveAccordion] = useState<string | null>("incoming");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Define desk interface
  interface Desk {
    id: number;
    name: string;
    email: string;
    isDefault?: boolean;
  }

  // Get all desks
  const { data: desks, isLoading: isLoadingDesks } = useQuery<Desk[]>({
    queryKey: ["/api/desks"],
    enabled: !deskId // Only fetch all desks if no specific desk ID is provided
  });

  // Get current desk data
  const { data: currentDesk, isLoading: isLoadingDesk } = useQuery<Desk>({
    queryKey: ["/api/desks", selectedDeskId],
    enabled: !!selectedDeskId
  });

  const form = useForm<EmailConfigFormValues>({
    resolver: zodResolver(emailConfigSchema),
    defaultValues: {
      deskId: selectedDeskId || 0,
      name: "",
      emailAlias: ""
    },
  });

  // Update form when desk data is loaded
  useEffect(() => {
    if (currentDesk) {
      form.reset({
        deskId: currentDesk.id,
        name: currentDesk.name || "",
        emailAlias: currentDesk.email || "",
        enableForwarding: true
      });
    }
  }, [currentDesk, form]);

  // When desk selection changes
  useEffect(() => {
    if (selectedDeskId) {
      form.setValue("deskId", selectedDeskId);
    }
  }, [selectedDeskId, form]);

  // Update desk mutation
  const updateMutation = useMutation({
    mutationFn: async (data: EmailConfigFormValues) => {
      console.log("Submitting form data:", data);
      const formattedData = {
        name: data.name,
        email: data.emailAlias
      };
      console.log("Formatted data for API:", formattedData);
      
      try {
        // Use the correct URL structure
        const url = `/api/desks/${data.deskId}`;
        console.log("Making PATCH request to:", url);
        
        const response = await fetch(`${window.location.origin}${url}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(formattedData),
          credentials: 'include'
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          console.error("API error:", errorData);
          throw new Error(errorData.message || 'Failed to update desk');
        }
        
        const result = await response.json();
        console.log("API response:", result);
        return result;
      } catch (error) {
        console.error("Request error:", error);
        throw error;
      }
    },
    onSuccess: (data) => {
      console.log("Mutation succeeded with data:", data);
      queryClient.invalidateQueries({ queryKey: ["/api/desks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/desks", selectedDeskId] });
      toast({
        title: "Email configuration updated",
        description: "Your support email settings have been updated successfully.",
      });
    },
    onError: (error: Error) => {
      console.error("Mutation failed with error:", error);
      toast({
        title: "Update failed",
        description: error.message || 'An unexpected error occurred',
        variant: "destructive",
      });
    },
  });

  // Handle form submission directly without using the mutation
  const onSubmit = async (data: EmailConfigFormValues) => {
    try {
      console.log("Submitting form data:", data);
      const formattedData = {
        name: data.name,
        email: data.emailAlias,
        enableForwarding: data.enableForwarding
      };
      console.log("Formatted data for API:", formattedData);
      
      // Show loading state
      setIsSubmitting(true);
      
      // Use the correct URL structure
      const url = `/api/desks/${data.deskId}`;
      console.log("Making PATCH request to:", url);
      
      const response = await fetch(`${window.location.origin}${url}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formattedData),
        credentials: 'include'
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error("API error:", errorData);
        throw new Error(errorData.message || 'Failed to update desk');
      }
      
      const result = await response.json();
      console.log("API response:", result);
      
      // Update the cache manually
      queryClient.invalidateQueries({ queryKey: ["/api/desks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/desks", selectedDeskId] });
      
      // Show success message
      toast({
        title: "Email configuration updated",
        description: data.enableForwarding 
          ? "Your support email settings have been updated successfully and email forwarding has been enabled." 
          : "Your support email settings have been updated successfully.",
      });
    } catch (error) {
      console.error("Submission error:", error);
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Generate the forwarding address
  const getForwardingAddress = () => {
    if (!currentDesk?.email) return "";
    
    // Extract email name without domain if it has one
    const emailName = currentDesk.email.includes('@') 
      ? currentDesk.email.split('@')[0] 
      : currentDesk.email;
    
    return `${emailName}@helpdesk.1office.in`;
  };

  // Handle copy to clipboard
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedText(text);
      setTimeout(() => setCopiedText(null), 2000);
    });
  };

  const forwardingAddress = getForwardingAddress();

  // Loading state
  if ((isLoadingDesks && !deskId) || (isLoadingDesk && !!selectedDeskId)) {
    return (
      <div className="flex justify-center items-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Edit support email</CardTitle>
          <CardDescription>
            Configure your email to start receiving them as tickets in the system, whether by setting up your own server
            to host your emails or by utilizing our email server.
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Desk selection - only show if no deskId was provided */}
              {!deskId && desks && desks.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="desk-select">Select desk</Label>
                  <Select 
                    onValueChange={(value) => {
                      // Ensure value isn't "default" and can be parsed as a number
                      if (value !== 'default') {
                        const parsedId = parseInt(value);
                        if (!isNaN(parsedId)) setSelectedDeskId(parsedId);
                      }
                    }} 
                    defaultValue={selectedDeskId?.toString() || "default"}
                  >
                    <SelectTrigger id="desk-select">
                      <SelectValue placeholder="Select a desk" />
                    </SelectTrigger>
                    <SelectContent>
                      {desks && desks.map((desk) => (
                        <SelectItem key={desk.id} value={desk.id.toString()}>
                          {desk.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              
              {selectedDeskId && (
                <>
                  {/* Support email name */}
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Support email name</FormLabel>
                        <FormControl>
                          <Input placeholder="Customer Support" {...field} />
                        </FormControl>
                        <FormDescription>
                          This name will be displayed as the sender name in emails.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Email alias */}
                  <FormField
                    control={form.control}
                    name="emailAlias"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Add your email alias <span className="text-red-500">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="help@channelplay.in" {...field} />
                        </FormControl>
                        <FormDescription>
                          This will be your reply-to email address. To display help@channelplay.in in the UI, enter it here.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Enable email forwarding checkbox */}
                  <FormField
                    control={form.control}
                    name="enableForwarding"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>
                            Enable email forwarding
                          </FormLabel>
                          <FormDescription>
                            Automatically forward emails to the help desk address
                          </FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />

                  <div className="pt-4">
                    <Button 
                      type="submit" 
                      disabled={isSubmitting}
                      className="mr-2"
                    >
                      {isSubmitting && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Save changes
                    </Button>
                  </div>
                </>
              )}
            </form>
          </Form>
        </CardContent>
      </Card>

      {selectedDeskId && currentDesk && (
        <Card>
          <CardHeader>
            <CardTitle>Email server</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion 
              type="single" 
              collapsible 
              className="w-full" 
              value={activeAccordion || undefined}
              onValueChange={(value) => setActiveAccordion(value)}
            >
              <AccordionItem value="incoming" className="border rounded-md mb-4 overflow-hidden">
                <AccordionTrigger className="py-4 px-6 bg-gray-50 hover:bg-gray-100">
                  <div className="flex items-center text-left">
                    <span className="font-medium">Incoming email system</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-6 py-4 border-t border-gray-200">
                  <div className="flex items-center justify-between py-4">
                    <div className="flex items-center">
                      <div className="h-8 w-8 mr-3 bg-gradient-to-r from-blue-400 to-blue-600 rounded-full flex items-center justify-center">
                        <Mail className="h-4 w-4 text-white" />
                      </div>
                      <div>Mailgun mail server</div>
                    </div>
                    <Button variant="outline" size="sm" disabled className="text-blue-600">
                      Current server
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="outgoing" className="border rounded-md mb-4 overflow-hidden">
                <AccordionTrigger className="py-4 px-6 bg-gray-50 hover:bg-gray-100">
                  <div className="flex items-center text-left">
                    <span className="font-medium">Outgoing email system</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-6 py-4 border-t border-gray-200">
                  <div className="flex items-center justify-between py-4">
                    <div className="flex items-center">
                      <div className="h-8 w-8 mr-3 bg-gradient-to-r from-blue-400 to-blue-600 rounded-full flex items-center justify-center">
                        <Server className="h-4 w-4 text-white" />
                      </div>
                      <div>Mailgun SMTP server</div>
                    </div>
                    <Button variant="outline" size="sm" disabled className="text-blue-600">
                      Current server
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
              
              <AccordionItem value="imap" className="border rounded-md mb-4 overflow-hidden">
                <AccordionTrigger className="py-4 px-6 bg-gray-50 hover:bg-gray-100">
                  <div className="flex items-center text-left">
                    <span className="font-medium">IMAP Configuration (For Email Fetch)</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-6 py-4 border-t border-gray-200">
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="imap_host">IMAP Host</Label>
                        <Input 
                          id="imap_host" 
                          placeholder="imap.gmail.com" 
                          defaultValue={currentDesk?.imap_host || ''}
                          onChange={(e) => {
                            // Update desk IMAP settings
                            if (selectedDeskId) {
                              fetch(`/api/desks/${selectedDeskId}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ imap_host: e.target.value })
                              });
                            }
                          }}
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="imap_port">IMAP Port</Label>
                        <Input 
                          id="imap_port" 
                          placeholder="993" 
                          type="number"
                          defaultValue={currentDesk?.imap_port || 993}
                          onChange={(e) => {
                            // Update desk IMAP settings
                            if (selectedDeskId) {
                              fetch(`/api/desks/${selectedDeskId}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ imap_port: parseInt(e.target.value) })
                              });
                            }
                          }}
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="imap_user">IMAP Username</Label>
                        <Input 
                          id="imap_user" 
                          placeholder="your.email@gmail.com" 
                          defaultValue={currentDesk?.imap_user || ''}
                          onChange={(e) => {
                            // Update desk IMAP settings
                            if (selectedDeskId) {
                              fetch(`/api/desks/${selectedDeskId}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ imap_user: e.target.value })
                              });
                            }
                          }}
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="imap_password">IMAP Password</Label>
                        <Input 
                          id="imap_password" 
                          type="password"
                          placeholder="••••••••••••" 
                          defaultValue={currentDesk?.imap_password || ''}
                          onChange={(e) => {
                            // Update desk IMAP settings
                            if (selectedDeskId) {
                              fetch(`/api/desks/${selectedDeskId}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ imap_password: e.target.value })
                              });
                            }
                          }}
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="imap_mailbox">IMAP Mailbox</Label>
                        <Input 
                          id="imap_mailbox" 
                          placeholder="INBOX" 
                          defaultValue={currentDesk?.imap_mailbox || 'INBOX'}
                          onChange={(e) => {
                            // Update desk IMAP settings
                            if (selectedDeskId) {
                              fetch(`/api/desks/${selectedDeskId}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ imap_mailbox: e.target.value })
                              });
                            }
                          }}
                        />
                      </div>
                      
                      <div className="flex items-center space-x-2 pt-2">
                        <Checkbox 
                          id="imap_tls" 
                          defaultChecked={currentDesk?.imap_tls !== false}
                          onCheckedChange={(checked) => {
                            // Update desk IMAP settings
                            if (selectedDeskId) {
                              fetch(`/api/desks/${selectedDeskId}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ imap_tls: checked })
                              });
                            }
                          }}
                        />
                        <Label htmlFor="imap_tls">Use TLS</Label>
                      </div>
                    </div>
                    
                    <div className="pt-4">
                      <Button 
                        type="button"
                        onClick={async () => {
                          try {
                            // Test IMAP connection
                            const response = await fetch('/api/email/test-connection', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ 
                                deskId: selectedDeskId,
                                type: 'imap'
                              })
                            });
                            
                            const result = await response.json();
                            
                            if (result.success) {
                              toast({
                                title: "Connection successful",
                                description: "IMAP connection test was successful",
                              });
                            } else {
                              toast({
                                title: "Connection failed",
                                description: result.error || "IMAP connection test failed",
                                variant: "destructive",
                              });
                            }
                          } catch (error) {
                            toast({
                              title: "Connection test failed",
                              description: "Could not test IMAP connection",
                              variant: "destructive",
                            });
                          }
                        }}
                      >
                        Test IMAP Connection
                      </Button>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <div className="mb-6 mt-2">
                <div className="flex items-center mb-2">
                  <h3 className="text-lg font-medium">Set up forwarding</h3>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-4 w-4 text-muted-foreground ml-2" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">Optional: Configure this if you want to forward emails from your existing mailbox to our system.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
  
                <div className="border rounded-md divide-y">
                  <div className="p-4">
                    <div className="font-medium mb-2">Step 1: Copy your forwarding address below.</div>
                    <div className="flex items-center">
                      <div className="flex-1 border border-gray-300 rounded-l-md p-2 bg-gray-50 truncate">
                        {forwardingAddress}
                      </div>
                      <Button 
                        variant="outline" 
                        className="rounded-l-none border-l-0"
                        onClick={() => handleCopy(forwardingAddress)}
                      >
                        {copiedText === forwardingAddress ? (
                          <>
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4 mr-1" />
                            Copy
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
  
                  <div className="p-4">
                    <div className="font-medium mb-2">Step 2: Sign in to your mailbox and go to Settings -&gt; Forwarding and POP/IMAP.</div>
                    <div className="text-gray-600 text-sm">
                      Add the copied email as a forwarding address.
                    </div>
                  </div>
  
                  <div className="p-4">
                    <div className="font-medium mb-2">Step 3: If your email provider needs verification, you'll get an activation email as a ticket in your inbox.</div>
                    <div className="text-gray-600 text-sm">
                      Follow the instructions in the email to continue.
                    </div>
                  </div>
  
                  <div className="p-4">
                    <div className="font-medium mb-2">Step 4: Save your changes to finish the setup.</div>
                  </div>
                </div>
  
                <div className="mt-4">
                  <Alert className="bg-blue-50 border-blue-200">
                    <AlertDescription className="flex items-start">
                      <Info className="h-5 w-5 mr-2 mt-0.5 text-blue-500 shrink-0" />
                      <span>
                        <span className="font-medium block mb-1">Need more help?</span>
                        <span className="text-sm">
                          Contact your email provider for specific instructions on setting up email forwarding.
                        </span>
                      </span>
                    </AlertDescription>
                  </Alert>
                </div>
              </div>
            </Accordion>
          </CardContent>
        </Card>
      )}

      {selectedDeskId && currentDesk && (
        <Card>
          <CardHeader>
            <CardTitle>Email settings</CardTitle>
            <CardDescription>
              Configure email templates and notification settings for your support desk
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Accordion type="single" collapsible className="w-full border rounded-md overflow-hidden">
              <AccordionItem value="templates" className="border-none">
                <AccordionTrigger className="py-4 px-6 bg-gray-50 hover:bg-gray-100">
                  <div className="flex items-center text-left">
                    <Mail className="h-4 w-4 mr-2" />
                    <span className="font-medium">Email templates</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-6 py-4 border-t border-gray-200">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 border rounded-md hover:shadow-sm transition-shadow">
                      <h4 className="font-medium mb-1">Ticket creation confirmation</h4>
                      <p className="text-sm text-gray-500 mb-3">Sent to customers when a new ticket is created</p>
                      <Button variant="outline" size="sm" disabled>
                        Customize template
                      </Button>
                    </div>
                    <div className="p-4 border rounded-md hover:shadow-sm transition-shadow">
                      <h4 className="font-medium mb-1">Agent reply notification</h4>
                      <p className="text-sm text-gray-500 mb-3">Sent to customers when an agent replies to their ticket</p>
                      <Button variant="outline" size="sm" disabled>
                        Customize template
                      </Button>
                    </div>
                    <div className="p-4 border rounded-md hover:shadow-sm transition-shadow">
                      <h4 className="font-medium mb-1">Ticket resolution</h4>
                      <p className="text-sm text-gray-500 mb-3">Sent to customers when their ticket is resolved</p>
                      <Button variant="outline" size="sm" disabled>
                        Customize template
                      </Button>
                    </div>
                    <div className="p-4 border rounded-md hover:shadow-sm transition-shadow">
                      <h4 className="font-medium mb-1">Customer satisfaction survey</h4>
                      <p className="text-sm text-gray-500 mb-3">Sent to customers when a ticket is resolved</p>
                      <Button variant="outline" size="sm" disabled>
                        Customize template
                      </Button>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <Accordion type="single" collapsible className="w-full border rounded-md overflow-hidden">
              <AccordionItem value="notifications" className="border-none">
                <AccordionTrigger className="py-4 px-6 bg-gray-50 hover:bg-gray-100">
                  <div className="flex items-center text-left">
                    <Mailbox className="h-4 w-4 mr-2" />
                    <span className="font-medium">Agent notifications</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-6 py-4 border-t border-gray-200">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium">New ticket notification</h4>
                        <p className="text-sm text-gray-500">Send email notifications to agents when new tickets are assigned</p>
                      </div>
                      <Button variant="outline" size="sm" disabled>
                        Configure
                      </Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium">Customer reply notification</h4>
                        <p className="text-sm text-gray-500">Send email notifications to agents when customers reply to tickets</p>
                      </div>
                      <Button variant="outline" size="sm" disabled>
                        Configure
                      </Button>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      )}

      {selectedDeskId && currentDesk && (
        <Card>
          <CardHeader>
            <CardTitle>General settings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <h3 className="text-md font-medium mb-1">Route the emails to the respective groups</h3>
              <p className="text-sm text-gray-500">Automatically assign incoming tickets to the appropriate team</p>
            </div>

            <div className="space-y-4">
              <div>
                <Label>Assign to group</Label>
                <Select defaultValue={currentDesk?.id?.toString() || "default"} disabled>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select a group" />
                  </SelectTrigger>
                  <SelectContent>
                    {currentDesk && (
                      <SelectItem value={String(currentDesk?.id || 'default')}>{currentDesk?.name || 'Selected Desk'}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="pt-4">
                <h3 className="text-md font-medium mb-2">Email processing settings</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 border rounded-md">
                    <div>
                      <h4 className="font-medium">Ticket assignment</h4>
                      <p className="text-sm text-gray-500">Automatically assign tickets using round-robin</p>
                    </div>
                    <div>
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">Enabled</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 border rounded-md">
                    <div>
                      <h4 className="font-medium">Email notifications</h4>
                      <p className="text-sm text-gray-500">Send email notifications for ticket updates</p>
                    </div>
                    <div>
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">Enabled</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
