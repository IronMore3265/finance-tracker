/**
 * Saving a file, on whichever platform this build is running.
 *
 * Written now rather than in Phase 7 because PROGRESS.md §6 calls it out: the
 * export button lands in Phase 3, and Capacitor and Tauri each want their own
 * way of putting bytes on disk. Wiring the browser path directly into the
 * export screen would mean rewriting the same call site three times.
 *
 * Neither `@capacitor/filesystem` nor `@tauri-apps/plugin-fs` is installed yet
 * — they arrive with the packaging work — so this file deliberately does NOT
 * import them. A bare `import('@capacitor/filesystem')` would fail to resolve
 * at build time even inside a branch that never runs on the web. Instead the
 * native builds *register* a saver at startup:
 *
 *   // Phase 7, in the Capacitor entry point only
 *   import {registerFileSaver} from './platform/fs';
 *   registerFileSaver(capacitorSaver);
 *
 * so the dependency lives in the code path that has it, and this module keeps
 * working in a browser, in tests, and in a native shell without conditionals.
 */

export interface SaveFileRequest {
  /** Suggested name including extension, e.g. `finance-backup-2026-08-18.json`. */
  fileName: string;
  /** MIME type, e.g. `application/json`. */
  mimeType: string;
  /** File contents. Text for JSON/CSV; Blob for anything binary. */
  data: string | Blob;
}

export type SaveFileResult =
  | {ok: true; /** Human-readable destination, or '' when the OS did not say. */ location: string}
  | {
      ok: false;
      reason: string;
      /**
       * The user dismissed a save dialog. Only the desktop saver can produce
       * this — the browser and Android paths never ask. Callers must not show
       * an error for it: someone who changed their mind has not hit a problem,
       * and a red banner would say otherwise.
       */
      cancelled?: true;
    };

export interface FileSaver {
  /** Shown in diagnostics so a failed export says which path was tried. */
  readonly name: string;
  save(request: SaveFileRequest): Promise<SaveFileResult>;
}

/**
 * Browser download via an object URL.
 *
 * `showSaveFilePicker` is deliberately not used even where it exists: it is
 * Chromium-only, and it must be called inside the user gesture that started
 * the export. Any `await` before it (reading the database, say) invalidates
 * the gesture and it throws `SecurityError`. The anchor click has no such
 * constraint, so the export can do its work first and save afterwards.
 */
const browserSaver: FileSaver = {
  name: 'browser',

  async save({fileName, mimeType, data}) {
    const blob = typeof data === 'string' ? new Blob([data], {type: mimeType}) : data;
    const url = URL.createObjectURL(blob);

    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.rel = 'noopener';
      // Not appended to the document: a detached anchor still dispatches its
      // click, and appending would briefly put an element the design system
      // knows nothing about into the layout.
      anchor.click();
      return {ok: true, location: ''};
    } catch (error) {
      return {ok: false, reason: describeError(error)};
    } finally {
      // Revoking synchronously can cancel the download in some browsers, which
      // fetch the URL on the next task. One frame is enough.
      requestAnimationFrame(() => URL.revokeObjectURL(url));
    }
  },
};

let activeSaver: FileSaver = browserSaver;

/**
 * Replace the saver. Called once by a native entry point at startup.
 *
 * Returns a function restoring the previous saver, which is what makes this
 * testable without leaking state between cases.
 */
export function registerFileSaver(saver: FileSaver): () => void {
  const previous = activeSaver;
  activeSaver = saver;
  return () => {
    activeSaver = previous;
  };
}

/** Which saver is in force. Surfaced in Settings so a failed export is diagnosable. */
export function activeFileSaverName(): string {
  return activeSaver.name;
}

/**
 * Save a file, never throwing.
 *
 * Returns a result rather than rejecting because every caller is a button
 * handler that has to tell the user something either way, and an unhandled
 * rejection there would leave the UI claiming success.
 */
export async function saveFile(request: SaveFileRequest): Promise<SaveFileResult> {
  try {
    return await activeSaver.save(request);
  } catch (error) {
    return {ok: false, reason: describeError(error)};
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** `finance-tracker-backup-2026-08-18.json`, so exports sort by date in a folder. */
export function timestampedFileName(stem: string, extension: string): string {
  const now = new Date();
  const iso = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  return `${stem}-${iso}.${extension}`;
}
