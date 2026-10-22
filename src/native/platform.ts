// Is this the Android app (Capacitor) or the web/PWA build? docs/decisions/0033-android-capacitor.md
//
// Capacitor's native bridge defines `window.Capacitor.isNativePlatform()` before any page script
// runs; it is the same function `Capacitor.isNativePlatform()` from @capacitor/core returns. Reading
// it here keeps @capacitor/core and every plugin out of the web bundle: native code is loaded
// with import() only when this returns true (src/native/*).

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

export function isNativeApp(): boolean {
  try {
    const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
    return cap?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** 'android' | 'ios' | 'web'. */
export function nativePlatform(): string {
  try {
    return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor?.getPlatform?.() ?? 'web';
  } catch {
    return 'web';
  }
}
