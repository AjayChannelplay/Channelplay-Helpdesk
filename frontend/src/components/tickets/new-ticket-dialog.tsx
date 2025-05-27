import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import NewTicketForm from "./new-ticket-form";

interface NewTicketDialogProps {
  deskId?: number;
  buttonVariant?: "default" | "outline" | "secondary" | "ghost" | "link" | "destructive";
  buttonSize?: "default" | "sm" | "lg" | "icon";
  buttonText?: string;
  fullWidth?: boolean;
  onSuccess?: () => void;
  children?: React.ReactNode;
}

export function NewTicketDialog({
  deskId,
  buttonVariant = "default",
  buttonSize = "default",
  buttonText = "New Ticket",
  fullWidth = false,
  onSuccess,
  children,
}: NewTicketDialogProps) {
  const [open, setOpen] = useState(false);

  const handleSuccess = () => {
    setOpen(false);
    if (onSuccess) {
      onSuccess();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ? (
          children
        ) : (
          <Button 
            variant={buttonVariant} 
            size={buttonSize}
            className={fullWidth ? "w-full" : ""}
          >
            <Plus className="h-4 w-4 mr-2" />
            {buttonText}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Create New Ticket</DialogTitle>
          <DialogDescription>
            Fill out the form below to create a new support ticket.
          </DialogDescription>
        </DialogHeader>
        <NewTicketForm onSuccess={handleSuccess} selectedDeskId={deskId} />
      </DialogContent>
    </Dialog>
  );
}
