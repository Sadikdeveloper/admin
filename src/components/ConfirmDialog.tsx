import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Modal } from './Modal';

/**
 * Destructive-action confirmation.
 *
 * Focus starts on Cancel so an instinctive Enter never deletes something, and
 * `requireText` can demand an explicit typed confirmation for irreversible
 * actions such as deleting a post along with its comments.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Keep it',
  tone = 'danger',
  busy = false,
  requireText,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  requireText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTyped('');
  }, [open, title]);

  const matches = !requireText || typed.trim().toLowerCase() === requireText.trim().toLowerCase();

  return (
    <Modal
      open={open}
      title={title}
      onClose={busy ? () => {} : onCancel}
      dismissible={!busy}
      size="sm"
      className="confirm-modal"
      initialFocus={requireText ? inputRef : cancelRef}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy} ref={cancelRef}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy || !matches}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-body">
        {tone === 'danger' && (
          <span className="confirm-ico" aria-hidden="true">
            <TriangleAlert size={18} />
          </span>
        )}
        <div className="confirm-message">{message}</div>
      </div>
      {requireText && (
        <label className="field confirm-field">
          <span className="field-label">
            Type <code>{requireText}</code> to confirm
          </span>
          <input
            ref={inputRef}
            value={typed}
            onChange={event => setTyped(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && matches && !busy) {
                event.preventDefault();
                onConfirm();
              }
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label={`Type ${requireText} to confirm`}
          />
        </label>
      )}
    </Modal>
  );
}
