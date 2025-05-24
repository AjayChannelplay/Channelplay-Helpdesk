import React, { useState } from 'react';
import { X, Plus, Mail } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { decodeSRSEmail } from '@/lib/email-utils';

interface CCRecipientsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipients: string[];
  onAddRecipient: (email: string) => void;
  onRemoveRecipient: (email: string) => void;
}

export function CCRecipientsDialog({
  open,
  onOpenChange,
  recipients,
  onAddRecipient,
  onRemoveRecipient
}: CCRecipientsDialogProps) {
  const [newEmail, setNewEmail] = useState('');

  const handleAddRecipient = () => {
    if (newEmail.trim() && validateEmail(newEmail)) {
      onAddRecipient(newEmail.trim());
      setNewEmail('');
    }
  };

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  // Extract just the email part from a formatted email string
  const extractEmailAddress = (fullEmail: string): string => {
    // Case 1: SRS encoded emails
    if (fullEmail.includes('SRS=')) {
      const decoded = decodeSRSEmail(fullEmail);
      return decoded.email.toLowerCase().trim();
    }
    
    // Case 2: Standard "Name <email>" format
    if (fullEmail.includes('<') && fullEmail.includes('>')) {
      const match = fullEmail.match(/<([^>]+)>/);
      if (match && match[1]) {
        return match[1].toLowerCase().trim();
      }
    }
    
    // Case 3: Just plain email
    return fullEmail.toLowerCase().trim();
  };

  // Format email for display
  const formatEmailForDisplay = (email: string) => {
    if (email.includes('SRS=')) {
      const decoded = decodeSRSEmail(email);
      if (decoded.name) {
        return (
          <>
            <span className="font-medium">{decoded.name}</span>
            <span className="text-slate-500 ml-1">&lt;{decoded.email}&gt;</span>
          </>
        );
      }
      return decoded.email;
    }
    
    // Handle standard email formats
    if (email.includes('<') && email.includes('>')) {
      const match = email.match(/(.+)\s+<(.+)>/);
      if (match) {
        return (
          <>
            <span className="font-medium">{match[1].trim()}</span>
            <span className="text-slate-500 ml-1">&lt;{match[2]}&gt;</span>
          </>
        );
      }
    }
    return email;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <Mail className="h-4 w-4 mr-2" />
            CC Recipients {recipients.length > 0 && `(${recipients.length})`}
          </DialogTitle>
        </DialogHeader>
        
        <div className="py-4">
          {/* List of current CC recipients */}
          <div className="mb-4 border rounded-md p-2 bg-slate-50">
            {recipients.length === 0 ? (
              <p className="text-sm text-slate-500 p-2">No CC recipients added</p>
            ) : (
              <div className="space-y-2">
                {recipients.map((email, index) => (
                  <div 
                    key={index} 
                    className="flex items-center justify-between bg-white border border-slate-200 rounded p-2 text-sm"
                  >
                    <div className="truncate">{formatEmailForDisplay(email)}</div>
                    <button
                      type="button"
                      onClick={() => {
                        console.log('Dialog: Removing CC recipient:', email);
                        // Always pass the unmodified original email string for removal
                        onRemoveRecipient(email);
                      }}
                      className="text-slate-400 hover:text-red-500 focus:outline-none ml-2 flex-shrink-0"
                      aria-label={`Remove ${email}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* Add new CC recipient */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-slate-700">Add New Recipient</h3>
            <div className="flex items-center gap-2">
              <Input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Enter email address"
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddRecipient();
                  }
                }}
              />
              <Button 
                onClick={handleAddRecipient}
                disabled={!newEmail.trim() || !validateEmail(newEmail)}
                type="button"
                size="sm"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </div>
        </div>
        
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}