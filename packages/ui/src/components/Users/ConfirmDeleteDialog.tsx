import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useState } from 'react';
import { toast } from 'react-toastify';
import { UserEntity } from '@/clients/api';
import { useMutation } from '@tanstack/react-query';
import { deleteUserMutation } from '@/clients/api/@tanstack/react-query.gen';

export type ConfirmDeleteUserDialogProps = {
  user: UserEntity;
  onClose: () => void;
};

export default function ConfirmDeleteUserDialog({
  user,
  onClose,
}: ConfirmDeleteUserDialogProps) {
  const [open, setOpen] = useState(true);
  const { mutateAsync: deleteUser, isPending: deletingUser } = useMutation({
    ...deleteUserMutation({}),
  });

  const handleClose = () => {
    setOpen(false);
    onClose();
  };

  const handleDelete = async () => {
    try {
      await deleteUser({
        path: {
          userId: user.id,
        },
      });

      toast.success(`User ${user.email} has been deleted.`);
      handleClose();
    } catch (error) {
      toast.error(
        `Failed to delete user ${user.email}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={deletingUser ? undefined : handleClose}
        aria-labelledby="confirm-delete-user-title"
        aria-describedby="confirm-delete-user-description"
        maxWidth="md"
      >
        <DialogTitle id="confirm-delete-user-title">
          Are you sure you want to delete{' '}
          <strong>
            {user.name} ({user.email})
          </strong>
          ?
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="confirm-delete-user-description">
            This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            disabled={deletingUser}
            variant="contained"
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button
            disabled={deletingUser}
            color="error"
            variant="contained"
            onClick={handleDelete}
            autoFocus
          >
            {deletingUser ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
