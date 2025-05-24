import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";

import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth-page";
import DashboardPage from "@/pages/dashboard-page";
import UserManagementPage from "@/pages/user-management-page";
import ForgotPasswordPage from "@/pages/forgot-password-page";
import FirstTimeSetupPage from "@/pages/first-time-setup-page";
import OtpVerificationPage from "@/pages/otp-verification-page";
import ExternalAccessPage from "@/pages/external-access-page";
import ExternalRedirect from "@/pages/external-redirect-page";
import HomePage from "@/pages/home-page";
import AdminPage from "@/pages/admin-page";
import { ProtectedRoute } from "./lib/protected-route";

function Router() {
  return (
    <Switch>
      <Route path="/auth" component={AuthPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password/:token" component={ForgotPasswordPage} />
      <Route path="/first-time-setup" component={FirstTimeSetupPage} />
      <Route path="/verify-account" component={AuthPage} />

      <Route path="/external" component={ExternalAccessPage} />
      <Route path="/external-redirect" component={ExternalRedirect} />
      <Route path="/access" component={ExternalRedirect} />
      <ProtectedRoute path="/users" component={UserManagementPage} adminOnly={true} />
      <ProtectedRoute path="/admin" component={AdminPage} adminOnly={true} />
      {/* Email settings route removed as requested */}
      <ProtectedRoute path="/" component={HomePage} />
      <ProtectedRoute path="/tickets" component={DashboardPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
