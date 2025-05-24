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
import { Switch } from "@/components/ui/switch";

import { Desk } from "@shared/schema";

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
    .default(true),
  smtpHost: z
    .string()
    .min(1, { message: "SMTP host is required" })
    .or(z.literal('')),
  smtpPort: z
    .string()
    .min(1, { message: "SMTP port is required" })
    .or(z.literal('')),
  smtpSecure: z
    .boolean()
    .default(true),
  smtpUser: z
    .string()
    .min(1, { message: "SMTP username is required" })
    .or(z.literal('')),
  smtpPassword: z
    .string()
    .min(1, { message: "SMTP password is required" })
    .or(z.literal('')),
  smtpFromName: z
    .string()
    .min(1, { message: "From name is required" })
    .or(z.literal('')),
  
  // IMAP Configuration
  imapHost: z
    .string()
    .min(1, { message: "IMAP host is required" })
    .or(z.literal('')),
  imapPort: z
    .string()
    .min(1, { message: "IMAP port is required" })
    .or(z.literal('')),
  imapSecure: z
    .boolean()
    .default(true),
  imapUser: z
    .string()
    .min(1, { message: "IMAP username is required" })
    .or(z.literal('')),
  imapPassword: z
    .string()
    .min(1, { message: "IMAP password is required" })
    .or(z.literal('')),
});

const updateDeskSchema = createDeskSchema.extend({
  id: z.number(),
});

type CreateDeskFormData = z.infer<typeof createDeskSchema>;
type UpdateDeskFormData = z.infer<typeof updateDeskSchema>;

type DeskManagementProps = {
  adminView?: boolean;
}

type User = {
  id: number;
  username: string;
  name: string;
  email: string;
  role: string;
};

export default function DeskManagement({ adminView = false }: DeskManagementProps) {
  const { toast } = useToast();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isAssignUsersModalOpen, setIsAssignUsersModalOpen] = useState(false);
  const [selectedDesk, setSelectedDesk] = useState<Desk | null>(null);
  const [assignedUsers, setAssignedUsers] = useState<number[]>([]);
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);

  // Form setup for creating a new desk
  const createForm = useForm<CreateDeskFormData>({
    resolver: zodResolver(createDeskSchema),
    defaultValues: {
      name: "",
      email: "",
      forwardingEmail: "",
      useDirectEmail: true,
      smtpHost: "",
      smtpPort: "587",
      smtpSecure: true,
      smtpUser: "",
      smtpPassword: "",
      smtpFromName: "",
      imapHost: "",
      imapPort: "993",
      imapSecure: true,
      imapUser: "",
      imapPassword: "",
    },
  });

  // Form setup for updating an existing desk
  const updateForm = useForm<UpdateDeskFormData>({
    resolver: zodResolver(updateDeskSchema),
    defaultValues: {
      id: 0,
      name: "",
      email: "",
      forwardingEmail: "",
      useDirectEmail: true,
      smtpHost: "",
      smtpPort: "",
      smtpSecure: true,
      smtpUser: "",
      smtpPassword: "",
      smtpFromName: "",
      imapHost: "",
      imapPort: "",
      imapSecure: true,
      imapUser: "",
      imapPassword: "",
    },
  });

  // Fetch desks from API
  const { data: desks, isLoading: isLoadingDesks, error: desksError } = useQuery({
    queryKey: ['/api/desks'],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch users for the assignment dialog
  const { data: users, isLoading: isLoadingUsers } = useQuery({
    queryKey: ['/api/users'],
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: adminView,
  });

  // Mutation for creating a new desk
  const createDeskMutation = useMutation({
    mutationFn: async (data: CreateDeskFormData) => {
      return apiRequest('/api/desks', 'POST', data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Desk created successfully.",
      });
      setIsCreateModalOpen(false);
      createForm.reset();
      queryClient.invalidateQueries({ queryKey: ['/api/desks'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: `Failed to create desk: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  // Mutation for updating an existing desk
  const updateDeskMutation = useMutation({
    mutationFn: async (data: UpdateDeskFormData) => {
      return apiRequest(`/api/desks/${data.id}`, 'PATCH', data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Desk updated successfully.",
      });
      setIsUpdateModalOpen(false);
      updateForm.reset();
      queryClient.invalidateQueries({ queryKey: ['/api/desks'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: `Failed to update desk: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  // Mutation for deleting a desk
  const deleteDeskMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/desks/${id}`, 'DELETE');
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Desk deleted successfully.",
      });
      setIsDeleteModalOpen(false);
      setSelectedDesk(null);
      queryClient.invalidateQueries({ queryKey: ['/api/desks'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: `Failed to delete desk: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  // Mutation for assigning users to a desk
  const assignUsersMutation = useMutation({
    mutationFn: async ({ deskId, userIds }: { deskId: number, userIds: number[] }) => {
      return apiRequest(`/api/desks/${deskId}/assign-users`, 'POST', { userIds });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Users assigned successfully.",
      });
      setIsAssignUsersModalOpen(false);
      setSelectedDesk(null);
      queryClient.invalidateQueries({ queryKey: ['/api/desks'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: `Failed to assign users: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  // Form submission handlers
  const onCreateSubmit = (data: CreateDeskFormData) => {
    createDeskMutation.mutate(data);
  };

  const onUpdateSubmit = (data: UpdateDeskFormData) => {
    updateDeskMutation.mutate(data);
  };

  // Action handlers
  const handleEditDesk = (desk: Desk) => {
    setSelectedDesk(desk);
    
    // Set default values for the update form
    updateForm.reset({
      id: desk.id,
      name: desk.name,
      email: desk.email,
      forwardingEmail: desk.forwardingEmail || "",
      useDirectEmail: desk.useDirectEmail ?? true,
      smtpHost: desk.smtpHost || "",
      smtpPort: desk.smtpPort || "",
      smtpSecure: desk.smtpSecure ?? true,
      smtpUser: desk.smtpUser || "",
      smtpPassword: desk.smtpPassword || "",
      smtpFromName: desk.smtpFromName || "",
      imapHost: desk.imapHost || "",
      imapPort: desk.imapPort || "",
      imapSecure: desk.imapSecure ?? true,
      imapUser: desk.imapUser || "",
      imapPassword: desk.imapPassword || "",
    });
    
    setIsUpdateModalOpen(true);
  };

  const handleManageUsers = (desk: Desk) => {
    setSelectedDesk(desk);
    
    // Fetch assigned users for this desk
    const fetchAssignedUsers = async () => {
      try {
        const response = await apiRequest(`/api/desks/${desk.id}/users`, 'GET');
        const assignedUserIds = response.map((user: User) => user.id);
        setAssignedUsers(assignedUserIds);
        
        // Filter out users who are already assigned
        if (users) {
          const available = users.filter((user: User) => 
            !assignedUserIds.includes(user.id) && user.role !== 'admin'
          );
          setAvailableUsers(available);
        }
      } catch (error) {
        toast({
          title: "Error",
          description: "Failed to fetch desk users.",
          variant: "destructive",
        });
      }
    };
    
    fetchAssignedUsers();
    setIsAssignUsersModalOpen(true);
  };

  const handleDeleteDesk = (desk: Desk) => {
    setSelectedDesk(desk);
    setIsDeleteModalOpen(true);
  };

  // Toggle a user's assignment to the selected desk
  const toggleUserAssignment = (userId: number) => {
    if (assignedUsers.includes(userId)) {
      setAssignedUsers(assignedUsers.filter(id => id !== userId));
    } else {
      setAssignedUsers([...assignedUsers, userId]);
    }
  };

  // Save user assignments
  const saveUserAssignments = () => {
    if (selectedDesk) {
      assignUsersMutation.mutate({
        deskId: selectedDesk.id,
        userIds: assignedUsers,
      });
    }
  };

  // Rendered content when loading
  if (isLoadingDesks) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold tracking-tight">Support Desks</h2>
        </div>
        <div className="animate-pulse space-y-2">
          <div className="h-10 bg-muted rounded w-full"></div>
          <div className="h-10 bg-muted rounded w-full"></div>
          <div className="h-10 bg-muted rounded w-full"></div>
        </div>
      </div>
    );
  }

  // Rendered content when there's an error
  if (desksError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          Failed to load support desks. Please try again later.
        </AlertDescription>
      </Alert>
    );
  }

  // Render the main component
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold tracking-tight">Support Desks</h2>
        {adminView && (
          <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
            <DialogTrigger asChild>
              <Button>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Desk
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Support Desk</DialogTitle>
                <DialogDescription>
                  Add a new support desk with a dedicated email address.
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
                            <Input placeholder="Enter desk name" {...field} />
                          </FormControl>
                          <FormDescription>
                            A descriptive name for this support desk.
                          </FormDescription>
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
                            <Input 
                              type="text" 
                              placeholder="support" 
                              {...field} 
                            />
                          </FormControl>
                          <FormDescription>
                            This email will be used for authentication (SMTP and IMAP) and as the from address for all helpdesk emails.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="border-t border-border my-6"></div>
                    <h3 className="text-lg font-medium mb-4">Email Configuration</h3>
                    <div className="space-y-6">
                      <FormField
                        control={createForm.control}
                        name="smtpHost"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>SMTP Host</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="smtp.example.com" 
                                {...field} 
                                value={field.value || ''}
                              />
                            </FormControl>
                            <FormDescription>
                              The hostname of your SMTP server (e.g., smtp.gmail.com).
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={createForm.control}
                          name="smtpPort"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>SMTP Port</FormLabel>
                              <FormControl>
                                <Input 
                                  placeholder="587" 
                                  {...field} 
                                  value={field.value || ''}
                                />
                              </FormControl>
                              <FormDescription>
                                Common ports: 587 (TLS) or 465 (SSL)
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={createForm.control}
                          name="smtpSecure"
                          render={({ field }) => (
                            <FormItem className="flex flex-col justify-end h-full pb-2">
                              <div className="flex items-center space-x-2">
                                <FormLabel>Use SSL/TLS</FormLabel>
                                <FormControl>
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                  />
                                </FormControl>
                              </div>
                              <FormDescription>
                                Enable for secure connections
                              </FormDescription>
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={createForm.control}
                        name="smtpUser"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>SMTP Username</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="username@example.com" 
                                {...field} 
                                value={field.value || ''}
                              />
                            </FormControl>
                            <FormDescription>
                              Usually the full email address
                            </FormDescription>
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
                              <Input 
                                type="password" 
                                placeholder="••••••••" 
                                value={field.value || ''}
                                onChange={(e) => field.onChange(e.target.value)}
                                onBlur={field.onBlur}
                                ref={field.ref}
                                name={field.name}
                              />
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
                              <Input 
                                placeholder="Support Team" 
                                {...field} 
                                value={field.value || ''}
                              />
                            </FormControl>
                            <FormDescription>
                              The name that will appear in the From field of emails.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="border-t border-border my-6"></div>
                    <h3 className="text-lg font-medium mb-4">IMAP Configuration</h3>
                    <div className="space-y-6">
                      <FormField
                        control={createForm.control}
                        name="imapHost"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>IMAP Host</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="imap.example.com" 
                                {...field} 
                                value={field.value || ''}
                              />
                            </FormControl>
                            <FormDescription>
                              The hostname of your IMAP server (e.g., imap.gmail.com).
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={createForm.control}
                          name="imapPort"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>IMAP Port</FormLabel>
                              <FormControl>
                                <Input 
                                  placeholder="993" 
                                  {...field} 
                                  value={field.value || ''}
                                />
                              </FormControl>
                              <FormDescription>
                                Common ports: 993 (SSL) or 143 (plain)
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={createForm.control}
                          name="imapSecure"
                          render={({ field }) => (
                            <FormItem className="flex flex-col justify-end h-full pb-2">
                              <div className="flex items-center space-x-2">
                                <FormLabel>Use SSL/TLS</FormLabel>
                                <FormControl>
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                  />
                                </FormControl>
                              </div>
                              <FormDescription>
                                Enable for secure connections
                              </FormDescription>
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={createForm.control}
                        name="imapUser"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>IMAP Username</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="username@example.com" 
                                {...field} 
                                value={field.value || ''}
                              />
                            </FormControl>
                            <FormDescription>
                              Usually the full email address
                            </FormDescription>
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
                              <Input 
                                type="password" 
                                placeholder="••••••••" 
                                value={field.value || ''}
                                onChange={(e) => field.onChange(e.target.value)}
                                onBlur={field.onBlur}
                                ref={field.ref}
                                name={field.name}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* Hidden field to always use direct email */}
                    <input type="hidden" {...createForm.register("useDirectEmail")} value="true" />
                  </div>
                  
                  <DialogFooter>
                    <Button 
                      type="submit" 
                      disabled={createDeskMutation.isPending}
                    >
                      {createDeskMutation.isPending ? "Creating..." : "Create Desk"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}
      </div>
      
      {desks && desks.length > 0 ? (
        <Table>
          <TableCaption>List of all support desks</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email Address</TableHead>
              <TableHead>Email Mode</TableHead>
              {adminView && <TableHead>Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {desks.map((desk: Desk) => (
              <TableRow key={desk.id}>
                <TableCell className="font-medium">{desk.name}</TableCell>
                <TableCell>{desk.email}</TableCell>
                <TableCell>
                  {desk.useDirectEmail ? (
                    <div className="flex items-center space-x-2">
                      <Server className="h-4 w-4 text-green-500" />
                      <span>Direct SMTP/IMAP</span>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-2">
                      <Mail className="h-4 w-4 text-yellow-500" />
                      <span>Mailgun</span>
                    </div>
                  )}
                </TableCell>
                {adminView && (
                  <TableCell>
                    <div className="flex space-x-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => handleEditDesk(desk)}
                      >
                        <Pencil className="h-4 w-4 mr-1" /> Edit
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => handleManageUsers(desk)}
                      >
                        <Users className="h-4 w-4 mr-1" /> Users
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => handleDeleteDesk(desk)}
                      >
                        <Trash2 className="h-4 w-4 mr-1" /> Delete
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <Inbox className="mx-auto h-10 w-10 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No Support Desks</h3>
              <p className="text-sm text-muted-foreground">
                There are no support desks created yet.
              </p>
              {adminView && (
                <Button 
                  className="mt-4" 
                  variant="outline" 
                  onClick={() => setIsCreateModalOpen(true)}
                >
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Create a desk
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Edit Desk Dialog */}
      <Dialog open={isUpdateModalOpen} onOpenChange={setIsUpdateModalOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Support Desk</DialogTitle>
            <DialogDescription>
              Update the settings for this support desk.
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
                        <Input {...field} />
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
                        <Input type="text" {...field} />
                      </FormControl>
                      <FormDescription>
                        This email will be used for authentication (SMTP and IMAP) and as the from address for all helpdesk emails.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="border-t border-border my-6"></div>
                <h3 className="text-lg font-medium mb-4">Email Configuration</h3>
                <div className="space-y-6">
                  <FormField
                    control={updateForm.control}
                    name="smtpHost"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>SMTP Host</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="smtp.example.com" 
                            {...field} 
                            value={field.value || ''}
                          />
                        </FormControl>
                        <FormDescription>
                          The hostname of your SMTP server (e.g., smtp.gmail.com).
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={updateForm.control}
                      name="smtpPort"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>SMTP Port</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="587" 
                              {...field} 
                              value={field.value || ''}
                            />
                          </FormControl>
                          <FormDescription>
                            Common ports: 587 (TLS) or 465 (SSL)
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={updateForm.control}
                      name="smtpSecure"
                      render={({ field }) => (
                        <FormItem className="flex flex-col justify-end h-full pb-2">
                          <div className="flex items-center space-x-2">
                            <FormLabel>Use SSL/TLS</FormLabel>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </div>
                          <FormDescription>
                            Enable for secure connections
                          </FormDescription>
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={updateForm.control}
                    name="smtpUser"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>SMTP Username</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="username@example.com" 
                            {...field} 
                            value={field.value || ''}
                          />
                        </FormControl>
                        <FormDescription>
                          Usually the full email address
                        </FormDescription>
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
                          <Input 
                            type="password" 
                            placeholder="••••••••" 
                            value={field.value || ''}
                            onChange={(e) => field.onChange(e.target.value)}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            name={field.name}
                          />
                        </FormControl>
                        <FormDescription>
                          Leave empty to keep the current password
                        </FormDescription>
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
                          <Input 
                            placeholder="Support Team" 
                            {...field} 
                            value={field.value || ''}
                          />
                        </FormControl>
                        <FormDescription>
                          The name that will appear in the From field of emails.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="border-t border-border my-6"></div>
                <h3 className="text-lg font-medium mb-4">IMAP Configuration</h3>
                <div className="space-y-6">
                  <FormField
                    control={updateForm.control}
                    name="imapHost"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>IMAP Host</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="imap.example.com" 
                            {...field} 
                            value={field.value || ''}
                          />
                        </FormControl>
                        <FormDescription>
                          The hostname of your IMAP server (e.g., imap.gmail.com).
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={updateForm.control}
                      name="imapPort"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>IMAP Port</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="993" 
                              {...field} 
                              value={field.value || ''}
                            />
                          </FormControl>
                          <FormDescription>
                            Common ports: 993 (SSL) or 143 (plain)
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={updateForm.control}
                      name="imapSecure"
                      render={({ field }) => (
                        <FormItem className="flex flex-col justify-end h-full pb-2">
                          <div className="flex items-center space-x-2">
                            <FormLabel>Use SSL/TLS</FormLabel>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </div>
                          <FormDescription>
                            Enable for secure connections
                          </FormDescription>
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={updateForm.control}
                    name="imapUser"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>IMAP Username</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="username@example.com" 
                            {...field} 
                            value={field.value || ''}
                          />
                        </FormControl>
                        <FormDescription>
                          Usually the full email address
                        </FormDescription>
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
                          <Input 
                            type="password" 
                            placeholder="••••••••" 
                            value={field.value || ''}
                            onChange={(e) => field.onChange(e.target.value)}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            name={field.name}
                          />
                        </FormControl>
                        <FormDescription>
                          Leave empty to keep the current password
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Hidden field to always use direct email */}
                <input type="hidden" {...updateForm.register("useDirectEmail")} value="true" />
                <input type="hidden" {...updateForm.register("id")} />
              </div>
              
              <DialogFooter>
                <Button 
                  type="submit" 
                  disabled={updateDeskMutation.isPending}
                >
                  {updateDeskMutation.isPending ? "Updating..." : "Update Desk"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      
      {/* Delete Desk Confirmation Dialog */}
      <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Support Desk</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this support desk?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="pt-4">
            {selectedDesk && (
              <div className="bg-muted p-4 rounded-md">
                <p><strong>Name:</strong> {selectedDesk.name}</p>
                <p><strong>Email:</strong> {selectedDesk.email}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => selectedDesk && deleteDeskMutation.mutate(selectedDesk.id)}
              disabled={deleteDeskMutation.isPending}
            >
              {deleteDeskMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Assign Users Dialog */}
      {adminView && (
        <Dialog open={isAssignUsersModalOpen} onOpenChange={setIsAssignUsersModalOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Manage Users</DialogTitle>
              <DialogDescription>
                Assign or remove users from this desk.
              </DialogDescription>
            </DialogHeader>
            
            {isLoadingUsers ? (
              <div className="py-4">Loading users...</div>
            ) : (
              <div className="py-4 max-h-[60vh] overflow-y-auto">
                {selectedDesk && (
                  <h3 className="font-medium mb-2">Desk: {selectedDesk.name}</h3>
                )}
                
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Assigned Users</h4>
                  {assignedUsers.length > 0 ? (
                    <div className="space-y-2">
                      {users?.filter((user: User) => assignedUsers.includes(user.id))
                        .map((user: User) => (
                          <div key={user.id} className="flex justify-between items-center p-2 bg-secondary rounded-md">
                            <div>
                              <span className="font-medium">{user.name}</span>
                              <p className="text-xs text-muted-foreground">{user.email}</p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleUserAssignment(user.id)}
                            >
                              Remove
                            </Button>
                          </div>
                        ))
                      }
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No users assigned to this desk.</p>
                  )}
                  
                  <div className="pt-4">
                    <h4 className="text-sm font-medium text-muted-foreground">Available Users</h4>
                    {availableUsers.length > 0 ? (
                      <div className="space-y-2 mt-2">
                        {availableUsers.map((user: User) => (
                          <div key={user.id} className="flex justify-between items-center p-2 bg-muted rounded-md">
                            <div>
                              <span className="font-medium">{user.name}</span>
                              <p className="text-xs text-muted-foreground">{user.email}</p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleUserAssignment(user.id)}
                            >
                              Add
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground mt-2">No more users available.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
            
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsAssignUsersModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={saveUserAssignments}
                disabled={assignUsersMutation.isPending}
              >
                {assignUsersMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}