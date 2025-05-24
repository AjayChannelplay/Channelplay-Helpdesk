import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, Download, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";

export function ImportEmailsDialog() {
  const [open, setOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [credentials, setCredentials] = useState({
    host: "imap.gmail.com",
    port: "993",
    user: "",
    password: "",
    useSSL: true,
    deskId: null as number | null
  });
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleImport = async () => {
    if (!credentials.user || !credentials.password) {
      toast({
        title: "Missing Credentials",
        description: "Please enter your email and password (App Password for Gmail)",
        variant: "destructive",
      });
      return;
    }

    setIsImporting(true);
    
    try {
      console.log("Starting email import with credentials...");
      
      const response = await apiRequest('/api/email/import-now', {
        method: 'POST',
        body: JSON.stringify({
          imapHost: credentials.host,
          imapPort: parseInt(credentials.port),
          imapUser: credentials.user,
          imapPassword: credentials.password,
          imapSecure: credentials.useSSL,
          deskId: credentials.deskId
        })
      });

      if (response.success) {
        toast({
          title: "Emails Imported Successfully!",
          description: `Found and imported ${response.newTickets || 0} new tickets from ${response.emailsProcessed || 0} unread emails.`,
          duration: 8000,
        });
        
        // Refresh tickets list
        queryClient.invalidateQueries({ queryKey: ['/api/tickets'] });
        
        // Close dialog
        setOpen(false);
        
        // Reset form
        setCredentials({
          host: "imap.gmail.com",
          port: "993", 
          user: "",
          password: "",
          useSSL: true,
          deskId: null
        });
      } else {
        toast({
          title: "Import Failed",
          description: response.error || "Failed to import emails. Please check your credentials.",
          variant: "destructive",
          duration: 8000,
        });
      }
    } catch (error) {
      console.error('Email import error:', error);
      toast({
        title: "Import Error",
        description: "There was a problem importing emails. Please try again.",
        variant: "destructive",
        duration: 8000,
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Download className="h-4 w-4" />
          Import Emails
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Import Unread Emails
          </DialogTitle>
          <DialogDescription>
            Enter your email credentials to import all unread messages as tickets.
            For Gmail, use your App Password instead of your regular password.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="host" className="text-right">
              IMAP Host
            </Label>
            <Input
              id="host"
              value={credentials.host}
              onChange={(e) => setCredentials({...credentials, host: e.target.value})}
              className="col-span-3"
              placeholder="imap.gmail.com"
            />
          </div>
          
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="port" className="text-right">
              Port
            </Label>
            <Input
              id="port"
              value={credentials.port}
              onChange={(e) => setCredentials({...credentials, port: e.target.value})}
              className="col-span-3"
              placeholder="993"
            />
          </div>
          
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="user" className="text-right">
              Email
            </Label>
            <Input
              id="user"
              value={credentials.user}
              onChange={(e) => setCredentials({...credentials, user: e.target.value})}
              className="col-span-3"
              placeholder="your-email@gmail.com"
              type="email"
            />
          </div>
          
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="password" className="text-right">
              Password
            </Label>
            <Input
              id="password"
              value={credentials.password}
              onChange={(e) => setCredentials({...credentials, password: e.target.value})}
              className="col-span-3"
              placeholder="App Password (for Gmail)"
              type="password"
            />
          </div>
          
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="ssl" className="text-right">
              Use SSL/TLS
            </Label>
            <div className="col-span-3">
              <Switch
                id="ssl"
                checked={credentials.useSSL}
                onCheckedChange={(checked) => setCredentials({...credentials, useSSL: checked})}
              />
            </div>
          </div>
        </div>
        
        <DialogFooter>
          <Button 
            type="button" 
            variant="outline" 
            onClick={() => setOpen(false)}
            disabled={isImporting}
          >
            Cancel
          </Button>
          <Button 
            type="button" 
            onClick={handleImport}
            disabled={isImporting}
            className="gap-2"
          >
            {isImporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Import Now
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}