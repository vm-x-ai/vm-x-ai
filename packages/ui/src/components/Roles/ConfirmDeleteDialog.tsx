import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useState } from 'react';
import { toast } from 'react-toastify';
import { RoleDto } from '@/clients/api';
import { useMutation } from '@tanstack/react-query';
import { deleteRoleMutation } from '@/clients/api/@tanstack/react-query.gen';

export type ConfirmDeleteRoleDialogProps = {
  role: RoleDto;
  onClose: () => void;
};

export default function ConfirmDeleteRoleDialog({
  role,
  onClose,
}: ConfirmDeleteRoleDialogProps) {
  const [open, setOpen] = useState(true);
  const { mutateAsync: deleteRole, isPending: deletingRole } = useMutation({
    ...deleteRoleMutation({}),
  });

  const handleClose = () => {
    setOpen(false);
    onClose();
  };

  const handleDelete = async () => {
    try {
      await deleteRole({
        path: {
          roleId: role.roleId,
        },
      });

      toast.success(`Role ${role.name} has been deleted.`);
      handleClose();
    } catch (error) {
      toast.error(
        `Failed to delete role ${role.name}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={deletingRole ? undefined : handleClose}
        aria-labelledby="confirm-delete-role-title"
        aria-describedby="confirm-delete-role-description"
        maxWidth="md"
      >
        <DialogTitle id="confirm-delete-role-title">
          Are you sure you want to delete <strong>{role.name}</strong>?
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="confirm-delete-role-description">
            This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={deletingRole} variant="text" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            disabled={deletingRole}
            color="error"
            variant="contained"
            onClick={handleDelete}
            autoFocus
          >
            {deletingRole ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
