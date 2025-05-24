import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter
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
import { Loader2, KeyRound, MailCheck } from "lucide-react";

// Helper function to focus first input after render
function focusFirstInput(selector: string) {
  setTimeout(() => {
    const input = document.querySelector(selector) as HTMLInputElement;
    if (input) {
      input.focus();
    }
  }, 100);
}

// OTP verification schema
const otpSchema = z.object({
  username: z.string().min(1, "Username is required"),
  otp: z.string().min(1, "Verification code is required").length(6, "Verification code must be 6 digits"),
});

type OtpFormData = z.infer<typeof otpSchema>;

// New password schema after OTP verification
const passwordSchema = z.object({
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(1, "Confirm password is required"),
}).refine(data => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type PasswordFormData = z.infer<typeof passwordSchema>;

export default function OtpVerificationPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [verificationStep, setVerificationStep] = useState<'otp' | 'password'>('otp');
  const [userId, setUserId] = useState<number | null>(null);
  
  // Function to navigate programmatically
  const navigate = (path: string) => setLocation(path);
  
  // OTP verification form
  const otpForm = useForm<OtpFormData>({
    resolver: zodResolver(otpSchema),
    defaultValues: {
      username: "",
      otp: "",
    },
  });

  // New password form after OTP verification
  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
    mode: "onChange", // Validate on change instead of onBlur
  });
  
  // Resend OTP mutation
  const resendMutation = useMutation({
    mutationFn: async (username: string) => {
      const res = await apiRequest("POST", "/api/resend-otp", { username });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to resend code");
      }
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Code sent",
        description: "A new verification code has been sent to your email.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to send code",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  // OTP verification mutation
  const otpMutation = useMutation({
    mutationFn: async (data: OtpFormData) => {
      console.log('Attempting to verify OTP with data:', {
        username: data.username,
        otpLength: data.otp.length,
        otpFirstTwoDigits: data.otp.substring(0, 2) + '****'
      });
      
      try {
        const res = await apiRequest("POST", "/api/verify-otp", data);
        
        if (!res.ok) {
          // Get detailed error message
          const errorData = await res.json();
          console.error('OTP verification failed:', errorData);
          throw new Error(errorData.message || "Verification failed");
        }
        
        const jsonResponse = await res.json();
        console.log('OTP verification successful:', jsonResponse);
        return jsonResponse;
      } catch (error) {
        console.error('Error during OTP verification:', error);
        throw error;
      }
    },
    onSuccess: (data) => {
      toast({
        title: "Verification successful",
        description: "You've been authenticated and can now access the system.",
      });
      
      // Clear the pending verification from session storage
      sessionStorage.removeItem('pendingVerification');
      sessionStorage.removeItem('loginAttemptUsername');
      sessionStorage.removeItem('autoOtpSent');
      
      // If the user has a complete account, redirect to dashboard
      if (data.user) {
        navigate("/");
      } else {
        // If the user needs to complete setup, go to the password step
        setUserId(data.userId);
        setVerificationStep('password');
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Verification failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // New password mutation
  const passwordMutation = useMutation({
    mutationFn: async (data: PasswordFormData) => {
      if (!userId) throw new Error("User ID is missing");
      
      // Make sure passwords match before proceeding
      if (data.newPassword !== data.confirmPassword) {
        throw new Error("Passwords do not match");
      }
      
      if (data.newPassword.length < 6) {
        throw new Error("Password must be at least 6 characters");
      }
      
      console.log('Submitting password setup:', { userId, passwordLength: data.newPassword.length });
      
      try {
        // This endpoint now marks the user's account as fully set up
        const res = await apiRequest("POST", "/api/complete-setup", {
          userId,
          newPassword: data.newPassword
        });
        
        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.message || "Failed to complete setup");
        }
        return await res.json();
      } catch (error) {
        console.error('Error setting password:', error);
        throw error;
      }
    },
    onSuccess: () => {
      toast({
        title: "Setup complete",
        description: "Your password has been set. You can now log in with your new credentials.",
      });
      navigate("/auth");
    },
    onError: (error: Error) => {
      toast({
        title: "Setup failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // For fixed credentials system - redirect away from verification page
  useEffect(() => {
    // Clear any old verification session data to prevent unwanted redirects
    sessionStorage.removeItem('pendingVerification');
    sessionStorage.removeItem('loginAttemptUsername');
    sessionStorage.removeItem('autoOtpSent');
    
    // Redirect back to login page since we don't use verification anymore
    console.log('Redirecting from verification page to login - verification not needed for fixed credentials');
    // Use location.replace to avoid creating browser history entries that cause loops
    window.location.replace('/auth');
    
    if (verificationStep === 'otp') {
      // Focus on the OTP field for manual verification if someone accesses this page directly
      setTimeout(() => {
        const otpInput = document.querySelector('input[name="otp"]');
        if (otpInput) {
          (otpInput as HTMLInputElement).focus();
        }
      }, 100);
    } else if (verificationStep === 'password') {
      // Focus on the first password input when switching to password step
      focusFirstInput('input[name="newPassword"]');
    }
  }, [verificationStep, otpForm, resendMutation, toast]);

  // Form submission handlers
  const onOtpSubmit = (values: OtpFormData) => {
    // Ensure OTP is properly formatted (trimmed, no spaces)
    const cleanedValues = {
      ...values,
      otp: values.otp.trim(),
      username: values.username.trim()
    };
    
    console.log('Submitting OTP form with cleaned values:', {
      username: cleanedValues.username,
      otpLength: cleanedValues.otp.length,
      otpFirstTwoDigits: cleanedValues.otp.substring(0, 2) + '****'
    });
    
    otpMutation.mutate(cleanedValues);
  };

  const onPasswordSubmit = (values: PasswordFormData) => {
    console.log('Submitting password form with values:', {
      newPasswordLength: values.newPassword.length,
      confirmPasswordLength: values.confirmPassword.length,
      passwordsMatch: values.newPassword === values.confirmPassword
    });
    
    try {
      if (values.newPassword.length < 6) {
        toast({
          title: "Password too short",
          description: "Password must be at least 6 characters long",
          variant: "destructive"
        });
        return;
      }
      
      if (values.newPassword !== values.confirmPassword) {
        toast({
          title: "Passwords don't match",
          description: "The password and confirmation must match",
          variant: "destructive"
        });
        return;
      }
      
      passwordMutation.mutate(values);
    } catch (error) {
      console.error('Error in password submission:', error);
      toast({
        title: "Submission error",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive"
      });
    }
  };

  const handleResendOtp = () => {
    const username = otpForm.getValues().username;
    if (!username) {
      toast({
        title: "Username required",
        description: "Please enter your username to resend the verification code.",
        variant: "destructive",
      });
      return;
    }
    resendMutation.mutate(username);
  };

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
          <p className="text-slate-500 mt-2">
            {verificationStep === 'otp' ? 'Account Verification' : 'Create New Password'}
          </p>
        </div>
        
        {verificationStep === 'otp' ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Verify Your Account</CardTitle>
              <CardDescription>
                Enter the verification code sent to your email along with your username.
              </CardDescription>
            </CardHeader>
            
            <CardContent>
              <Form {...otpForm}>
                <form onSubmit={otpForm.handleSubmit(onOtpSubmit)} className="space-y-4">
                  <FormField
                    control={otpForm.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter your username" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={otpForm.control}
                    name="otp"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Verification Code</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="Enter 6-digit code" 
                            {...field} 
                            maxLength={6}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <Button 
                    type="submit" 
                    className="w-full mt-6" 
                    disabled={otpMutation.isPending}
                  >
                    {otpMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 
                        Verifying...
                      </>
                    ) : (
                      <>
                        <KeyRound className="mr-2 h-4 w-4" />
                        Verify Account
                      </>
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
            
            <CardFooter className="flex flex-col space-y-4">
              <div className="w-full text-center">
                <p className="text-sm text-slate-500 mb-2">Didn't receive a code?</p>
                <Button 
                  variant="outline" 
                  onClick={handleResendOtp}
                  disabled={resendMutation.isPending}
                  className="w-full"
                >
                  {resendMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 
                      Sending...
                    </>
                  ) : (
                    <>
                      <MailCheck className="mr-2 h-4 w-4" />
                      Resend Code
                    </>
                  )}
                </Button>
              </div>
              
              <div className="text-center w-full">
                <Button 
                  variant="link" 
                  onClick={() => navigate("/auth")}
                  className="text-sm"
                >
                  Back to Login
                </Button>
              </div>
            </CardFooter>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Create New Password</CardTitle>
              <CardDescription>
                Your account has been verified. Please set a new password to complete your setup.
              </CardDescription>
            </CardHeader>
            
            <CardContent>
              <Form {...passwordForm}>
                <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
                  <FormField
                    control={passwordForm.control}
                    name="newPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New Password</FormLabel>
                        <FormControl>
                          <input 
                            type="password" 
                            placeholder="Create a new password" 
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            value={field.value}
                            onChange={(e) => {
                              field.onChange(e);
                              passwordForm.setValue('newPassword', e.target.value);
                            }}
                            name={field.name}
                            onBlur={field.onBlur}
                            id="newPasswordField"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={passwordForm.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm Password</FormLabel>
                        <FormControl>
                          <input 
                            type="password" 
                            placeholder="Confirm your new password" 
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            value={field.value}
                            onChange={(e) => {
                              field.onChange(e);
                              passwordForm.setValue('confirmPassword', e.target.value);
                            }}
                            name={field.name}
                            onBlur={field.onBlur}
                            id="confirmPasswordField"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <Button 
                    type="submit" 
                    className="w-full mt-6" 
                    disabled={passwordMutation.isPending}
                  >
                    {passwordMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 
                        Setting password...
                      </>
                    ) : (
                      "Complete Setup"
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
