/**
 * The detection rules, tested without a WebView.
 *
 * Every case here is one that actually happens: a browser tab, a browser tab
 * where something pulled in `@capacitor/core` (which installs the global and
 * answers false), an Android shell, a desktop shell, and a bridge that is
 * present but broken.
 */
import {describe, expect, it} from 'vitest';
import {detectHost, isNativeHost, type HostGlobals} from './host';

describe('detectHost', () => {
  it('reports web when no shell has injected anything', () => {
    expect(detectHost({})).toBe('web');
  });

  it('reports capacitor only when the bridge says it is native', () => {
    expect(detectHost({Capacitor: {isNativePlatform: () => true}})).toBe('capacitor');
  });

  it('reports web when @capacitor/core installed the global in a browser', () => {
    // This is the case that makes a presence check wrong: the global exists,
    // and the answer is still "you are on the web".
    expect(detectHost({Capacitor: {isNativePlatform: () => false}})).toBe('web');
  });

  it('reports web for a Capacitor global with no bridge method', () => {
    expect(detectHost({Capacitor: {}})).toBe('web');
  });

  it('reports web rather than throwing when the bridge throws', () => {
    expect(
      detectHost({
        Capacitor: {
          isNativePlatform: () => {
            throw new Error('bridge is gone');
          },
        },
      }),
    ).toBe('web');
  });

  it('reports tauri from either global it sets', () => {
    expect(detectHost({__TAURI_INTERNALS__: {invoke: () => {}}})).toBe('tauri');
    expect(detectHost({isTauri: true})).toBe('tauri');
  });

  it('does not read a falsy isTauri as tauri', () => {
    expect(detectHost({isTauri: false})).toBe('web');
  });

  it('prefers tauri when both globals are somehow present', () => {
    // Not expected in the wild, but the answer must be deterministic rather
    // than dependent on check order changing later.
    expect(
      detectHost({isTauri: true, Capacitor: {isNativePlatform: () => true}}),
    ).toBe('tauri');
  });
});

describe('isNativeHost', () => {
  it('is false on the web and true in either shell', () => {
    const cases: Array<[HostGlobals, boolean]> = [
      [{}, false],
      [{Capacitor: {isNativePlatform: () => false}}, false],
      [{Capacitor: {isNativePlatform: () => true}}, true],
      [{isTauri: true}, true],
    ];
    for (const [scope, expected] of cases) {
      expect(isNativeHost(scope)).toBe(expected);
    }
  });
});
