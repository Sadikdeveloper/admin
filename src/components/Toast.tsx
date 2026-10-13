import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'info';

export type ToastInput = {
  message: string;
  tone?: ToastTone;
  /** Optional second line — a server message, a file name, a hint. */
  detail?: string;
  duration?: number;
};

export type ToastApi = {
  push: (input: ToastInput | string) => void;
  success: (message: string, detail?: string) => void;
  error: (message: string, detail?: string) => void;
  info: (message: string, detail?: string) => void;
};

type Toast = Required<Pick<ToastInput, 'message'>> & ToastInput & { id: number };

const ToastContext = createContext<ToastApi | null>(null);
const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, number>());
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts(current => current.filter(toast => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (input: ToastInput | string) => {
      const normalized: ToastInput = typeof input === 'string' ? { message: input } : input;
      const message = normalized.message?.trim();
      if (!message) return;

      const id = nextId.current++;
      const tone = normalized.tone ?? 'info';
      const duration = normalized.duration ?? (tone === 'error' ? 9000 : 4500);

      setToasts(current => [...current.slice(-(MAX_VISIBLE - 1)), { id, message, tone, detail: normalized.detail, duration }]);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), duration),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach(timer => window.clearTimeout(timer));
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (message, detail) => push({ message, detail, tone: 'success' }),
      error: (message, detail) => push({ message, detail, tone: 'error' }),
      info: (message, detail) => push({ message, detail, tone: 'info' }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toasts.length > 0 &&
        createPortal(
          <div className="toast-stack" role="region" aria-label="Notifications">
            {toasts.map(toast => (
              <div className={`toast toast-${toast.tone}`} key={toast.id} role={toast.tone === 'error' ? 'alert' : 'status'}>
                <span className="toast-ico" aria-hidden="true">
                  {toast.tone === 'success' ? (
                    <CheckCircle2 size={16} />
                  ) : toast.tone === 'error' ? (
                    <CircleAlert size={16} />
                  ) : (
                    <Info size={16} />
                  )}
                </span>
                <div className="toast-text">
                  <span>{toast.message}</span>
                  {toast.detail && <small>{toast.detail}</small>}
                </div>
                <button type="button" className="toast-close" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

/** Falls back to a no-op so a component rendered outside the provider still works. */
export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  return (
    context ?? {
      push: () => {},
      success: () => {},
      error: () => {},
      info: () => {},
    }
  );
}
