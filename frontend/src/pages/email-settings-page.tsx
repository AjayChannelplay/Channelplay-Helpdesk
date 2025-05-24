import * as React from 'react';
import EmailConfiguration from '@/components/settings/email-configuration';
import { Button } from '@/components/ui/button';
import { useLocation } from 'wouter';
import { ChevronLeft, Settings } from 'lucide-react';


export default function EmailSettingsPage() {
  // useLocation returns [currentLocation, navigateFunction]
  const [, navigate] = useLocation();
  
  return (
    <div className="container mx-auto py-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/')}
            className="mr-2"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <h1 className="text-2xl font-bold">Email Configuration</h1>
        </div>
        <div className="flex items-center space-x-2">
          <Settings className="h-5 w-5 text-muted-foreground" />
          <span className="text-muted-foreground">Admin Settings</span>
        </div>
      </div>
      
      <EmailConfiguration />
    </div>
  );
}
