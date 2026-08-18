/**
 * What the bootstrap must guarantee:
 *
 *   - the web imports neither native SDK,
 *   - each shell gets its own saver,
 *   - and a plugin that fails to load leaves the app on the browser saver
 *     instead of taking the render down with it.
 *
 * The saver modules are mocked, so this is about the wiring rather than about
 * Capacitor or Tauri — those cannot run outside their shells at all.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const capacitorModule = vi.hoisted(() => ({
  capacitorSaver: {name: 'Android', save: vi.fn()},
}));
const tauriModule = vi.hoisted(() => ({
  tauriSaver: {name: 'desktop', save: vi.fn()},
}));
const backModule = vi.hoisted(() => ({
  installAndroidBackButton: vi.fn(async () => () => {}),
}));

vi.mock('./savers/capacitor', () => capacitorModule);
vi.mock('./savers/tauri', () => tauriModule);
vi.mock('./android-back', () => backModule);

import {activeFileSaverName, registerFileSaver} from './fs';
import {installNativePlatform} from './native';

let restore: (() => void) | undefined;

beforeEach(() => {
  // Every case starts from the browser saver, whatever the previous one left.
  restore = registerFileSaver({name: 'browser', save: vi.fn()});
  backModule.installAndroidBackButton.mockClear();
});

afterEach(() => {
  restore?.();
  vi.doUnmock('./savers/capacitor');
  vi.resetModules();
});

describe('installNativePlatform', () => {
  it('does nothing on the web', async () => {
    const result = await installNativePlatform('web');

    expect(result).toEqual({host: 'web', installed: false});
    expect(activeFileSaverName()).toBe('browser');
    expect(backModule.installAndroidBackButton).not.toHaveBeenCalled();
  });

  it('installs the Android saver and the back button for a Capacitor host', async () => {
    const result = await installNativePlatform('capacitor');

    expect(result).toEqual({host: 'capacitor', installed: true});
    expect(activeFileSaverName()).toBe('Android');
    // Without this the system back button quits the app from any screen.
    expect(backModule.installAndroidBackButton).toHaveBeenCalledTimes(1);
  });

  it('installs the desktop saver for a Tauri host', async () => {
    const result = await installNativePlatform('tauri');

    expect(result).toEqual({host: 'tauri', installed: true});
    expect(activeFileSaverName()).toBe('desktop');
    expect(backModule.installAndroidBackButton).not.toHaveBeenCalled();
  });

  it('keeps the browser saver when the native module fails to load', async () => {
    vi.doMock('./savers/capacitor', () => {
      throw new Error('plugin missing from this build');
    });
    vi.resetModules();
    // Both are re-imported from the reset registry, so the name being asserted
    // is the one the reloaded bootstrap would have overwritten.
    const {installNativePlatform: reloaded} = await import('./native');
    const {activeFileSaverName: reloadedSaverName} = await import('./fs');

    const result = await reloaded('capacitor');

    expect(result.installed).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(reloadedSaverName()).toBe('browser');
  });
});
