// Browser/platform facts and small external stores used by settings and the bootstrap.
import { useSyncExternalStore } from 'react';

/** True on iPhone/iPad (iPadOS reports itself as Mac with touch). */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Running as an installed app (home screen / desktop window). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches)
  );
}

/** Safari on iOS (other iOS browsers cannot add to the home screen the same way before iOS 16.4). */
export function isIosSafari(): boolean {
  if (!isIos()) return false;
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
}

// ------------------------------------------------------------------ install prompt

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Listener = () => void;

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set(v: T) {
      value = v;
      listeners.forEach((l) => l());
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

const installStore = store<{ prompt: BeforeInstallPromptEvent | null; installed: boolean }>({
  prompt: null,
  installed: false,
});

/** Call once at startup, before the browser fires beforeinstallprompt. */
export function captureInstallPrompt(): void {
  installStore.set({ prompt: null, installed: isStandalone() });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep it for the "Uygulamayı yükle" button
    installStore.set({ ...installStore.get(), prompt: e as BeforeInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () =>
    installStore.set({ prompt: null, installed: true }),
  );
}

export function useInstallState() {
  const state = useSyncExternalStore(installStore.subscribe, installStore.get, installStore.get);
  const install = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const p = state.prompt;
    if (!p) return 'unavailable';
    await p.prompt();
    const { outcome } = await p.userChoice;
    installStore.set({
      prompt: null,
      installed: outcome === 'accepted' || installStore.get().installed,
    });
    return outcome;
  };
  return { canInstall: !!state.prompt, installed: state.installed, install };
}

// ------------------------------------------------------------------ storage

export interface StorageInfo {
  supported: boolean;
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

const storageStore = store<StorageInfo>({
  supported: false,
  persisted: null,
  usage: null,
  quota: null,
});

export async function refreshStorageInfo(): Promise<StorageInfo> {
  const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!s) {
    storageStore.set({ supported: false, persisted: null, usage: null, quota: null });
    return storageStore.get();
  }
  const [persisted, est] = await Promise.all([
    s.persisted ? s.persisted().catch(() => null) : Promise.resolve(null),
    s.estimate ? s.estimate().catch(() => null) : Promise.resolve(null),
  ]);
  storageStore.set({
    supported: !!s.persist,
    persisted,
    usage: est?.usage ?? null,
    quota: est?.quota ?? null,
  });
  return storageStore.get();
}

/** Ask the browser to keep our data under storage pressure. Resolves to the new state. */
export async function requestPersistence(): Promise<boolean | null> {
  const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!s?.persist) return null;
  const granted = await s.persist().catch(() => false);
  await refreshStorageInfo();
  return granted;
}

export function useStorageInfo(): StorageInfo {
  return useSyncExternalStore(storageStore.subscribe, storageStore.get, storageStore.get);
}

// ------------------------------------------------------------------ local flags

/** localStorage that never throws (private mode, blocked storage). */
export const flags = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`engapp.${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(`engapp.${key}`, value);
    } catch {
      // ignore
    }
  },
};
