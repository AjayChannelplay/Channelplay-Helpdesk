import { useState, useEffect } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

// Type definitions for API responses
interface MailgunStatus {
  isInitialized: boolean;
  apiKeyValid: boolean;
  error?: string;
  supportEmail: string;
  domain: string;
  diagnostics?: {
    environment?: string;
    configured_endpoint?: string;
    initialized?: boolean;
    api_key_format?: string;
    european_domain?: boolean;
    error_type?: string;
    error_stack?: string;
    possible_solutions?: string[];
  };
}

interface MailgunConfig {
  supportEmail: string;
  domain: string;
  isInitialized: boolean;
  webhookUrl: string;
  inboundWebhookUrl: string;
  configurationSteps: string[];
}
import { Loader2, CheckCircle, AlertCircle, InfoIcon, Mail, MailCheck, MailQuestion, RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription,
  DialogFooter, 
  DialogHeader,
  DialogTitle,
  DialogTrigger 
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Ticket } from "@shared/schema";

const incomingEmailSchema = z.object({
  email: z.string().email("Must be a valid email address"),
  subject: z.string().min(2, "Subject must be at least 2 characters"),
  message: z.string().min(10, "Message must be at least 10 characters"),
});

type IncomingEmailFormData = z.infer<typeof incomingEmailSchema>;

const sendEmailSchema = z.object({
  to: z.string().email("Must be a valid email address"),
  subject: z.string().min(2, "Subject must be at least 2 characters"),
  message: z.string().min(10, "Message must be at least 10 characters"),
  ticketId: z.string().optional(),
});

type SendEmailFormData = z.infer<typeof sendEmailSchema>;

const webhookSchema = z.object({
  from: z.string().email("Must be a valid email address"),
  subject: z.string().min(2, "Subject must be at least 2 characters"),
  content: z.string().min(10, "Message must be at least 10 characters"),
  replyToTicket: z.string().optional(),
  inReplyTo: z.string().optional(),
});

type WebhookFormData = z.infer<typeof webhookSchema>;

interface TestToolsProps {
  tickets: Ticket[];
  onSuccess: () => void;
}

export default function TestTools({ tickets, onSuccess }: TestToolsProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  
  // Query Mailgun status
  const mailgunStatusQuery = useQuery<MailgunStatus>({
    queryKey: ['/api/mailgun/status'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });
  
  // Query Mailgun configuration
  const mailgunConfigQuery = useQuery<MailgunConfig>({
    queryKey: ['/api/mailgun/configuration'],
    refetchInterval: false, // Only load once
    enabled: !!mailgunStatusQuery.data?.isInitialized // Only fetch if Mailgun is initialized
  });
  
  // Form for simulating an incoming email
  const incomingForm = useForm<IncomingEmailFormData>({
    resolver: zodResolver(incomingEmailSchema),
    defaultValues: {
      email: "",
      subject: "",
      message: ""
    },
  });

  // Form for testing direct email sending
  const sendEmailForm = useForm<SendEmailFormData>({
    resolver: zodResolver(sendEmailSchema),
    defaultValues: {
      to: "",
      subject: "",
      message: "",
      ticketId: ""
    },
  });
  
  // Form for testing webhooks directly
  const webhookForm = useForm<WebhookFormData>({
    resolver: zodResolver(webhookSchema),
    defaultValues: {
      from: "customer@example.com",
      subject: "Test webhook email",
      content: "This is a test email sent directly to the webhook endpoint.",
      replyToTicket: "",
      inReplyTo: ""
    },
  });

  // Mutation for simulating incoming email
  const incomingEmailMutation = useMutation({
    mutationFn: async (data: IncomingEmailFormData) => {
      const res = await apiRequest("POST", "/api/test/incoming-email", data);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to process test email");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Test email processed successfully",
      });
      incomingForm.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      onSuccess();
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Check if a recipient is authorized for Mailgun sandbox domains
  const checkRecipientMutation = useMutation({
    mutationFn: async (email: string) => {
      try {
        const res = await apiRequest("GET", `/api/check-recipient?email=${encodeURIComponent(email)}`);
        if (!res.ok) {
          const errorData = await res.json();
          return {
            isAuthorized: false,
            authorized: false,
            isSandbox: true,
            message: errorData.message || "Failed to verify recipient"
          };
        }
        
        return await res.json();
      } catch (error) {
        // Return authorized by default to avoid blocking emails if the check fails
        return { 
          isAuthorized: true,
          authorized: true, 
          isSandbox: false,
          message: "Recipient check bypassed due to error"
        };
      }
    }
  });
  
  // Mutation for sending test emails
  const sendEmailMutation = useMutation({
    mutationFn: async (data: SendEmailFormData) => {
      // For Mailgun sandbox domains, we need to check if the recipient is authorized
      const recipientCheck = await checkRecipientMutation.mutateAsync(data.to);
      
      const res = await apiRequest("POST", "/api/test/send-email", data);
      if (!res.ok) {
        const errorData = await res.json();
        if (errorData.error && typeof errorData.error === 'object') {
          // Handle detailed error information
          const details = errorData.error.message || JSON.stringify(errorData.error);
          throw new Error(`${errorData.message}: ${details}`);
        } else {
          throw new Error(errorData.message || "Failed to send test email");
        }
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Test email sent successfully",
      });
      sendEmailForm.reset();
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  function onIncomingSubmit(data: IncomingEmailFormData) {
    incomingEmailMutation.mutate(data);
  }

  // Mutation for sending webhook directly
  const webhookMutation = useMutation({
    mutationFn: async (data: WebhookFormData) => {
      // Create the webhook payload - simulate Mailgun's inbound webhook format
      const webhookData = {
        sender: data.from,
        recipient: "help@helpdesk.channelplay.in",
        subject: data.subject,
        body: data.content,
        html: `<div>${data.content.replace(/\n/g, '<br/>')}</div>`,
        messageId: `test-${Date.now()}@example.com`,
        timestamp: new Date().toISOString(),
        headers: {
          "Message-ID": `test-${Date.now()}@example.com`,
          "In-Reply-To": data.inReplyTo || "",
          "References": data.inReplyTo || ""
        }
      };
      
      const res = await apiRequest("POST", "/api/inbound-email", webhookData);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to process webhook");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Webhook processed successfully",
      });
      webhookForm.reset({
        from: "customer@example.com",
        subject: "Test webhook email",
        content: "This is a test email sent directly to the webhook endpoint.",
        replyToTicket: "",
        inReplyTo: ""
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      onSuccess();
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  function onSendEmailSubmit(data: SendEmailFormData) {
    sendEmailMutation.mutate(data);
  }
  
  function onWebhookSubmit(data: WebhookFormData) {
    webhookMutation.mutate(data);
  }
  
  // Query to check Mailgun configuration status
  const { data: mailgunStatus, isLoading: isMailgunStatusLoading, refetch: refetchMailgunStatus } = useQuery<MailgunStatus>({
    queryKey: ["/api/mailgun/status"],
    enabled: true, // Always fetch, even when dialog is closed
    refetchOnWindowFocus: true,
    refetchInterval: 20000, // Refresh every 20 seconds to capture status changes
    retry: 2,
    queryFn: async () => {
      try {
        const response = await apiRequest("GET", "/api/mailgun/status");
        if (!response.ok) {
          return {
            isInitialized: false,
            apiKeyValid: false,
            supportEmail: 'not-configured',
            domain: 'not-configured',
            error: 'Failed to connect to server'
          };
        }
        return await response.json();
      } catch (error) {
        return {
          isInitialized: false,
          apiKeyValid: false,
          supportEmail: 'not-configured',
          domain: 'not-configured',
          error: 'Failed to connect to server'
        };
      }
    }
  });
  
  // Query to get Mailgun configuration guide
  const { data: mailgunConfig, isLoading: isMailgunConfigLoading } = useQuery<MailgunConfig>({
    queryKey: ["/api/mailgun/configuration"],
    enabled: open, // Only fetch when dialog is open
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async () => {
      try {
        const response = await apiRequest("GET", "/api/mailgun/configuration");
        if (!response.ok) {
          return {
            supportEmail: 'not-configured',
            domain: 'not-configured',
            isInitialized: false,
            webhookUrl: '',
            inboundWebhookUrl: '',
            configurationSteps: [
              "Mailgun configuration unavailable. Please check server logs."
            ]
          };
        }
        return await response.json();
      } catch (error) {
        return {
          supportEmail: 'not-configured',
          domain: 'not-configured',
          isInitialized: false,
          webhookUrl: '',
          inboundWebhookUrl: '',
          configurationSteps: [
            "Failed to connect to server to retrieve Mailgun configuration."
          ]
        };
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 px-2 sm:px-3">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
          <span className="sm:inline-block">Test</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Email Testing Tools</DialogTitle>
          <DialogDescription>
            Use these tools to test email functionality without requiring real email servers.
          </DialogDescription>
        </DialogHeader>
        
        {/* Mailgun Configuration Status Card */}
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <div className="flex justify-between items-center">
              <CardTitle className="text-base flex items-center">
                <Mail className="h-4 w-4 mr-2" />
                Mailgun Email Configuration
              </CardTitle>
              {isMailgunStatusLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <Badge variant={mailgunStatus?.apiKeyValid ? "success" : "destructive"}>
                  {mailgunStatus?.apiKeyValid ? "Connected" : "Not Connected"}
                </Badge>
              )}
            </div>
            <CardDescription>
              Email delivery and webhook configuration status
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isMailgunStatusLoading ? (
              <div className="flex items-center space-x-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Checking Mailgun configuration...</span>
              </div>
            ) : mailgunStatus ? (
              <div className="space-y-4">
                {/* Status alert */}
                {mailgunStatus.apiKeyValid ? (
                  <Alert variant="success" className="text-sm">
                    <CheckCircle className="h-4 w-4" />
                    <AlertTitle>Mailgun is properly configured</AlertTitle>
                    <AlertDescription>
                      Your email service is connected and ready to send and receive emails.
                    </AlertDescription>
                  </Alert>
                ) : mailgunStatus.error ? (
                  <Alert variant="destructive" className="text-sm">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Mailgun API Key Invalid</AlertTitle>
                    <AlertDescription>
                      {mailgunStatus.error}. Please check your environment variables.
                    </AlertDescription>
                  </Alert>
                ) : !mailgunStatus.isInitialized ? (
                  <Alert variant="info" className="text-sm">
                    <MailQuestion className="h-4 w-4" />
                    <AlertTitle>Mailgun not configured</AlertTitle>
                    <AlertDescription>
                      Please set the MAILGUN_API_KEY and MAILGUN_DOMAIN environment variables to enable email functionality.
                    </AlertDescription>
                  </Alert>
                ) : null}
                
                {/* Configuration details */}
                <div className="space-y-2 text-sm">
                  <div className="flex items-center space-x-2">
                    {mailgunStatus.apiKeyValid ? (
                      <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                    )}
                    <span>
                      <span className="font-medium">API Key: </span>
                      {mailgunStatus.apiKeyValid ? "Valid" : "Invalid"}
                    </span>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <InfoIcon className="h-4 w-4 text-blue-500 flex-shrink-0" />
                    <span>
                      <span className="font-medium">Domain: </span>
                      {mailgunStatus.domain || "Not configured"}
                    </span>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <MailCheck className="h-4 w-4 text-blue-500 flex-shrink-0" />
                    <span>
                      <span className="font-medium">Support Email: </span>
                      {mailgunStatus.supportEmail || "Not configured"}
                    </span>
                  </div>
                </div>
                
                {!mailgunStatus.apiKeyValid && mailgunConfig && (
                  <div className="mt-4">
                    <Accordion type="single" collapsible>
                      <AccordionItem value="config">
                        <AccordionTrigger className="text-xs font-medium text-blue-600">
                          Mailgun Configuration Guide
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-2 pt-2">
                            <div className="text-xs font-medium">Webhook URLs:</div>
                            <div className="p-2 bg-slate-50 border rounded text-xs font-mono break-all">
                              <div className="mb-1"><span className="font-medium">Inbound:</span> {mailgunConfig.inboundWebhookUrl}</div>
                              <div><span className="font-medium">Events:</span> {mailgunConfig.webhookUrl}</div>
                            </div>
                            
                            <div className="text-xs font-medium mt-3">Configuration Steps:</div>
                            <ol className="pl-5 list-decimal text-xs space-y-1">
                              {mailgunConfig.configurationSteps.map((step, index) => (
                                <li key={index}>{step}</li>
                              ))}
                            </ol>
                            
                            <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded-sm">
                              <p className="text-xs text-amber-800">
                                When using Mailgun with a personal domain, SMTP and API settings may 
                                need to be different based on your region. For EU region, use 
                                <span className="font-mono px-1">api.eu.mailgun.net</span> instead.
                              </p>
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </div>
                )}
              </div>
            ) : (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Unable to check Mailgun status</AlertTitle>
                <AlertDescription>
                  Could not connect to the server to verify Mailgun configuration.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
        
        <Tabs defaultValue="incoming" className="mt-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="incoming">Simulate Incoming Email</TabsTrigger>
            <TabsTrigger value="outgoing">Test Send Email</TabsTrigger>
            <TabsTrigger value="webhook">Direct Webhook</TabsTrigger>
            <TabsTrigger value="survey">Satisfaction Survey</TabsTrigger>
          </TabsList>
          
          <TabsContent value="incoming" className="p-4 border rounded-md mt-2">
            <h3 className="text-lg font-medium mb-4">Simulate a customer sending an email</h3>
            <p className="text-sm text-gray-500 mb-4">
              This will create a new ticket for each email as if it came from a customer.
            </p>
            
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-md mb-4">
              <p className="text-sm text-blue-700 font-medium">Testing Repeat Emails:</p>
              <p className="text-xs text-blue-600 mt-1">
                <strong>Each test email will create a new ticket</strong>, even with the same sender email.
                When testing with real Mailgun, make sure to change the subject or message content to avoid duplicate detection.
              </p>
            </div>
            
            <Form {...incomingForm}>
              <form onSubmit={incomingForm.handleSubmit(onIncomingSubmit)} className="space-y-4">
                <FormField
                  control={incomingForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer Email</FormLabel>
                      <FormControl>
                        <Input placeholder="customer@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={incomingForm.control}
                  name="subject"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Subject</FormLabel>
                      <FormControl>
                        <Input placeholder="Question about my order" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={incomingForm.control}
                  name="message"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Message Content</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="I'm having an issue with my recent order..." 
                          rows={5}
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <DialogFooter>
                  <Button 
                    type="submit" 
                    className="w-full md:w-auto"
                    disabled={incomingEmailMutation.isPending}
                  >
                    {incomingEmailMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Simulate Incoming Email
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </TabsContent>
          
          <TabsContent value="outgoing" className="p-4 border rounded-md mt-2">
            <h3 className="text-lg font-medium mb-4">Test sending an email</h3>
            <p className="text-sm text-gray-500 mb-4">
              Test the email sending functionality directly without creating a ticket.
            </p>
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-md mb-4">
              <p className="text-sm text-blue-700 font-medium">Mailgun Email Information</p>
              <p className="text-xs text-blue-600 mt-1">
                This application is configured to use Mailgun for email handling. 
                {mailgunStatus ? (
                  <>
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center text-xs">
                        <span className="font-medium mr-2">Status:</span> 
                        <span className={mailgunStatus.apiKeyValid ? "text-green-600" : "text-red-600"}>
                          {mailgunStatus.apiKeyValid ? "Connected" : "Not Connected"}
                        </span>
                      </div>
                      <div className="flex items-center text-xs">
                        <span className="font-medium mr-2">Support Email:</span> {mailgunStatus.supportEmail}
                      </div>
                      <div className="flex items-center text-xs">
                        <span className="font-medium mr-2">Domain:</span> {mailgunStatus.domain}
                      </div>
                      {mailgunStatus.diagnostics && (
                        <div className="flex items-center text-xs">
                          <span className="font-medium mr-2">API Endpoint:</span> 
                          {mailgunStatus.diagnostics.configured_endpoint}
                        </div>
                      )}
                      {mailgunStatus.error && (
                        <div className="mt-2 text-xs text-red-600">
                          <span className="font-medium">Error:</span> {mailgunStatus.error}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <span className="text-blue-600">
                    Loading configuration information...
                  </span>
                )}
              </p>
              {!mailgunStatus?.apiKeyValid && (
                <Alert className="mt-3" variant="warning">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle className="text-xs">Mailgun API Key Issue</AlertTitle>
                  <AlertDescription className="text-xs">
                    Your Mailgun connection is not working. Please check your Mailgun API key and domain configuration,
                    including whether the API key requires the 'key-' prefix and if you're using the correct EU/US API endpoint.
                  </AlertDescription>
                </Alert>
              )}
            </div>
            
            <Form {...sendEmailForm}>
              <form onSubmit={sendEmailForm.handleSubmit(onSendEmailSubmit)} className="space-y-4">
                <FormField
                  control={sendEmailForm.control}
                  name="to"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Recipient Email</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input placeholder="recipient@example.com" {...field} />
                        </FormControl>
                        <Button 
                          type="button" 
                          variant="outline" 
                          size="sm"
                          onClick={() => {
                            if (field.value) {
                              checkRecipientMutation.mutate(field.value, {
                                onSuccess: (data) => {
                                  toast({
                                    title: data.isAuthorized ? "Email is Authorized" : "Email NOT Authorized",
                                    description: data.message,
                                    variant: data.isAuthorized ? "default" : "destructive"
                                  });
                                }
                              });
                            } else {
                              toast({
                                title: "No Email Provided",
                                description: "Please enter an email address to check.",
                                variant: "destructive"
                              });
                            }
                          }}
                          disabled={checkRecipientMutation.isPending}
                        >
                          {checkRecipientMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : "Check"}
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={sendEmailForm.control}
                  name="subject"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Subject</FormLabel>
                      <FormControl>
                        <Input placeholder="Your support ticket update" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={sendEmailForm.control}
                  name="ticketId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ticket ID (Optional)</FormLabel>
                      <FormControl>
                        <select 
                          {...field}
                          className="w-full p-2 border rounded-md"
                        >
                          <option value="">None (Send as new email)</option>
                          {tickets.map(ticket => (
                            <option key={ticket.id} value={ticket.id}>
                              #{ticket.id} - {ticket.subject} ({ticket.customerEmail})
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={sendEmailForm.control}
                  name="message"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Message Content</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="The content of the email to send..." 
                          rows={5}
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <DialogFooter>
                  <Button 
                    type="submit" 
                    className="w-full md:w-auto"
                    disabled={sendEmailMutation.isPending}
                  >
                    {sendEmailMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Send Test Email
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </TabsContent>
          
          <TabsContent value="survey" className="p-4 border rounded-md mt-2">
            <h3 className="text-lg font-medium mb-4">Test Satisfaction Survey Email</h3>
            <p className="text-sm text-gray-500 mb-4">
              This allows you to test sending customer satisfaction survey emails directly, which are sent when a ticket is resolved.
            </p>
            
            <div className="p-3 bg-green-50 border border-green-200 rounded-md mb-4">
              <p className="text-sm text-green-700 font-medium">Satisfaction Survey Test</p>
              <p className="text-xs text-green-600 mt-1">
                This test will send a satisfaction survey email to the specified address. The email contains
                clickable rating buttons that would normally record customer satisfaction for resolved tickets.
              </p>
            </div>
            
            <div className="space-y-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Recipient Email</label>
                <input 
                  type="email" 
                  id="survey-email" 
                  className="w-full p-2 border rounded-md"
                  placeholder="customer@example.com"
                />
                <p className="text-xs text-gray-500">Enter the email address where you want to receive the test satisfaction survey.</p>
              </div>
              
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Ticket ID (Optional)</label>
                <select 
                  id="survey-ticket-id"
                  className="w-full p-2 border rounded-md"
                >
                  <option value="">Test with ID #999</option>
                  {tickets.map(ticket => (
                    <option key={ticket.id} value={ticket.id}>
                      #{ticket.id} - {ticket.subject} ({ticket.customerEmail})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500">If selected, the survey email will reference this specific ticket.</p>
              </div>
              
              <DialogFooter>
                <Button 
                  type="button" 
                  className="w-full md:w-auto"
                  onClick={() => {
                    const email = (document.getElementById('survey-email') as HTMLInputElement).value;
                    const ticketId = (document.getElementById('survey-ticket-id') as HTMLSelectElement).value;
                    
                    if (!email) {
                      toast({
                        title: "Email Required",
                        description: "Please enter a recipient email address",
                        variant: "destructive"
                      });
                      return;
                    }
                    
                    // Send the test satisfaction survey
                    apiRequest("POST", "/api/test/send-satisfaction-survey", {
                      to: email,
                      ticketId: ticketId || undefined
                    })
                    .then(async (res) => {
                      if (!res.ok) {
                        const errorData = await res.json();
                        throw new Error(errorData.message || "Failed to send satisfaction survey");
                      }
                      return res.json();
                    })
                    .then((data) => {
                      console.log("Survey test response:", data);
                      toast({
                        title: "Success",
                        description: "Satisfaction survey email sent successfully",
                      });
                    })
                    .catch((error) => {
                      console.error("Survey test error:", error);
                      toast({
                        title: "Error",
                        description: error.message || "Failed to send satisfaction survey",
                        variant: "destructive",
                      });
                    });
                  }}
                >
                  Send Test Satisfaction Survey
                </Button>
              </DialogFooter>
            </div>
          </TabsContent>
          
          <TabsContent value="webhook" className="p-4 border rounded-md mt-2">
            <h3 className="text-lg font-medium mb-4">Test Direct Webhook</h3>
            <p className="text-sm text-gray-500 mb-4">
              This sends a request directly to the webhook endpoint that Mailgun would call. Use this to test the webhook handling code.
            </p>
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md mb-4">
              <p className="text-sm text-yellow-700 font-medium">Testing Webhook Directly</p>
              <p className="text-xs text-yellow-600 mt-1">
                This simulates the webhook payload that Mailgun would send. <strong>Each test will create a new ticket</strong> unless 
                you specifically set the "Reply to Ticket" field below.
              </p>
              <p className="text-xs text-yellow-700 mt-2">
                <strong>For testing repeat emails</strong>: Each webhook test will be assigned a unique message ID and timestamp.
                Make sure to change the content or subject line slightly between tests to avoid being detected as duplicate content.
              </p>
            </div>
            
            <Form {...webhookForm}>
              <form onSubmit={webhookForm.handleSubmit(onWebhookSubmit)} className="space-y-4">
                <FormField
                  control={webhookForm.control}
                  name="from"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>From Email</FormLabel>
                      <FormControl>
                        <Input placeholder="customer@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={webhookForm.control}
                  name="subject"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Subject</FormLabel>
                      <FormControl>
                        <Input placeholder="Test webhook email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={webhookForm.control}
                  name="replyToTicket"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reply to Ticket (Optional)</FormLabel>
                      <FormControl>
                        <select 
                          {...field}
                          className="w-full p-2 border rounded-md"
                          onChange={(e) => {
                            field.onChange(e);
                            // When a ticket is selected, automatically add "[Ticket #X]" to the subject
                            if (e.target.value) {
                              const ticketId = e.target.value;
                              webhookForm.setValue('subject', `Re: [Ticket #${ticketId}] Test Reply`);
                              
                              // Find the ticket's first message ID to use as In-Reply-To
                              const ticket = tickets.find(t => t.id.toString() === ticketId);
                              if (ticket) {
                                queryClient.fetchQuery({
                                  queryKey: ['/api/tickets', ticketId],
                                  queryFn: async () => {
                                    const res = await fetch(`/api/tickets/${ticketId}`);
                                    if (!res.ok) throw new Error('Failed to fetch ticket details');
                                    return res.json();
                                  },
                                  staleTime: 60000
                                }).then(data => {
                                  if (data.messages && data.messages.length > 0) {
                                    const msgId = data.messages[0].messageId;
                                    if (msgId) webhookForm.setValue('inReplyTo', msgId);
                                  }
                                }).catch(err => {
                                  console.error('Error fetching ticket details:', err);
                                });
                              }
                            }
                          }}
                        >
                          <option value="">None (Create new ticket)</option>
                          {tickets.map(ticket => (
                            <option key={ticket.id} value={ticket.id}>
                              #{ticket.id} - {ticket.subject} ({ticket.customerEmail})
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={webhookForm.control}
                  name="inReplyTo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>In-Reply-To Message ID (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Reference message ID for threading" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={webhookForm.control}
                  name="content"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Content</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="This is a test email sent directly to the webhook endpoint." 
                          rows={5}
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <DialogFooter>
                  <Button 
                    type="submit" 
                    className="w-full md:w-auto"
                    disabled={webhookMutation.isPending}
                  >
                    {webhookMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Send Test Webhook
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}