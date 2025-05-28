import { createContext, ReactNode, useContext } from "react";
import {
  useQuery,
  useMutation,
  UseMutationResult,
} from "@tanstack/react-query";
import { insertUserSchema, User as SelectUser, InsertUser } from "../shared/schema";
import { getQueryFn, apiRequest, queryClient } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";

type AuthContextType = {
  user: SelectUser | null;
  isLoading: boolean;
  error: Error | null;
  loginMutation: UseMutationResult<SelectUser, Error, LoginData>;
  logoutMutation: UseMutationResult<void, Error, void>;
  registerMutation: UseMutationResult<SelectUser, Error, RegisterData>;
};

type LoginData = {
  email: string;
  password: string;
};

export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = insertUserSchema.extend({
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type RegisterData = z.infer<typeof registerSchema>;

export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const {
    data: user,
    error,
    isLoading,
  } = useQuery<SelectUser | null, Error>({
    queryKey: ["/api/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginData) => {
      try {
        // Save email in case of verification error
        const email = credentials.email;
        sessionStorage.setItem('loginAttemptEmail', email);
        
        const res = await apiRequest("POST", "/api/login", credentials);
        
        // apiRequest will handle 403 verification errors
        // and throw appropriate error messages
        
        return await res.json();
      } catch (error) {
        // Let the error propagate to onError handler
        throw error;
      }
    },
    onSuccess: (data: any) => {
      console.log('Login success data:', data);
      
      // Check if user needs to set up their account (first time login with temporary password)
      if (data.requiresSetup) {
        // Save user data for the setup page
        sessionStorage.setItem('setupUserData', JSON.stringify(data.user));
        
        // Redirect to first-time setup page
        window.location.href = '/first-time-setup';
        
        toast({
          title: "Password Change Required",
          description: "Please set a new password for your account",
        });
        return;
      }
      
      // Normal login success case - handle navigation more carefully for cookies
      queryClient.setQueryData(["/api/user"], data);
      
      // Use query invalidation to force a refetch of user data with cookies
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      
      // For cross-origin cookie handling, avoid using window.location redirect
      // Instead, use history.pushState which keeps the same document context
      // This helps preserve cookies better in cross-origin scenarios
      window.history.pushState({}, "", "/");
      
      // Dispatch a navigation event so React router catches the change
      window.dispatchEvent(new Event('popstate'));
      
      toast({
        title: "Login successful",
        description: `Welcome back, ${data.name}!`,
      });
    },
    onError: (error: Error, variables) => {
      console.log("Login error:", error.message);
      
      // For fixed credentials system - no verification redirects
      // All login errors are treated as invalid credentials
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (credentials: RegisterData) => {
      // Remove the confirmPassword field before sending to the API
      const { confirmPassword, ...userData } = credentials;
      const res = await apiRequest("POST", "/api/register", userData);
      return await res.json();
    },
    onSuccess: (user: SelectUser) => {
      queryClient.setQueryData(["/api/user"], user);
      toast({
        title: "Registration successful",
        description: `Welcome, ${user.name}!`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/logout");
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/user"], null);
      toast({
        title: "Logged out",
        description: "You have been successfully logged out.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Logout failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading,
        error,
        loginMutation,
        logoutMutation,
        registerMutation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
