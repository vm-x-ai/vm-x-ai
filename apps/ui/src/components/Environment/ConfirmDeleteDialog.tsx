import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useState } from 'react';
import { toast } from 'react-toastify';
import { useMutation } from '@tanstack/react-query';
import { deleteEnvironmentMutation } from '@/clients/api/@tanstack/react-query.gen';
import { EnvironmentEntity } from '@/clients/api';

export type ConfirmDeleteEnvironmentDialogProps = {
  environment: EnvironmentEntity;
  onClose: () => void;
};

export default function ConfirmDeleteEnvironmentDialog({
  environment,
  onClose,
}: ConfirmDeleteEnvironmentDialogProps) {
  const [open, setOpen] = useState(true);
  const { mutateAsync: deleteEnvironment, isPending: deletingEnvironment } = useMutation({
    ...deleteEnvironmentMutation({}),
  });

  const handleClose = () => {
    setOpen(false);
    onClose();
  };

  const handleDelete = async () => {
    try {
      await deleteEnvironment({
        path: {
          workspaceId: environment.workspaceId,
          environmentId: environment.environmentId,
        },
      });

      toast.success(`Environment ${environment.name} has been deleted.`);
      handleClose();
    } catch (error) {
      toast.error(
        `Failed to delete environment ${environment.name}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={deletingEnvironment ? undefined : handleClose}
        aria-labelledby="confirm-delete-environment-title"
        aria-describedby="confirm-delete-environment-description"
        maxWidth="md"
      >
        <DialogTitle id="confirm-delete-environment-title">
          Are you sure you want to delete <strong>{environment.name}</strong> environment?
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="confirm-delete-environment-description">
            This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            disabled={deletingEnvironment}
            variant="contained"
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button
            disabled={deletingEnvironment}
            color="error"
            variant="contained"
            onClick={handleDelete}
            autoFocus
          >
            {deletingEnvironment ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
