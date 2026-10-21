import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogClose } from '@/ui';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
}

/**
 * Destructive confirmation. Focus starts on "Vazgeç" so a stray Enter never deletes.
 * Phones: the danger action sits on top, "Vazgeç" below (footer stacks reversed).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  busy,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      variant="dialog"
      hideClose
      footer={
        <>
          <DialogClose asChild>
            {/* oxlint-disable-next-line jsx-a11y/no-autofocus -- safe default for a destructive dialog */}
            <Button variant="secondary" autoFocus>
              {t('common.cancel')}
            </Button>
          </DialogClose>
          <Button variant="danger" loading={busy} onClick={() => void onConfirm()}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
