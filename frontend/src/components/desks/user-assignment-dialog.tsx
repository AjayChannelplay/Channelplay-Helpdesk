import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Plus, X, Users, UserPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  role: string;
}

interface Desk {
  id: number;
  name: string;
  email: string;
}

interface UserAssignmentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  desk: Desk | null;
}

export default function UserAssignmentDialog({ isOpen, onClose, desk }: UserAssignmentDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [optimisticAssigned, setOptimisticAssigned] = useState<number[]>([]);
  const [optimisticAvailable, setOptimisticAvailable] = useState<User[]>([]);

  // Fetch all users
  const { data: allUsers = [], isLoading: isLoadingUsers } = useQuery<User[]>({
    queryKey: ['/api/users'],
    enabled: isOpen && !!desk,
  });

  // Fetch assigned users for this desk
  const { data: assignedUsers = [], isLoading: isLoadingAssigned, refetch: refetchAssigned } = useQuery<User[]>({
    queryKey: ['/api/desks', desk?.id, 'users'],
    enabled: isOpen && !!desk,
    queryFn: () => apiRequest(`/api/desks/${desk!.id}/users`, 'GET'),
  });

  // Update optimistic state when real data loads
  useEffect(() => {
    if (assignedUsers.length > 0) {
      setOptimisticAssigned(assignedUsers.map(u => u.id));
    }
    if (allUsers.length > 0 && assignedUsers.length >= 0) {
      const assignedIds = assignedUsers.map(u => u.id);
      setOptimisticAvailable(allUsers.filter(u => !assignedIds.includes(u.id) && u.role !== 'admin'));
    }
  }, [assignedUsers, allUsers]);

  // Add user mutation with optimistic updates
  const addUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest(`/api/desks/${desk!.id}/users`, 'POST', { userId });
    },
    onMutate: async (userId: number) => {
      // Optimistically update UI
      const user = allUsers.find(u => u.id === userId);
      if (user) {
        setOptimisticAssigned(prev => [...prev, userId]);
        setOptimisticAvailable(prev => prev.filter(u => u.id !== userId));
      }
    },
    onSuccess: () => {
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ['/api/desks', desk!.id, 'users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({
        title: "Success",
        description: "User assigned to desk successfully",
      });
    },
    onError: (error, userId) => {
      // Revert optimistic update
      const user = allUsers.find(u => u.id === userId);
      if (user) {
        setOptimisticAssigned(prev => prev.filter(id => id !== userId));
        setOptimisticAvailable(prev => [...prev, user]);
      }
      toast({
        title: "Error",
        description: "Failed to assign user to desk",
        variant: "destructive",
      });
    },
  });

  // Remove user mutation with optimistic updates
  const removeUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest(`/api/desks/${desk!.id}/users/${userId}`, 'DELETE');
    },
    onMutate: async (userId: number) => {
      // Optimistically update UI
      const user = allUsers.find(u => u.id === userId);
      if (user) {
        setOptimisticAssigned(prev => prev.filter(id => id !== userId));
        setOptimisticAvailable(prev => [...prev, user]);
      }
    },
    onSuccess: () => {
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ['/api/desks', desk!.id, 'users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({
        title: "Success",
        description: "User removed from desk successfully",
      });
    },
    onError: (error, userId) => {
      // Revert optimistic update
      const user = allUsers.find(u => u.id === userId);
      if (user) {
        setOptimisticAssigned(prev => [...prev, userId]);
        setOptimisticAvailable(prev => prev.filter(u => u.id !== userId));
      }
      toast({
        title: "Error",
        description: "Failed to remove user from desk",
        variant: "destructive",
      });
    },
  });

  const handleAddUser = (userId: number) => {
    addUserMutation.mutate(userId);
  };

  const handleRemoveUser = (userId: number) => {
    removeUserMutation.mutate(userId);
  };

  const assignedUserObjects = allUsers.filter(u => optimisticAssigned.includes(u.id));

  if (!desk) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Manage Users for "{desk.name}"
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="assigned" className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-2 flex-shrink-0">
            <TabsTrigger value="assigned" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Assigned Users ({optimisticAssigned.length})
            </TabsTrigger>
            <TabsTrigger value="available" className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Available Users ({optimisticAvailable.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="assigned" className="flex-1 overflow-auto mt-4">
            {isLoadingAssigned || isLoadingUsers ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="ml-2">Loading assigned users...</span>
              </div>
            ) : assignedUserObjects.length === 0 ? (
              <div className="text-center py-12">
                <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No users assigned to this desk</p>
              </div>
            ) : (
              <div className="space-y-3">
                {assignedUserObjects.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-4 bg-secondary/50 rounded-lg border border-secondary transition-all duration-200 hover:bg-secondary/70"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-primary/10 text-primary font-medium">
                          {user.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{user.name}</p>
                        <p className="text-sm text-muted-foreground">{user.email}</p>
                      </div>
                      <Badge variant="outline" className="ml-2">
                        {user.role === 'admin' ? 'Administrator' : 'Agent'}
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveUser(user.id)}
                      disabled={removeUserMutation.isPending}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      {removeUserMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="available" className="flex-1 overflow-auto mt-4">
            {isLoadingUsers ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="ml-2">Loading available users...</span>
              </div>
            ) : optimisticAvailable.length === 0 ? (
              <div className="text-center py-12">
                <UserPlus className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">All users are already assigned to this desk</p>
              </div>
            ) : (
              <div className="space-y-3">
                {optimisticAvailable.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-4 bg-muted/50 rounded-lg border border-muted transition-all duration-200 hover:bg-muted/70"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-primary/10 text-primary font-medium">
                          {user.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{user.name}</p>
                        <p className="text-sm text-muted-foreground">{user.email}</p>
                      </div>
                      <Badge variant="outline" className="ml-2">
                        {user.role === 'admin' ? 'Administrator' : 'Agent'}
                      </Badge>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAddUser(user.id)}
                      disabled={addUserMutation.isPending}
                      className="hover:bg-primary hover:text-primary-foreground"
                    >
                      {addUserMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="flex justify-end pt-4 border-t flex-shrink-0">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}