import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from 'lucide-react';

interface LoginGuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogin: () => void;
}

export function LoginGuideDialog({ open, onOpenChange, onLogin }: LoginGuideDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Session Expired</DialogTitle>
          <DialogDescription>
            Your session has expired. You need to log in again to view ticket conversations.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <h4 className="text-sm font-medium text-slate-800">Login with your credentials</h4>
              <p className="text-xs text-slate-500">
                Use username "admin" and password "password123" for the demo account
              </p>
            </div>
          </div>
          
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <h4 className="text-sm font-medium text-slate-800">You'll be redirected back</h4>
              <p className="text-xs text-slate-500">
                After logging in, you'll be automatically taken back to the conversation you were viewing
              </p>
            </div>
          </div>
          
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <h4 className="text-sm font-medium text-slate-800">Sessions expire after inactivity</h4>
              <p className="text-xs text-slate-500">
                For security reasons, your session will expire after a period of inactivity
              </p>
            </div>
          </div>
        </div>
        
        <DialogFooter className="sm:justify-center">
          <Button type="button" onClick={onLogin} className="w-full sm:w-auto">
            Log in now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}