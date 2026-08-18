/**
 * Give this shell the platform behaviour it needs before anything renders:
 * the file saver `platform/fs.ts` will use, and — on Android — a back button
 * that navigates instead of quitting.
 *
 * Called once from `main.tsx`, before the app renders. It is the only place
 * that knows both halves — which platform we are on, and which module handles
 * it — and it keeps every native dependency behind `await import()`:
 *
 *   - `detectHost()` reads globals; it imports neither SDK.
 *   - The saver module is imported only after the host said it is that host.
 *
 * So the browser build never downloads `@capacitor/filesystem` or
 * `@tauri-apps/*`, even though both are ordinary dependencies of this package.
 * They are named vendor groups in `vite.config.ts` for the same reason
 * `supabase` and `sheetjs` are: if `capacitor` or `tauri` ever shows up in
 * `index.html`'s preload list, something has imported one statically and every
 * web visitor is paying for a plugin they cannot use.
 *
 * `fs.ts` still says "do not add a conditional import to this file", and that
 * is still right. The rule was never about the packages being uninstalled —
 * it is that `fs.ts` is imported by the export screen, so an import there is
 * on the boot path whether or not the branch runs. Here it is behind a
 * function that returns immediately on the web.
 *
 * **Failure is not fatal.** A native plugin that fails to load leaves the
 * browser saver in place, which on Android downloads to the Downloads folder
 * through the WebView. Worse, but not broken — and an app that refuses to
 * start because an export path is unavailable would be far worse than that.
 */
import {detectHost, type HostPlatform} from './host';
import {registerFileSaver} from './fs';

export interface InstallResult {
  host: HostPlatform;
  /** False when the host is native but its platform module could not be loaded. */
  installed: boolean;
  /** Present only on failure, for the console. */
  error?: unknown;
}

export async function installNativePlatform(
  host: HostPlatform = detectHost(),
): Promise<InstallResult> {
  if (host === 'web') return {host, installed: false};

  try {
    if (host === 'capacitor') {
      const {capacitorSaver} = await import('./savers/capacitor');
      registerFileSaver(capacitorSaver);

      // Not a file concern, but the same shape of problem and the same
      // constraint: a native default that is wrong for this app, fixable only
      // from a module the web build must never load.
      const {installAndroidBackButton} = await import('./android-back');
      await installAndroidBackButton();
    } else {
      const {tauriSaver} = await import('./savers/tauri');
      registerFileSaver(tauriSaver);
    }
    return {host, installed: true};
  } catch (error) {
    return {host, installed: false, error};
  }
}
