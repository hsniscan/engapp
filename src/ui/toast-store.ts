/**
 * Imperative toast queue. `toast()` can be called from anywhere (sync engine, event handlers);
 * <Toaster /> renders the queue.
 */
export type ToastTone = 'neutral' | 'success' | 'warn' | 'danger';

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** ms; default 5000. Use Infinity for toasts that must be acted on (e.g. "Yeni sürüm hazır"). */
  duration?: number;
  action?: { label: string; onClick: () => void; altText?: string };
}

export interface ToastRecord extends ToastOptions {
  id: string;
  open: boolean;
}

type Listener = () => void;
let toasts: ToastRecord[] = [];
const listeners = new Set<Listener>();
let counter = 0;

function emit() {
  for (const l of listeners) l();
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToasts(): ToastRecord[] {
  return toasts;
}

function dismiss(id: string) {
  toasts = toasts.map((t) => (t.id === id ? { ...t, open: false } : t));
  emit();
  // Remove after the exit animation.
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 400);
}

/** Shows a toast and returns its id. At most 3 are kept; the oldest goes first. */
export function toast(options: ToastOptions | string): string {
  const opts = typeof options === 'string' ? { title: options } : options;
  const id = `t${++counter}`;
  toasts = [...toasts.filter((t) => t.open).slice(-2), { ...opts, id, open: true }];
  emit();
  return id;
}

toast.dismiss = dismiss;

/** Empties the queue at once (tests: a toast left open by one test must not leak into the next). */
export function resetToasts(): void {
  toasts = [];
  emit();
}
