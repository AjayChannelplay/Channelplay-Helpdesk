import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function ExternalRedirect() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  
  useEffect(() => {
    // The server will handle the auth and redirect via 302,
    // but we'll add a client-side fallback just in case
    const timer = setTimeout(() => {
      // If we're still on this page after 3 seconds, show an error
      setStatus("error");
      setErrorMessage("Login process is taking longer than expected. Please try refreshing the page.");
    }, 3000);
    
    return () => clearTimeout(timer);
  }, [navigate]);
  
  return (
    <div className="container flex items-center justify-center min-h-screen">
      {status === "loading" ? (
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Authenticating</CardTitle>
            <CardDescription>
              Please wait while we're logging you in...
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-6">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
          </CardContent>
        </Card>
      ) : (
        <Alert variant="destructive" className="w-full max-w-md">
          <AlertTitle>Authentication Failed</AlertTitle>
          <AlertDescription>
            {errorMessage}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}