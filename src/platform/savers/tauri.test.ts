/**
 * The desktop saver's three decisions: what to do when the dialog is
 * dismissed, which write call a payload deserves, and how to report a refusal
 * from the fs scope.
 *
 * Cancellation is the one worth a test. It is not a failure, and the export
 * screen only knows that because the result says so — get it wrong and every
 * dismissed dialog paints an error banner.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

const save = vi.hoisted(() => vi.fn());
const writeTextFile = vi.hoisted(() => vi.fn());
const writeFile = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/plugin-dialog', () => ({save}));
vi.mock('@tauri-apps/plugin-fs', () => ({writeTextFile, writeFile}));

import {dialogFilters, explainWriteFailure, tauriSaver} from './tauri';

const request = {
  fileName: 'finance-tracker-backup-2026-08-18.json',
  mimeType: 'application/json',
  data: '{"accounts":[]}',
};

const chosenPath = 'C:\\Users\\me\\Documents\\backup.json';

beforeEach(() => {
  save.mockReset();
  writeTextFile.mockReset();
  writeFile.mockReset();
});

describe('tauriSaver', () => {
  it('writes text to the path the dialog returned', async () => {
    save.mockResolvedValue(chosenPath);

    const result = await tauriSaver.save(request);

    expect(save).toHaveBeenCalledWith({
      defaultPath: request.fileName,
      filters: [{name: 'JSON file', extensions: ['json']}],
    });
    expect(writeTextFile).toHaveBeenCalledWith(chosenPath, request.data);
    expect(result).toEqual({ok: true, location: chosenPath});
  });

  it('reports a dismissed dialog as cancelled, not as an error', async () => {
    save.mockResolvedValue(null);

    const result = await tauriSaver.save(request);

    expect(result).toEqual({ok: false, cancelled: true, reason: 'Save cancelled'});
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('writes a Blob as bytes', async () => {
    save.mockResolvedValue('/home/me/x.bin');

    await tauriSaver.save({
      fileName: 'x.bin',
      mimeType: 'application/octet-stream',
      data: new Blob([new Uint8Array([1, 2, 3])]),
    });

    expect(writeTextFile).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith('/home/me/x.bin', new Uint8Array([1, 2, 3]));
  });

  it('reports a failed write without throwing', async () => {
    save.mockResolvedValue('/read-only/x.json');
    writeTextFile.mockRejectedValue(new Error('disk full'));

    await expect(tauriSaver.save(request)).resolves.toEqual({
      ok: false,
      reason: 'disk full',
    });
  });

  it('explains a scope refusal at the call site, not just in the helper', async () => {
    save.mockResolvedValue('D:\\backups\\x.json');
    writeTextFile.mockRejectedValue(new Error('forbidden path: D:\\backups\\x.json'));

    const result = await tauriSaver.save(request);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('home folder');
  });
});

describe('dialogFilters', () => {
  it('derives the filter from the suggested name', () => {
    expect(dialogFilters({...request, fileName: 'x.CSV'})).toEqual([
      {name: 'CSV file', extensions: ['csv']},
    ]);
  });

  it('offers no filter when there is no extension to offer', () => {
    for (const fileName of ['backup', '.gitignore', 'trailing.']) {
      expect(dialogFilters({...request, fileName})).toEqual([]);
    }
  });
});

describe('explainWriteFailure', () => {
  it('turns a scope refusal into something the user can act on', () => {
    const message = explainWriteFailure(new Error('forbidden path: D:\\backups\\x.json'));
    expect(message).toContain('forbidden path');
    expect(message).toContain('Documents, Downloads, Desktop');
  });

  it('leaves any other failure exactly as it was', () => {
    expect(explainWriteFailure(new Error('disk full'))).toBe('disk full');
  });
});
