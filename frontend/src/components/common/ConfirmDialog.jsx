import { useState } from 'react';
import Modal from './Modal';
import Button from './Button';

export default function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = '삭제',
  cancelLabel = '취소',
  confirmVariant = 'danger',
}) {
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={loading ? undefined : onCancel} title={title}>
      <p style={{ color: 'var(--color-text-muted)' }}>{message}</p>
      <div style={{ display: 'flex', gap: 'var(--spacing-2)', justifyContent: 'flex-end', marginTop: 'var(--spacing-4)' }}>
        <Button variant="ghost" onClick={onCancel} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button variant={confirmVariant} onClick={handleConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
