import { useState, useEffect } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Desk } from "@shared/schema";

const newTicketSchema = z.object({
  customerName: z.string().min(2, "Name must be at least 2 characters"),
  customerEmail: z.string().email("Must be a valid email address"),
  subject: z.string().min(2, "Subject must be at least 2 characters"),
  message: z.string().min(10, "Message must be at least 10 characters"),
  sendEmail: z.boolean().default(true),
  deskId: z.number().optional()
});

type NewTicketFormData = z.infer<typeof newTicketSchema>;

interface NewTicketFormProps {
  onSuccess: () => void;
  selectedDeskId?: number | null;
}

export default function NewTicketForm({ onSuccess, selectedDeskId }: NewTicketFormProps) {
  const { toast } = useToast();
  const [isSending, setIsSending] = useState(false);
  
  // Fetch user's desks
  const { data: userDesks = [] } = useQuery<Desk[]>({
    queryKey: ["/api/user/desks"],
    queryFn: async () => {
      const response = await fetch("/api/user/desks");
      if (!response.ok) throw new Error("Failed to fetch user desks");
      return response.json();
    }
  });
  
  const form = useForm<NewTicketFormData>({
    resolver: zodResolver(newTicketSchema),
    defaultValues: {
      customerName: "",
      customerEmail: "",
      subject: "",
      message: "",
      sendEmail: true,
      deskId: selectedDeskId || (userDesks.length > 0 ? userDesks[0].id : undefined)
    },
  });

  // Update the deskId when selectedDeskId changes
  useEffect(() => {
    if (selectedDeskId) {
      form.setValue('deskId', selectedDeskId);
    }
  }, [selectedDeskId, form]);

  const createTicketMutation = useMutation({
    mutationFn: async (data: NewTicketFormData) => {
      const res = await apiRequest("POST", "/api/tickets/create", data);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to create ticket");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Ticket created successfully",
      });
      form.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      onSuccess();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  function onSubmit(data: NewTicketFormData) {
    setIsSending(true);
    createTicketMutation.mutate(data);
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <h2 className="text-xl font-semibold mb-6">Create New Ticket</h2>
      
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="customerName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Customer Name</FormLabel>
                  <FormControl>
                    <Input placeholder="John Smith" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="customerEmail"
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
          </div>
          
          <FormField
            control={form.control}
            name="subject"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Subject</FormLabel>
                <FormControl>
                  <Input placeholder="Order status inquiry" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="message"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Message</FormLabel>
                <FormControl>
                  <Textarea 
                    placeholder="Please provide details about your inquiry..." 
                    rows={5}
                    {...field} 
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="deskId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Select Desk</FormLabel>
                <Select
                  onValueChange={(value) => field.onChange(parseInt(value))}
                  defaultValue={field.value?.toString()}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a desk" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {userDesks.map((desk) => (
                      <SelectItem key={desk.id} value={desk.id.toString()}>
                        {desk.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="sendEmail"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                <FormControl>
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={field.onChange}
                    className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
                  />
                </FormControl>
                <FormLabel className="text-sm font-normal">
                  Send confirmation email to customer
                </FormLabel>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <div className="flex justify-end mt-6">
            <Button 
              type="submit" 
              className="w-full md:w-auto"
              disabled={createTicketMutation.isPending || isSending}
            >
              {(createTicketMutation.isPending || isSending) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Create Ticket
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}