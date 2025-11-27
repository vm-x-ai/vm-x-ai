import { PoolDefinitionEntity, PoolDefinitionEntry } from '@/clients/api';
import { updatePoolDefinitionMutation } from '@/clients/api/@tanstack/react-query.gen';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'react-toastify';

export type ConfirmDeletePoolDefinitionDialogProps = {
  workspaceId: string;
  environmentId: string;
  data: PoolDefinitionEntity;
  entry: PoolDefinitionEntry;
  onClose: () => void;
};

export default function ConfirmDeletePoolDefinitionDialog({
  workspaceId,
  environmentId,
  data,
  entry,
  onClose,
}: ConfirmDeletePoolDefinitionDialogProps) {
  const [open, setOpen] = useState(true);

  const { mutateAsync: updateDefinition, isPending: updatingDefinition } =
    useMutation({
      ...updatePoolDefinitionMutation(),
    });

  const handleClose = () => {
    setOpen(false);
    onClose();
  };

  const handleDelete = async () => {
    try {
      await updateDefinition({
        path: {
          workspaceId,
          environmentId,
        },
        body: {
          definition: data.definition.filter(
            (item) => item.name !== entry.name
          ),
        },
      });
      handleClose();
    } catch (error) {
      console.error(error);
      toast.error('Failed to delete prioritization entry');
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={updatingDefinition ? undefined : handleClose}
        aria-labelledby="confirm-delete-ai-connection-title"
        aria-describedby="confirm-delete-ai-connection-description"
        maxWidth="md"
      >
        <DialogTitle id="confirm-delete-ai-connection-title">
          Are you sure you want to delete <strong>{entry.name}</strong>{' '}
          prioritization entry?
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="confirm-delete-prioritization-entry-description">
            This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            disabled={updatingDefinition}
            variant="contained"
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button
            disabled={updatingDefinition}
            color="error"
            variant="contained"
            onClick={handleDelete}
            autoFocus
          >
            {updatingDefinition ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
