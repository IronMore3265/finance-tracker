/**
 * The destination ladder, which is the only judgement this saver makes.
 *
 * The plugin is mocked — it cannot run outside an Android WebView — so what is
 * under test is the order (public folder first, app-private only as a
 * fallback), that a Blob is converted rather than handed over, and that a path
 * is turned into something a person can act on.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

const writeFile = vi.hoisted(() => vi.fn());

vi.mock('@capacitor/filesystem', () => ({
  Directory: {Documents: 'DOCUMENTS', External: 'EXTERNAL'},
  Encoding: {UTF8: 'utf8'},
  Filesystem: {writeFile},
}));

import {capacitorSaver, describeUri} from './capacitor';

const request = {
  fileName: 'finance-tracker-backup-2026-08-18.json',
  mimeType: 'application/json',
  data: '{"accounts":[]}',
};

beforeEach(() => {
  writeFile.mockReset();
});

describe('capacitorSaver', () => {
  it('writes to the public Documents folder first', async () => {
    writeFile.mockResolvedValue({
      uri: 'file:///storage/emulated/0/Documents/Finance%20Tracker/backup.json',
    });

    const result = await capacitorSaver.save(request);

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith({
      path: `Finance Tracker/${request.fileName}`,
      directory: 'DOCUMENTS',
      recursive: true,
      data: request.data,
      encoding: 'utf8',
    });
    expect(result).toEqual({
      ok: true,
      location: '/Documents/Finance Tracker/backup.json',
    });
  });

  it('falls back to app-private external storage when Documents is refused', async () => {
    writeFile
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce({uri: 'file:///storage/emulated/0/Android/data/app/files/backup.json'});

    const result = await capacitorSaver.save(request);

    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(writeFile.mock.calls[1]?.[0]).toMatchObject({
      path: request.fileName,
      directory: 'EXTERNAL',
    });
    expect(result.ok).toBe(true);
  });

  it('reports every destination it tried when all of them fail', async () => {
    writeFile.mockRejectedValue(new Error('read-only file system'));

    const result = await capacitorSaver.save(request);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe(
      'DOCUMENTS: read-only file system · EXTERNAL: read-only file system',
    );
  });

  it('sends a Blob as base64 with no encoding, because the bridge drops Blobs', async () => {
    writeFile.mockResolvedValue({uri: 'file:///Documents/x.bin'});

    await capacitorSaver.save({
      fileName: 'x.bin',
      mimeType: 'application/octet-stream',
      data: new Blob([new Uint8Array([1, 2, 3])]),
    });

    const call = writeFile.mock.calls[0]?.[0];
    expect(call.encoding).toBeUndefined();
    expect(call.data).toBe('AQID');
  });
});

describe('describeUri', () => {
  it('turns a file URI into a path someone can go and find', () => {
    expect(describeUri('file:///storage/emulated/0/Documents/Finance%20Tracker/b.json')).toBe(
      '/Documents/Finance Tracker/b.json',
    );
  });

  it('leaves a malformed escape alone rather than failing the export', () => {
    expect(describeUri('file:///Documents/100%.json')).toBe('/Documents/100%.json');
  });
});
