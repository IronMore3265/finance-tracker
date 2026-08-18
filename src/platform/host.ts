/**
 * Which shell is this build running inside?
 *
 * There is exactly one web build (`dist/`), and Capacitor and Tauri both serve
 * it unchanged — so the platform cannot be a build-time constant. It is
 * answered at runtime, from globals each shell injects into the WebView
 * *before* any application script runs:
 *
 *   - Capacitor's `native-bridge.js` defines `window.Capacitor`.
 *   - Tauri v2 defines `window.__TAURI_INTERNALS__` (and, since 2.1,
 *     `window.isTauri`).
 *
 * Neither check imports the SDK it is detecting, which is the point. Asking
 * `@capacitor/core` "are we native?" means loading `@capacitor/core` in every
 * browser to be told no.
 *
 * `Capacitor.isNativePlatform()` rather than the mere presence of the global:
 * `@capacitor/core` installs that same global on the web the moment anything
 * imports it, with `isNativePlatform()` returning false. Presence would then
 * be true in a plain browser tab and the app would try to write through a
 * plugin that is not there.
 *
 * The parameter exists so the rules are testable without a WebView; nothing in
 * the app passes it.
 */

export type HostPlatform = 'web' | 'capacitor' | 'tauri';

/** The globals each native shell injects. All optional — a browser has none. */
export interface HostGlobals {
  Capacitor?: {isNativePlatform?: () => boolean} | undefined;
  __TAURI_INTERNALS__?: unknown;
  isTauri?: unknown;
}

export function detectHost(scope: HostGlobals = globalThis as HostGlobals): HostPlatform {
  if (isTauriHost(scope)) return 'tauri';
  if (isCapacitorHost(scope)) return 'capacitor';
  return 'web';
}

function isTauriHost(scope: HostGlobals): boolean {
  return scope.isTauri === true || scope.__TAURI_INTERNALS__ != null;
}

function isCapacitorHost(scope: HostGlobals): boolean {
  const capacitor = scope.Capacitor;
  if (capacitor == null || typeof capacitor.isNativePlatform !== 'function') return false;

  // A bridge that throws is a broken bridge, not a native platform.
  try {
    return capacitor.isNativePlatform() === true;
  } catch {
    return false;
  }
}

/** True in a packaged app, false in a browser tab. */
export function isNativeHost(scope?: HostGlobals): boolean {
  return detectHost(scope) !== 'web';
}
