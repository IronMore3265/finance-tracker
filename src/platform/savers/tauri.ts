/**
 * Saving a file on the desktop, through Tauri's dialog and fs plugins.
 *
 * Reached only from `platform/native.ts`, and only through `await import()` on
 * a window that reported itself as Tauri, so `@tauri-apps/*` is its own chunk
 * that a browser never downloads.
 *
 * Unlike Android, the desktop asks first. A native Save dialog is what people
 * expect from a desktop app, and it is also the only way this build is allowed
 * to write outside its own data directory: the capability in
 * `src-tauri/capabilities/default.json` grants `dialog:allow-save` and the
 * fs *write* permissions the dialog's own result carries, not blanket access
 * to the disk. Picking the path in the dialog is what authorises the write.
 *
 * `showSaveFilePicker`'s user-gesture problem (see `platform/fs.ts`) does not
 * apply here — this is an IPC call to the host process, not a web API, so the
 * export can read the database first and prompt afterwards.
 */
import {save} from '@tauri-apps/plugin-dialog';
import {writeFile, writeTextFile} from '@tauri-apps/plugin-fs';
import type {FileSaver, SaveFileRequest, SaveFileResult} from '../fs';

export const tauriSaver: FileSaver = {
  name: 'desktop',

  async save(request: SaveFileRequest): Promise<SaveFileResult> {
    let path: string | null;
    try {
      path = await save({
        defaultPath: request.fileName,
        filters: dialogFilters(request),
      });
    } catch (error) {
      return {ok: false, reason: describeError(error)};
    }

    // Dismissing the dialog is a decision, not a failure. Reporting it as an
    // error would put a red banner on the screen of someone who changed their
    // mind, so it carries `cancelled` and the caller stays silent.
    if (path === null) return {ok: false, cancelled: true, reason: 'Save cancelled'};

    try {
      if (typeof request.data === 'string') {
        await writeTextFile(path, request.data);
      } else {
        await writeFile(path, new Uint8Array(await request.data.arrayBuffer()));
      }
      return {ok: true, location: path};
    } catch (error) {
      return {ok: false, reason: explainWriteFailure(error)};
    }
  },
};

/**
 * Tauri's fs scope is a compile-time allowlist, and the dialog does not widen
 * it: picking a path in the Save dialog does not grant permission to write
 * there. `capabilities/default.json` allows the home directory, which covers
 * Documents, Downloads and the desktop — and refuses a second drive with a
 * bare `forbidden path` that reads like a bug in the export.
 *
 * Saying which folders work turns that into something the user can act on. The
 * real fix, if this ever needs to write outside `$HOME`, is a Rust command:
 * commands are not scope-checked, so the dialog's own result authorises the
 * write. That is a deliberate not-yet — it trades a config line for IPC.
 */
export function explainWriteFailure(error: unknown): string {
  const message = describeError(error);
  if (!/forbidden path/i.test(message)) return message;

  return `${message} — this app may only write inside your home folder (Documents, Downloads, Desktop). Choose a location there.`;
}

/**
 * The dialog needs the extension, not the MIME type, and it is already in the
 * suggested name — deriving it there keeps the two from drifting apart.
 */
export function dialogFilters({fileName}: SaveFileRequest): Array<{name: string; extensions: string[]}> {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return [];

  const extension = fileName.slice(dot + 1).toLowerCase();
  return [{name: `${extension.toUpperCase()} file`, extensions: [extension]}];
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
