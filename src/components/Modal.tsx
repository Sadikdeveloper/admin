import { useCallback, useEffect, useId, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE =
  'a[href], button:not(:disabled), textarea:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/**
 * Accessible dialog used across the CMS.
 *
 * Rendered in a portal so a transformed ancestor can never clip it, locks
 * background scrolling, traps focus, closes on Escape and becomes a bottom
 * sheet on small screens (see `styles/blog.css`).
 */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
  dismissible = true,
  initialFocus,
  className = '',
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'full';
  dismissible?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const close = useCallback(() => {
    if (dismissible) onClose();
  }, [dismissible, onClose]);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = window.setTimeout(() => {
      if (initialFocus?.current && panelRef.current?.contains(initialFocus.current)) {
        initialFocus.current.focus();
        return;
      }
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panelRef.current)?.focus();
    }, 20);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      // Putting focus back stops the page jumping to the top on mobile.
      if (restoreTo.current?.isConnected) restoreTo.current.focus();
    };
  }, [open, initialFocus]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        node => node.offsetParent !== null || node === document.activeElement,
      );
      if (!nodes.length) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && (active === first || !panelRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, close]);

  if (!open) return null;

  return createPortal(
    <div className="modal-layer">
      <div
        className="modal-backdrop"
        onClick={event => {
          // Only a direct hit on the backdrop dismisses; a drag that ends there
          // (common on touch) should not throw away what someone was doing.
          if (event.target === event.currentTarget) close();
        }}
      />
      <div
        className={`modal modal-${size} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        ref={panelRef}
        tabIndex={-1}
      >
        <header className="modal-head">
          <div className="modal-head-text">
            <h2 id={titleId}>{title}</h2>
            {description && (
              <p id={descriptionId} className="modal-subtle">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <button type="button" className="icon-button modal-close" onClick={close} aria-label="Close dialog">
              <X size={16} />
            </button>
          )}
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
