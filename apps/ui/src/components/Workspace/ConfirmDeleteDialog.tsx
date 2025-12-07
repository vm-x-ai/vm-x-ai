import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useState } from 'react';
import { toast } from 'react-toastify';
import { useMutation } from '@tanstack/react-query';
import { deleteWorkspaceMutation } from '@/clients/api/@tanstack/react-query.gen';
import { WorkspaceEntity } from '@/clients/api';

export type ConfirmDeleteWorkspaceDialogProps = {
  workspace: WorkspaceEntity;
  onClose: () => void;
};

export default function ConfirmDeleteWorkspaceDialog({
  workspace,
  onClose,
}: ConfirmDeleteWorkspaceDialogProps) {
  const [open, setOpen] = useState(true);
  const { mutateAsync: deleteWorkspace, isPending: deletingWorkspace } = useMutation({
    ...deleteWorkspaceMutation({}),
  });

  const handleClose = () => {
    setOpen(false);
    onClose();
  };

  const handleDelete = async () => {
    try {
      await deleteWorkspace({
        path: {
          workspaceId: workspace.workspaceId,
        },
      });

      toast.success(`Workspace ${workspace.name} has been deleted.`);
      handleClose();
    } catch (error) {
      toast.error(
        `Failed to delete workspace ${workspace.name}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={deletingWorkspace ? undefined : handleClose}
        aria-labelledby="confirm-delete-workspace-title"
        aria-describedby="confirm-delete-workspace-description"
        maxWidth="md"
      >
        <DialogTitle id="confirm-delete-workspace-title">
          Are you sure you want to delete <strong>{workspace.name}</strong> workspace?
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="confirm-delete-workspace-description">
            This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            disabled={deletingWorkspace}
            variant="contained"
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button
            disabled={deletingWorkspace}
            color="error"
            variant="contained"
            onClick={handleDelete}
            autoFocus
          >
            {deletingWorkspace ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
