/**
 * The registration contract, which is what the whole platform layer rests on.
 *
 * The browser saver itself is not exercised here — it needs a DOM, and the
 * vitest environment is `node`. What is tested is everything the native builds
 * depend on: that registering replaces the saver, that restoring puts the
 * previous one back, and that `saveFile` reports a failure rather than
 * rejecting, because every caller is a button handler that has to say
 * something either way.
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  activeFileSaverName,
  registerFileSaver,
  saveFile,
  timestampedFileName,
  type FileSaver,
} from './fs';

const restores: Array<() => void> = [];

function install(saver: FileSaver) {
  restores.push(registerFileSaver(saver));
}

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
});

const request = {fileName: 'backup.json', mimeType: 'application/json', data: '{}'};

describe('registerFileSaver', () => {
  it('starts on the browser saver', () => {
    expect(activeFileSaverName()).toBe('browser');
  });

  it('replaces the active saver and restores the previous one', () => {
    install({name: 'first', save: async () => ({ok: true, location: '/one'})});
    expect(activeFileSaverName()).toBe('first');

    install({name: 'second', save: async () => ({ok: true, location: '/two'})});
    expect(activeFileSaverName()).toBe('second');

    restores.pop()?.();
    expect(activeFileSaverName()).toBe('first');
  });
});

describe('saveFile', () => {
  it('dispatches to the registered saver', async () => {
    const save = vi.fn(async () => ({ok: true as const, location: '/sdcard/backup.json'}));
    install({name: 'fake', save});

    await expect(saveFile(request)).resolves.toEqual({
      ok: true,
      location: '/sdcard/backup.json',
    });
    expect(save).toHaveBeenCalledWith(request);
  });

  it('turns a thrown saver into a failed result', async () => {
    install({
      name: 'throwing',
      save: async () => {
        throw new Error('no such directory');
      },
    });

    const result = await saveFile(request);
    expect(result).toEqual({ok: false, reason: 'no such directory'});
  });

  it('describes a non-Error rejection rather than losing it', async () => {
    install({
      name: 'throwing',
      save: async () => {
        throw 'EACCES';
      },
    });

    const result = await saveFile(request);
    expect(result).toEqual({ok: false, reason: 'EACCES'});
  });

  it('passes a cancellation through untouched', async () => {
    install({
      name: 'cancelling',
      save: async () => ({ok: false as const, cancelled: true as const, reason: 'Save cancelled'}),
    });

    const result = await saveFile(request);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.cancelled).toBe(true);
  });
});

describe('timestampedFileName', () => {
  it('sorts by date in a folder listing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 3, 9, 30));
    expect(timestampedFileName('finance-tracker-backup', 'json')).toBe(
      'finance-tracker-backup-2026-08-03.json',
    );
    vi.useRealTimers();
  });
});
