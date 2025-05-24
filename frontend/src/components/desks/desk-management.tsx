import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { AlertCircle, PlusCircle, Pencil, Trash2, Inbox, Mail, Users, Server, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import UserAssignmentDialog from "./user-assignment-dialog";

import { Desk } from "@shared/schema";

// Remove import for Separator and delete this comment afterwards

// Define schemas for form validation
const createDeskSchema = z.object({
  name: z
    .string()
    .min(2, { message: "Desk name must be at least 2 characters long" })
    .max(50, { message: "Desk name must be less than 50 characters" }),
  email: z
    .string()
    .email({ message: "Please enter a valid email address" }),
  forwardingEmail: z
    .string()
    .email({ message: "Please enter a valid email address" })
    .optional()
    .nullable()
    .or(z.literal('')),
  
  // SMTP Configuration
  useDirectEmail: z
    .boolean()
    .default(false),
  smtpHost: z
    .string()
    .min(1, { message: "SMTP host is required when direct email is enabled" })
    .optional()
    .nullable()
    .or(z.literal('')),
  smtpPort: z
    .string()
    .min(1, { message: "SMTP port is required when direct email is enabled" })
    .optional()
    .nullable()
    .or(z.literal('')),
  smtpSecure: z
    .boolean()
    .default(true)
    .optional(),
  smtpUser: z
    .string()
    .min(1, { message: "SMTP username is required when direct email is enabled" })
    .optional()
    .nullable()
    .or(z.literal('')),
  smtpPassword: z
    .string()
    .min(1, { message: "SMTP password is required when direct email is enabled" })
    .optional()
    .nullable()
    .or(z.literal('')),
  smtpFromName: z
    .string()
    .min(1, { message: "From name is required" })
    .optional()
    .nullable()
    .or(z.literal('')),
    
  // IMAP Configuration
  useImapPolling: z
    .boolean()
    .default(false),
  imapHost: z
    .string()
    .min(1, { message: "IMAP host is required when email polling is enabled" })
    .optional()
    .nullable()
    .or(z.literal('')),
  imapPort: z
    .string()
    .min(1, { message: "IMAP port is required when email polling is enabled" })
    .optional()
    .nullable()
    .or(z.literal('')),
  imapSecure: z
    .boolean()
    .default(true)
    .optional(),
  imapUser: z
    .string()
    .min(1, { message: "IMAP username is required when email polling is enabled" })
    .optional()
    .nullable()
    .or(z.literal('')),
  imapPassword: z
    .string()
    .min(1, { message: "IMAP password is required when email polling is enabled" })
    .optional()
    .nullable()
    .or(z.literal('')),
});

const updateDeskSchema = z.object({
  id: z.number(),
  name: z
    .string()
    .min(2, { message: "Desk name must be at least 2 characters long" })
    .max(50, { message: "Desk name must be less than 50 characters" }),
  email: z
    .string()
    .email({ message: "Please enter a valid email address" }),
  forwardingEmail: z
    .string()
    .email({ message: "Please enter a valid email address" })
    .optional()
    .nullable()
    .or(z.literal('')),
  
  // SMTP Configuration
  useDirectEmail: z
    .boolean()
    .default(false),
  smtpHost: z
    .string()
    .min(1, { message: "SMTP host is required when direct email is enabled" })
    .optional()
    .nullable()
    .or(z.literal('')),
  smtpPort: z
    .string()
    .min(1, { message: "SMTP port is required when direct email is enabled" })
    .optional()
    .nullable()
    .or(z.literal('')),
  smtpSecure: z
    .boolean()
    .default(true)
    .optional(),
  smtpUser: z
    .string()
    .min(1, { message: "SMTP username is required when direct email is enabled" })
    .optional()
    .nullable()
    .or(z.literal('')),
  smtpPassword: z
    .string()
    .min(1, { message: "SMTP password is required when direct email is enabled" })
    .optional()
    .nullable()
    .or(z.literal('')),
  smtpFromName: z
    .string()
    .min(1, { message: "From name is required" })
    .optional()
    .nullable()
    .or(z.literal('')),
    
  // IMAP Configuration
  useImapPolling: z
    .boolean()
    .default(false),
  imapHost: z
    .string()
    .min(1, { message: "IMAP host is required when email polling is enabled" })
    .optional()
    .nullable()
    .or(z.literal('')),
  imapPort: z
    .string()
    .min(1, { message: "IMAP port is required when email polling is enabled" })
    .optional()
    .nullable()
    .or(z.literal('')),
  imapSecure: z
    .boolean()
    .default(true)
    .optional(),
  imapUser: z
    .string()
    .min(1, { message: "IMAP username is required when email polling is enabled" })
    .optional()
    .nullable()
    .or(z.literal('')),
  imapPassword: z
    .string()
    .min(1, { message: "IMAP password is required when email polling is enabled" })
    .optional()
    .nullable()
    .or(z.literal('')),
});

// Create a custom Divider component to replace Separator
function Divider() {
  return <div className="h-[1px] w-full bg-gray-200 my-4" />;
}

// Define types
type CreateDeskFormData = z.infer<typeof createDeskSchema>;
type UpdateDeskFormData = z.infer<typeof updateDeskSchema>;

// We'll use our own Desk type to avoid conflict with the imported type
type DeskData = {
  id: number;
  name: string;
  email: string;
  forwardingEmail?: string | null;
  
  // SMTP Configuration
  useDirectEmail?: boolean;
  smtpHost?: string | null;
  smtpPort?: string | null;
  smtpSecure?: boolean;
  smtpUser?: string | null;
  smtpPassword?: string | null;
  smtpFromName?: string | null;
  
  // IMAP Configuration
  useImapPolling?: boolean;
  imapHost?: string | null;
  imapPort?: string | null;
  imapSecure?: boolean;
  imapUser?: string | null;
  imapPassword?: string | null;
};

type User = {
  id: number;
  username: string;
  name: string;
  email: string;
  role: string;
};

export default function DeskManagement() {
  const [createOpen, setCreateOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [userAssignmentOpen, setUserAssignmentOpen] = useState(false);
  const [currentDesk, setCurrentDesk] = useState<DeskData | null>(null);
  const [selectedDeskForUsers, setSelectedDeskForUsers] = useState<DeskData | null>(null);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  const { toast } = useToast();

  // Query to fetch all desks
  const { data: desks = [], isLoading, error } = useQuery({
    queryKey: ["/api/desks"],
  });

  // Query to fetch all users for user management
  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ["/api/users"],
  });

  // Mutation to create a new desk
  const createDeskMutation = useMutation({
    mutationFn: async (data: CreateDeskFormData) => {
      const response = await apiRequest("POST", "/api/desks", data);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/desks"] });
      setCreateOpen(false);
      toast({
        title: "Success",
        description: "Desk created successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: `Failed to create desk: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Mutation to update a desk
  const updateDeskMutation = useMutation({
    mutationFn: async (data: UpdateDeskFormData) => {
      const response = await apiRequest("PATCH", `/api/desks/${data.id}`, data);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/desks"] });
      setUpdateOpen(false);
      toast({
        title: "Success",
        description: "Desk updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: `Failed to update desk: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Mutation to delete a desk
  const deleteDeskMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("DELETE", `/api/desks/${id}`);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/desks"] });
      setDeleteOpen(false);
      toast({
        title: "Success",
        description: "Desk deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: `Failed to delete desk: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Mutation to add a user to a desk
  const addUserToDeskMutation = useMutation({
    mutationFn: async ({ deskId, userId }: { deskId: number; userId: number }) => {
      const response = await apiRequest("POST", `/api/desks/${deskId}/users/${userId}`);
      return response;
    },
    onSuccess: () => {
      if (selectedDeskId) {
        queryClient.invalidateQueries({ queryKey: [`/api/desks/${selectedDeskId}/users`] });
        fetchDeskUsers(selectedDeskId);
      }
      toast({
        title: "Success",
        description: "User added to desk successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: `Failed to add user to desk: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Mutation to remove a user from a desk
  const removeUserFromDeskMutation = useMutation({
    mutationFn: async ({ deskId, userId }: { deskId: number; userId: number }) => {
      const response = await apiRequest("DELETE", `/api/desks/${deskId}/users/${userId}`);
      return response;
    },
    onSuccess: () => {
      if (selectedDeskId) {
        queryClient.invalidateQueries({ queryKey: [`/api/desks/${selectedDeskId}/users`] });
        fetchDeskUsers(selectedDeskId);
      }
      toast({
        title: "Success",
        description: "User removed from desk successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: `Failed to remove user from desk: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Forms
  const createForm = useForm<CreateDeskFormData>({
    resolver: zodResolver(createDeskSchema),
    defaultValues: {
      name: "",
      email: "",
      forwardingEmail: "",
      // SMTP Configuration
      useDirectEmail: false,
      smtpHost: "",
      smtpPort: "",
      smtpSecure: true,
      smtpUser: "",
      smtpPassword: "",
      smtpFromName: "",
      // IMAP Configuration
      useImapPolling: false,
      imapHost: "",
      imapPort: "",
      imapSecure: true,
      imapUser: "",
      imapPassword: "",
    },
  });

  const updateForm = useForm<UpdateDeskFormData>({
    resolver: zodResolver(updateDeskSchema),
    defaultValues: {
      id: 0,
      name: "",
      email: "",
      forwardingEmail: "",
      // SMTP Configuration
      useDirectEmail: false,
      smtpHost: "",
      smtpPort: "",
      smtpSecure: true,
      smtpUser: "",
      smtpPassword: "",
      smtpFromName: "",
      // IMAP Configuration
      useImapPolling: false,
      imapHost: "",
      imapPort: "",
      imapSecure: true,
      imapUser: "",
      imapPassword: "",
    },
  });

  // Submit handlers
  const onCreateSubmit = (data: CreateDeskFormData) => {
    createDeskMutation.mutate(data);
  };

  const onUpdateSubmit = (data: UpdateDeskFormData) => {
    updateDeskMutation.mutate(data);
  };

  // Action handlers
  const handleEditDesk = (desk: Desk) => {
    setCurrentDesk(desk);
    updateForm.reset({
      id: desk.id,
      name: desk.name,
      email: desk.email,
      forwardingEmail: desk.forwardingEmail || "",
      // SMTP Configuration
      useDirectEmail: desk.useDirectEmail || false,
      smtpHost: desk.smtpHost || "",
      smtpPort: desk.smtpPort || "",
      smtpSecure: desk.smtpSecure || true,
      smtpUser: desk.smtpUser || "",
      smtpPassword: desk.smtpPassword || "",
      smtpFromName: desk.smtpFromName || "",
      // IMAP Configuration
      useImapPolling: desk.useImapPolling || false,
      imapHost: desk.imapHost || "",
      imapPort: desk.imapPort || "",
      imapSecure: desk.imapSecure || true,
      imapUser: desk.imapUser || "",
      imapPassword: desk.imapPassword || "",
    });
    setUpdateOpen(true);
  };

  const handleManageUsers = (desk: DeskData) => {
    setSelectedDeskForUsers(desk);
    setUserAssignmentOpen(true);
  };

  const handleDeleteDesk = (desk: Desk) => {
    setCurrentDesk(desk);
    setDeleteOpen(true);
  };

  const fetchDeskUsers = async (deskId: number) => {
    try {
      const response = await fetch(`/api/desks/${deskId}/users`);
      const data = await response.json();
      setDeskUsers(data);

      // Filter out users already assigned to the desk
      const userIds = data.map((user: User) => user.id);
      setAvailableUsers(users.filter((user: User) => !userIds.includes(user.id)));
    } catch (error) {
      console.error("Failed to fetch desk users:", error);
      toast({
        title: "Error",
        description: "Failed to fetch desk users",
        variant: "destructive",
      });
    }
  };

  const addUserToDesk = (userId: number) => {
    if (selectedDeskId) {
      addUserToDeskMutation.mutate({ deskId: selectedDeskId, userId });
    }
  };

  const removeUserFromDesk = (userId: number) => {
    if (selectedDeskId) {
      removeUserFromDeskMutation.mutate({ deskId: selectedDeskId, userId });
    }
  };

  if (isLoading) {
    return (
      <div className="p-4">
        <div className="animate-spin h-10 w-10 mx-auto border-b-2 border-gray-900 rounded-full"></div>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>Failed to load desks</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Support Desks</h2>
          <p className="text-sm text-gray-500">
            Manage your support desks and assign users to them
          </p>
        </div>
        <Button onClick={() => {
          createForm.reset({
            name: "",
            email: "",
            forwardingEmail: "",
            useDirectEmail: false,
            smtpHost: "",
            smtpPort: "",
            smtpSecure: true,
            smtpUser: "",
            smtpPassword: "",
            smtpFromName: "",
          });
          setCreateOpen(true);
        }}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Desk
        </Button>
      </div>

      {desks.length === 0 ? (
        <Card>
          <CardContent className="p-8 flex flex-col items-center justify-center">
            <Inbox className="h-12 w-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium mb-2">No desks created yet</h3>
            <p className="text-sm text-gray-500 mb-4 text-center">
              Create your first support desk to start managing your tickets
            </p>
            <Button onClick={() => setCreateOpen(true)}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Desk
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[250px]">Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Forwarding Email</TableHead>
                  <TableHead>Email Config</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {desks.map((desk: Desk) => (
                  <TableRow key={desk.id}>
                    <TableCell className="font-medium">{desk.name}</TableCell>
                    <TableCell>{desk.email}</TableCell>
                    <TableCell>{desk.forwardingEmail || '—'}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div>
                          {desk.useDirectEmail && desk.smtpHost ? (
                            <span className="flex items-center text-green-600">
                              <Server className="h-4 w-4 mr-1" />
                              Direct SMTP
                            </span>
                          ) : (
                            <span className="flex items-center text-blue-600">
                              <Mail className="h-4 w-4 mr-1" />
                              Mailgun
                            </span>
                          )}
                        </div>
                        {desk.useImapPolling && desk.imapHost && (
                          <span className="flex items-center text-green-600 text-sm">
                            <Inbox className="h-3 w-3 mr-1" />
                            IMAP Polling
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleManageUsers(desk)}
                        >
                          <Users className="h-4 w-4" />
                          <span className="sr-only">Manage Users</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditDesk(desk)}
                        >
                          <Pencil className="h-4 w-4" />
                          <span className="sr-only">Edit</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteDesk(desk)}
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Delete</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create Desk Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Support Desk</DialogTitle>
            <DialogDescription>
              Add a new support desk and configure its settings
            </DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-6">
              <div className="space-y-4">
                <FormField
                  control={createForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Desk Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Customer Support" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl>
                        <Input placeholder="support@example.com" {...field} />
                      </FormControl>
                      <FormDescription>
                        This email will be used for authentication (SMTP and IMAP) and as the from address for all helpdesk emails.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="forwardingEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Forwarding Email (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="forward-to@example.com" value={field.value || ''} onChange={field.onChange} />
                      </FormControl>
                      <FormDescription>
                        Optionally forward all emails to another address
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Divider />

                <FormField
                  control={createForm.control}
                  name="useDirectEmail"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">
                          Use Direct Email (SMTP)
                        </FormLabel>
                        <FormDescription>
                          Enable to use SMTP for sending emails instead of Mailgun
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {createForm.watch("useDirectEmail") && (
                  <div className="space-y-4 border rounded-lg p-4">
                    <h3 className="font-medium">SMTP Configuration</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={createForm.control}
                        name="smtpHost"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>SMTP Host</FormLabel>
                            <FormControl>
                              <Input placeholder="smtp.gmail.com" value={field.value || ''} onChange={field.onChange} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={createForm.control}
                        name="smtpPort"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>SMTP Port</FormLabel>
                            <FormControl>
                              <Input placeholder="587" value={field.value || ''} onChange={field.onChange} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={createForm.control}
                      name="smtpSecure"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base">
                              Use SSL/TLS
                            </FormLabel>
                            <FormDescription>
                              Enable secure connection
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={createForm.control}
                      name="smtpUser"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>SMTP Username</FormLabel>
                          <FormControl>
                            <Input placeholder="your.email@gmail.com" value={field.value || ''} onChange={field.onChange} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={createForm.control}
                      name="smtpPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>SMTP Password</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="••••••••" value={field.value || ''} onChange={field.onChange} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={createForm.control}
                      name="smtpFromName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>From Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Support Team" value={field.value || ''} onChange={field.onChange} />
                          </FormControl>
                          <FormDescription>
                            The name that will appear as the sender of emails
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
                
                {/* IMAP Configuration Section */}
                <div className="space-y-4 mt-6">
                  <FormField
                    control={createForm.control}
                    name="useImapPolling"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">
                            Email Polling (IMAP)
                          </FormLabel>
                          <FormDescription>
                            Automatically fetch emails from this mailbox and convert them to tickets
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  
                  {createForm.watch("useImapPolling") && (
                    <div className="space-y-4 border rounded-md p-4">
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={createForm.control}
                          name="imapHost"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>IMAP Host</FormLabel>
                              <FormControl>
                                <Input placeholder="imap.gmail.com" value={field.value || ''} onChange={field.onChange} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={createForm.control}
                          name="imapPort"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>IMAP Port</FormLabel>
                              <FormControl>
                                <Input placeholder="993" value={field.value || ''} onChange={field.onChange} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <FormField
                        control={createForm.control}
                        name="imapSecure"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">
                                Use SSL/TLS for IMAP
                              </FormLabel>
                              <FormDescription>
                                Enable secure connection for email polling
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={createForm.control}
                        name="imapUser"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>IMAP Username</FormLabel>
                            <FormControl>
                              <Input placeholder="your.email@gmail.com" value={field.value || ''} onChange={field.onChange} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={createForm.control}
                        name="imapPassword"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>IMAP Password</FormLabel>
                            <FormControl>
                              <Input type="password" placeholder="••••••••" value={field.value || ''} onChange={field.onChange} />
                            </FormControl>
                            <FormDescription>
                              For Gmail, use an app password instead of your regular password
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createDeskMutation.isPending}>
                  {createDeskMutation.isPending ? "Creating..." : "Create Desk"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Update Desk Dialog */}
      <Dialog open={updateOpen} onOpenChange={setUpdateOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Support Desk</DialogTitle>
            <DialogDescription>
              Update the settings for this support desk
            </DialogDescription>
          </DialogHeader>
          <Form {...updateForm}>
            <form onSubmit={updateForm.handleSubmit(onUpdateSubmit)} className="space-y-6">
              <div className="space-y-4">
                <FormField
                  control={updateForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Desk Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Customer Support" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={updateForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl>
                        <Input placeholder="support@example.com" {...field} />
                      </FormControl>
                      <FormDescription>
                        This email will be used for authentication (SMTP and IMAP) and as the from address for all helpdesk emails.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={updateForm.control}
                  name="forwardingEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Forwarding Email (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="forward-to@example.com" {...field} />
                      </FormControl>
                      <FormDescription>
                        Optionally forward all emails to another address
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Divider />

                <FormField
                  control={updateForm.control}
                  name="useDirectEmail"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">
                          Use Direct Email (SMTP)
                        </FormLabel>
                        <FormDescription>
                          Enable to use SMTP for sending emails instead of Mailgun
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {updateForm.watch("useDirectEmail") && (
                  <div className="space-y-4 border rounded-lg p-4">
                    <h3 className="font-medium">SMTP Configuration</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={updateForm.control}
                        name="smtpHost"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>SMTP Host</FormLabel>
                            <FormControl>
                              <Input placeholder="smtp.gmail.com" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={updateForm.control}
                        name="smtpPort"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>SMTP Port</FormLabel>
                            <FormControl>
                              <Input placeholder="587" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={updateForm.control}
                      name="smtpSecure"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base">
                              Use SSL/TLS
                            </FormLabel>
                            <FormDescription>
                              Enable secure connection
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={updateForm.control}
                      name="smtpUser"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>SMTP Username</FormLabel>
                          <FormControl>
                            <Input placeholder="your.email@gmail.com" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={updateForm.control}
                      name="smtpPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>SMTP Password</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="••••••••" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={updateForm.control}
                      name="smtpFromName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>From Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Support Team" {...field} />
                          </FormControl>
                          <FormDescription>
                            The name that will appear as the sender of emails
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
                
                {/* IMAP Configuration Section for Update Form */}
                <div className="space-y-4 mt-6">
                  <FormField
                    control={updateForm.control}
                    name="useImapPolling"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">
                            Email Polling (IMAP)
                          </FormLabel>
                          <FormDescription>
                            Automatically fetch emails from this mailbox and convert them to tickets
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  
                  {updateForm.watch("useImapPolling") && (
                    <div className="space-y-4 border rounded-md p-4">
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={updateForm.control}
                          name="imapHost"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>IMAP Host</FormLabel>
                              <FormControl>
                                <Input placeholder="imap.gmail.com" value={field.value || ''} onChange={field.onChange} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={updateForm.control}
                          name="imapPort"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>IMAP Port</FormLabel>
                              <FormControl>
                                <Input placeholder="993" value={field.value || ''} onChange={field.onChange} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <FormField
                        control={updateForm.control}
                        name="imapSecure"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">
                                Use SSL/TLS for IMAP
                              </FormLabel>
                              <FormDescription>
                                Enable secure connection for email polling
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={updateForm.control}
                        name="imapUser"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>IMAP Username</FormLabel>
                            <FormControl>
                              <Input placeholder="your.email@gmail.com" value={field.value || ''} onChange={field.onChange} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={updateForm.control}
                        name="imapPassword"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>IMAP Password</FormLabel>
                            <FormControl>
                              <Input type="password" placeholder="••••••••" value={field.value || ''} onChange={field.onChange} />
                            </FormControl>
                            <FormDescription>
                              For Gmail, use an app password instead of your regular password
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={updateDeskMutation.isPending}>
                  {updateDeskMutation.isPending ? "Updating..." : "Update Desk"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Desk Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Delete Support Desk</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this support desk? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-gray-100 p-3 rounded-md">
            <p className="font-medium">{currentDesk?.name}</p>
            <p className="text-sm text-gray-500">{currentDesk?.email}</p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => currentDesk && deleteDeskMutation.mutate(currentDesk.id)}
              disabled={deleteDeskMutation.isPending}
            >
              {deleteDeskMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Smooth User Assignment Dialog */}
      <UserAssignmentDialog
        isOpen={userAssignmentOpen}
        onClose={() => setUserAssignmentOpen(false)}
        desk={selectedDeskForUsers}
      />
    </div>
  );
}