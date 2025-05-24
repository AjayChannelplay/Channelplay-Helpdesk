import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth, loginSchema } from "@/hooks/use-auth";
import { Redirect, useLocation } from "wouter";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
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
import { Loader2, Mail, Building } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

interface DeskInfo {
  id: number;
  name: string;
  email: string;
}

interface EmailCheckInfo {
  email: string;
  username: string;
  userId: number;
  desks: DeskInfo[];
}

export default function AuthPage() {
  const { user, loginMutation } = useAuth();
  const [location] = useLocation();
  const [emailCheckInfo, setEmailCheckInfo] = useState<EmailCheckInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Parse URL parameters
  const params = new URLSearchParams(window.location.search);
  const emailParam = params.get('email');
  const sourceParam = params.get('source');
  const errorParam = params.get('error');
  
  // Check if we have email info in the session
  useEffect(() => {
    if (sourceParam === 'direct_link' && emailParam) {
      setIsLoading(true);
      
      // Fetch the email check info from the session
      apiRequest('GET', '/api/session/email-check')
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            if (data && data.email) {
              setEmailCheckInfo(data);
              // Pre-fill the email field
              loginForm.setValue('email', data.email || '');
            }
          } else {
            // Handle error
            setError('Could not retrieve desk information. Please log in normally.');
          }
        })
        .catch((err) => {
          console.error('Error fetching email check info:', err);
          setError('Error connecting to server. Please try again later.');
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [emailParam, sourceParam]);
  
  // Login form
  const loginForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: emailParam || "",
      password: "",
    },
  });

  const onLoginSubmit = (values: z.infer<typeof loginSchema>) => {
    loginMutation.mutate(values);
  };
  
  // Redirect immediately if user is already logged in
  if (user) {
    window.location.href = '/';
    return <div>Redirecting to dashboard...</div>;
  }
  
  // For fixed credentials system - no verification checks needed
  
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
          <p className="text-slate-500 mt-2">Customer service ticket management</p>
        </div>
        
        {/* Display error from URL parameter if any */}
        {errorParam && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              {errorParam === 'email_not_found' 
                ? 'Email address not found in our system.' 
                : errorParam === 'server_error'
                ? 'Server error occurred. Please try again later.'
                : 'An error occurred. Please try again.'}
            </AlertDescription>
          </Alert>
        )}
        
        {/* Display desk information if available */}
        {sourceParam === 'direct_link' && emailParam && emailCheckInfo && (
          <Card className="mb-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-md">User Information</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex items-center mb-2">
                <Mail className="h-4 w-4 mr-2 text-muted-foreground" />
                <span className="text-sm">{emailCheckInfo.email}</span>
              </div>
              {emailCheckInfo.desks && emailCheckInfo.desks.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Assigned Desks:</p>
                  <div className="flex flex-wrap gap-2">
                    {emailCheckInfo.desks.map(desk => (
                      <Badge key={desk.id} variant="outline" className="flex items-center">
                        <Building className="h-3 w-3 mr-1" />
                        {desk.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Agent Login</CardTitle>
            <CardDescription>
              {sourceParam === 'direct_link' && emailParam
                ? 'Please enter your password to log in'
                : 'Sign in to access the customer support dashboard'}
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <Form {...loginForm}>
                <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-4">
                  <FormField
                    control={loginForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input 
                            type="email"
                            placeholder="Enter your email address" 
                            {...field} 
                            disabled={sourceParam === 'direct_link' && !!emailCheckInfo}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={loginForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="Enter your password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="flex items-center justify-end mb-4">
                    <Button variant="link" className="p-0 h-auto text-sm" asChild>
                      <a href="/forgot-password">Forgot your password?</a>
                    </Button>
                  </div>
                  
                  <Button 
                    type="submit" 
                    className="w-full" 
                    disabled={loginMutation.isPending}
                  >
                    {loginMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 
                        Logging in...
                      </>
                    ) : (
                      "Sign In"
                    )}
                  </Button>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
        
        <div className="text-center mt-6 text-sm text-slate-500">
          <p>Need access? Contact your system administrator.</p>
          <div className="mt-2">
            <p className="mb-2">Need help accessing your account? Contact your system administrator.</p>
            {/* Demo credentials removed */}
          </div>
        </div>
      </div>
    </div>
  );
}
