import { AiResourceEntity } from '@/clients/api';
import { deleteAiResourceMutation } from '@/clients/api/@tanstack/react-query.gen';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'react-toastify';

export type ConfirmDeleteResourceDialogProps = {
  workspaceId: string;
  environmentId: string;
  resource: AiResourceEntity;
  onClose: () => void;
};

export default function ConfirmDeleteResourceDialog({
  workspaceId,
  environmentId,
  resource,
  onClose,
}: ConfirmDeleteResourceDialogProps) {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  const { mutateAsync: deleteResource, isPending: deletingResource } =
    useMutation({
      ...deleteAiResourceMutation({}),
    });

  const handleClose = () => {
    setOpen(false);
    onClose();
  };

  const handleDelete = async () => {
    try {
      await deleteResource({
        path: {
          workspaceId,
          environmentId,
          resourceId: resource.resourceId,
        },
      });

      router.push(`/workspaces/${workspaceId}/${environmentId}/ai-resources/overview`);
      toast.success(`Resource ${resource.name} has been deleted.`);
      handleClose();
    } catch (error) {
      toast.error(
        `Failed to delete resource ${resource.name}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={deletingResource ? undefined : handleClose}
        aria-labelledby="confirm-delete-resource-title"
        aria-describedby="confirm-delete-resource-description"
        maxWidth="md"
      >
        <DialogTitle id="confirm-delete-resource-title">
          Are you sure you want to delete <strong>{resource.name}</strong>{' '}
          resource?
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="confirm-delete-resource-description">
            This action cannot be undone. any requests pointing to this resource
            will fail, please make there are no active components using this
            resource.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            disabled={deletingResource}
            variant="contained"
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button
            disabled={deletingResource}
            color="error"
            variant="contained"
            onClick={handleDelete}
            autoFocus
          >
            {deletingResource ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
