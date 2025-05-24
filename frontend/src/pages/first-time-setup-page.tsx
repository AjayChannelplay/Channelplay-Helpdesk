import { useForm } from "react-hook-form";
import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { Redirect, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

// Setup schema for first-time users to change their password
const setupSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(1, "Confirm password is required"),
}).refine(data => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type SetupFormData = z.infer<typeof setupSchema>;

export default function FirstTimeSetupPage() {
  const { user, isLoading, logoutMutation } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  
  // Retrieve user data from session storage if available
  const setupUserDataStr = sessionStorage.getItem('setupUserData');
  const setupUserData = setupUserDataStr ? JSON.parse(setupUserDataStr) : null;
  
  // Combine auth context user with setup user data
  const currentUser = user || setupUserData;
  
  // Setup form
  const setupForm = useForm<SetupFormData>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });
  
  // Log form errors to help with debugging
  useEffect(() => {
    const subscription = setupForm.watch(() => {
      if (Object.keys(setupForm.formState.errors).length > 0) {
        console.log('Form validation errors:', setupForm.formState.errors);
      }
    });
    return () => subscription.unsubscribe();
  }, [setupForm]);

  const setupMutation = useMutation({
    mutationFn: async (data: SetupFormData) => {
      if (!currentUser) {
        throw new Error("User information not found");
      }
      
      console.log('Starting password change request with user:', {
        userId: currentUser.id,
        currentPasswordLength: data.currentPassword.length,
        newPasswordLength: data.newPassword.length
      });
      
      // Send to the change-password endpoint
      try {
        const res = await apiRequest("POST", "/api/change-password", {
          userId: currentUser.id,
          currentPassword: data.currentPassword,
          newPassword: data.newPassword
        });
        console.log('Password change API response status:', res.status);
        const responseData = await res.json();
        console.log('Password change API response:', responseData);
        return responseData;
      } catch (error) {
        console.error('Error during password change API call:', error);
        throw error;
      }
    },
    onSuccess: (data) => {
      // After changing password, user will need to verify with OTP
      if (data.requiresVerification) {
        // Save username for verification page
        sessionStorage.setItem('pendingVerification', data.username);
        
        // Clear setup data as it's no longer needed
        sessionStorage.removeItem('setupUserData');
        
        // Redirect to OTP verification
        toast({
          title: "Password changed",
          description: "Please verify your account with the code sent to your email.",
        });
        navigate("/otp-verification");
      } else {
        // Standard success case
        queryClient.invalidateQueries({ queryKey: ["/api/user"] });
        toast({
          title: "Setup complete",
          description: "Your password has been updated successfully.",
        });
        navigate("/");
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Setup failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSetupSubmit = (values: SetupFormData) => {
    console.log('Submitting password form with values:', {
      currentPasswordLength: values.currentPassword.length,
      newPasswordLength: values.newPassword.length,
      confirmPasswordLength: values.confirmPassword.length,
      passwordsMatch: values.newPassword === values.confirmPassword
    });
    
    console.log('Submitting password setup:', {
      userId: currentUser?.id,
      username: currentUser?.username,
      currentPasswordLength: values.currentPassword.length,
      passwordLength: values.newPassword.length 
    });
    
    setupMutation.mutate(values);
  };
  
  // Show loading state while checking auth
  if (isLoading && !setupUserData) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  // Redirect if not logged in and no setup data
  if (!currentUser) {
    return <Redirect to="/auth" />;
  }
  
  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-slate-50">
      <div className="w-full max-w-md">
        {/* Logo Section */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-100 text-primary-600 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-10 h-10 fill-primary-600">
              <path d="M21 8a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1.062A8.001 8.001 0 0 1 12 23v-2a6 6 0 0 0 6-6V9A6 6 0 1 0 6 9v7H3a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h1.062a8.001 8.001 0 0 1 15.876 0H21ZM7.76 15.785l1.06-1.696A5.972 5.972 0 0 0 12 15a5.972 5.972 0 0 0 3.18-.911l1.06 1.696A7.963 7.963 0 0 1 12 17a7.963 7.963 0 0 1-4.24-1.215Z"></path>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-800">SupportDesk</h1>
          <p className="text-slate-500 mt-2">First-time Setup</p>
        </div>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Set Your Password</CardTitle>
            <CardDescription>
              Welcome {currentUser?.name}! Since this is your first time logging in, please set a new password for your account.
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            <Form {...setupForm}>
              <form onSubmit={setupForm.handleSubmit(onSetupSubmit)} className="space-y-4">
                <FormField
                  control={setupForm.control}
                  name="currentPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Temporary Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Enter your temporary password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={setupForm.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Create a new password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={setupForm.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Confirm your new password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <Button 
                  type="submit" 
                  className="w-full mt-6" 
                  disabled={setupMutation.isPending}
                >
                  {setupMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 
                      Setting up...
                    </>
                  ) : (
                    "Complete Setup"
                  )}
                </Button>
                
                <div className="mt-4 flex justify-between">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => {
                      // Perform full logout
                      logoutMutation.mutate();
                      // Clear any session storage
                      sessionStorage.removeItem('setupUserData');
                      sessionStorage.removeItem('pendingVerification');
                      sessionStorage.removeItem('loginAttemptUsername');
                      sessionStorage.removeItem('autoOtpSent');
                      // Redirect to login page
                      navigate('/auth');
                    }}
                    className="flex items-center"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Logout
                  </Button>
                  
                  <Button 
                    type="button" 
                    variant="link" 
                    onClick={() => {
                      // Clear session storage
                      sessionStorage.removeItem('setupUserData');
                      // Redirect to login page
                      navigate('/auth');
                    }}
                  >
                    Return to Login
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
