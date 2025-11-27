import { CreatedApiKeyDto } from '@/clients/api';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useState } from 'react';

export type APIKeyDialogProps = {
  apiKey: CreatedApiKeyDto;
  onClose: () => void;
};

export default function APIKeyDialog({ apiKey, onClose }: APIKeyDialogProps) {
  const [open, setOpen] = useState(true);

  const handleClose = () => {
    setOpen(false);
    onClose();
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={handleClose}
        aria-labelledby="show-api-key-title"
        aria-describedby="show-api-key-description"
        maxWidth="md"
      >
        <DialogTitle id="show-api-key-title">
          Role <strong>{apiKey.name}</strong> was successfully created.
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="show-api-key-description">
            <Alert severity="warning">
              Please make sure to copy and save the API Key below, as it will
              not be shown again.
            </Alert>
            <br />
            <strong>API Key:</strong> <pre>{apiKey.apiKeyValue}</pre>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={handleClose}>
            Acknowledged
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
