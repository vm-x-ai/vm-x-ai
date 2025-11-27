import { ApiKeyEntity } from '@/clients/api';
import { deleteApiKeyMutation } from '@/clients/api/@tanstack/react-query.gen';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'react-toastify';

export type ConfirmDeleteAPIKeyDialogProps = {
  workspaceId: string;
  environmentId: string;
  apiKey: ApiKeyEntity;
  onClose: () => void;
};

export default function ConfirmDeleteAPIKeyDialog({
  workspaceId,
  environmentId,
  apiKey,
  onClose,
}: ConfirmDeleteAPIKeyDialogProps) {
  const [open, setOpen] = useState(true);
  const { mutateAsync: deleteApiKey, isPending: deletingApiKey } = useMutation({
    ...deleteApiKeyMutation({}),
  });

  const handleClose = () => {
    setOpen(false);
    onClose();
  };

  const handleDelete = async () => {
    try {
      await deleteApiKey({
        path: {
          workspaceId,
          environmentId,
          apiKeyId: apiKey.apiKeyId,
        },
      });
      handleClose();
    } catch (error) {
      toast.error(
        `Failed to delete API key ${apiKey.name}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={deletingApiKey ? undefined : handleClose}
        aria-labelledby="confirm-delete-api-key-title"
        aria-describedby="confirm-delete-api-key-description"
        maxWidth="md"
      >
        <DialogTitle id="confirm-delete-api-key-title">
          Are you sure you want to delete <strong>{apiKey.name}</strong> (
          {apiKey.maskedKey}) role?
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="confirm-delete-api-key-description">
            This action cannot be undone. any requests pointing to this role
            will fail, please make there are no active components using this
            role.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            disabled={deletingApiKey}
            variant="contained"
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button
            disabled={deletingApiKey}
            color="error"
            variant="contained"
            onClick={handleDelete}
            autoFocus
          >
            {deletingApiKey ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
