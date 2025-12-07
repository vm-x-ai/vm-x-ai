import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import {
  AiConnectionEntity,
} from '@/clients/api';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  deleteAiConnectionMutation,
  getAiResourcesOptions,
} from '@/clients/api/@tanstack/react-query.gen';

export type ConfirmDeleteAIConnectionDialogProps = {
  workspaceId: string;
  environmentId: string;
  aiConnection: AiConnectionEntity;
  onClose: () => void;
};

export default function ConfirmDeleteAIConnectionDialog({
  workspaceId,
  environmentId,
  aiConnection,
  onClose,
}: ConfirmDeleteAIConnectionDialogProps) {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  const { data: resources, isLoading: queryingResources } = useQuery({
    ...getAiResourcesOptions({
      path: {
        workspaceId,
        environmentId,
      },
      query: {
        connectionId: aiConnection.connectionId,
      },
    }),
  });
  const { mutateAsync: deleteConnection, isPending: deletingConnection } =
    useMutation({
      ...deleteAiConnectionMutation({}),
    });

  const handleClose = () => {
    setOpen(false);
    onClose();
  };

  const disabled = useMemo(
    () => deletingConnection || (!resources && queryingResources),
    [deletingConnection, queryingResources, resources]
  );

  const handleDelete = async () => {
    try {
      await deleteConnection({
        path: {
          workspaceId,
          environmentId,
          connectionId: aiConnection.connectionId,
        },
      });

      router.push(`/workspaces/${workspaceId}/${environmentId}/ai-connections/overview`);
      toast.success(`Connection ${aiConnection.name} has been deleted.`);
      handleClose();
    } catch (error) {
      toast.error(
        `Failed to delete connection ${aiConnection.name}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={disabled ? undefined : handleClose}
        aria-labelledby="confirm-delete-ai-connection-title"
        aria-describedby="confirm-delete-ai-connection-description"
        maxWidth="md"
      >
        <DialogTitle id="confirm-delete-ai-connection-title">
          Are you sure you want to delete <strong>{aiConnection.name}</strong>{' '}
          connection?
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="confirm-delete-resource-description">
            This action cannot be undone.
          </DialogContentText>
          {!resources && queryingResources && (
            <Alert severity="info">
              Checking existing resources related to this connection, please
              wait...
            </Alert>
          )}
          {resources && resources.length === 0 && (
            <Alert severity="info">
              No related resources found for this connection.
            </Alert>
          )}
          {resources && resources.length > 0 && (
            <Alert severity="warning">
              The following resources are related to this connection. Deleting
              this connection will also delete these resources:
              <ul
                style={{
                  marginTop: '1rem',
                }}
              >
                {resources.map((resource) => (
                  <li
                    style={{
                      listStyle: 'initial',
                      marginLeft: '2rem',
                      fontWeight: 'bold',
                    }}
                    key={resource.resourceId}
                  >
                    {resource.name}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={disabled} variant="contained" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            disabled={disabled}
            color="error"
            variant="contained"
            onClick={handleDelete}
            autoFocus
          >
            {deletingConnection ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
