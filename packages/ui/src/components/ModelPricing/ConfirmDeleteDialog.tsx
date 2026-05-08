import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useState } from 'react';
import { toast } from 'react-toastify';
import { ModelPricingEntity } from '@/clients/api';
import { useMutation } from '@tanstack/react-query';
import { modelPricingControllerDeleteV1Mutation } from '@/clients/api/@tanstack/react-query.gen';

export type ConfirmDeleteModelPricingDialogProps = {
  pricing: ModelPricingEntity;
  onClose: () => void;
};

export default function ConfirmDeleteModelPricingDialog({
  pricing,
  onClose,
}: ConfirmDeleteModelPricingDialogProps) {
  const [open, setOpen] = useState(true);
  const { mutateAsync: deletePricing, isPending } = useMutation({
    ...modelPricingControllerDeleteV1Mutation({}),
  });

  const handleClose = () => {
    setOpen(false);
    onClose();
  };

  const handleDelete = async () => {
    try {
      await deletePricing({ path: { pricingId: pricing.pricingId } });
      toast.success(
        `Pricing for ${pricing.provider}/${pricing.model} has been deleted.`
      );
      handleClose();
    } catch (error) {
      toast.error(
        `Failed to delete pricing entry: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  };

  return (
    <Dialog
      open={open}
      onClose={isPending ? undefined : handleClose}
      aria-labelledby="confirm-delete-pricing-title"
      aria-describedby="confirm-delete-pricing-description"
      maxWidth="md"
    >
      <DialogTitle id="confirm-delete-pricing-title">
        Are you sure you want to delete pricing for{' '}
        <strong>
          {pricing.provider}/{pricing.model}
        </strong>
        ?
      </DialogTitle>
      <DialogContent>
        <DialogContentText id="confirm-delete-pricing-description">
          New audit rows for this model will compute as $0 cost until you re-add
          the pricing entry. Existing audit rows keep their previously computed
          cost.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button disabled={isPending} variant="text" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          disabled={isPending}
          color="error"
          variant="contained"
          onClick={handleDelete}
          autoFocus
        >
          {isPending ? 'Deleting...' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
