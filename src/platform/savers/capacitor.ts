/**
 * Saving a file on Android, through Capacitor's Filesystem plugin.
 *
 * Reached only from `platform/native.ts`, and only through `await import()`
 * on a device that reported itself as Capacitor — so `@capacitor/filesystem`
 * is its own chunk that a browser never downloads. That is the same rule the
 * Supabase SDK and SheetJS follow, and the reason `platform/fs.ts` was built
 * around *registration* rather than a conditional import.
 *
 * Two destinations are tried in order, because "where can this app write?" has
 * a different answer on every Android version:
 *
 *   1. **Documents** — the public folder, visible in Files, readable by other
 *      apps and by a cable. This is the only destination worth calling a
 *      backup: a file the user cannot find is not a second copy of anything.
 *      Below Android 13 the plugin has to ask for a storage permission first,
 *      and that permission is not declared in its manifest, so this can fail.
 *   2. **External** — `Android/data/<package>/files`, always writable without
 *      any permission, and deleted when the app is uninstalled.
 *
 * Falling back rather than failing means the export always produces a file;
 * `location` says which one, so the user is never left guessing where it went.
 * The order matters — never write the private copy first, or every device
 * would silently get the worse destination.
 */
import {Directory, Encoding, Filesystem} from '@capacitor/filesystem';
import type {FileSaver, SaveFileRequest, SaveFileResult} from '../fs';

/** Keeps exports together instead of loose among everything else in Documents. */
const PUBLIC_FOLDER = 'Finance Tracker';

const DESTINATIONS: ReadonlyArray<{directory: Directory; folder: string}> = [
  {directory: Directory.Documents, folder: PUBLIC_FOLDER},
  {directory: Directory.External, folder: ''},
];

export const capacitorSaver: FileSaver = {
  name: 'Android',

  async save(request: SaveFileRequest): Promise<SaveFileResult> {
    let payload: EncodedPayload;
    try {
      payload = await encodePayload(request.data);
    } catch (error) {
      return {ok: false, reason: describeError(error)};
    }

    const failures: string[] = [];

    for (const {directory, folder} of DESTINATIONS) {
      try {
        const {uri} = await Filesystem.writeFile({
          path: folder === '' ? request.fileName : `${folder}/${request.fileName}`,
          directory,
          // The folder above will not exist on the first export.
          recursive: true,
          data: payload.data,
          ...(payload.encoding !== undefined && {encoding: payload.encoding}),
        });
        return {ok: true, location: describeUri(uri)};
      } catch (error) {
        failures.push(`${directory}: ${describeError(error)}`);
      }
    }

    return {ok: false, reason: failures.join(' · ')};
  },
};

interface EncodedPayload {
  data: string;
  /** Absent means "this string is base64", which is how the plugin writes bytes. */
  encoding?: Encoding;
}

/**
 * The plugin's `data` is `string | Blob`, but Blob is web-only — on Android it
 * arrives over the bridge as an empty object and writes a zero-byte file
 * rather than throwing. Anything binary is converted to base64 here, which is
 * the transport the native side actually implements.
 *
 * `arrayBuffer()` + `btoa` rather than a `FileReader`: both exist in a WebView,
 * but only one of them also exists in Node, and a conversion that cannot be
 * tested outside a device is a conversion nobody checks.
 */
async function encodePayload(data: string | Blob): Promise<EncodedPayload> {
  if (typeof data === 'string') return {data, encoding: Encoding.UTF8};
  return {data: await blobToBase64(data)};
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());

  // `String.fromCharCode(...bytes)` on a whole file blows the argument limit
  // and throws a stack overflow — on a large export, which is exactly the one
  // that matters. Chunked, the cost is a few string joins.
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }

  return btoa(binary);
}

/**
 * `file:///storage/emulated/0/Documents/Finance%20Tracker/x.json` is a correct
 * URI and a useless thing to show someone looking for their backup.
 */
export function describeUri(uri: string): string {
  let path = uri;
  try {
    path = decodeURIComponent(uri);
  } catch {
    // A malformed escape is not worth failing an otherwise successful export.
  }
  path = path.replace(/^file:\/\//, '');
  return path.replace('/storage/emulated/0/', '/');
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
