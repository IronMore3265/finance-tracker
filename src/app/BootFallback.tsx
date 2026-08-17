/**
 * Shown while the root route's loader opens IndexedDB and seeds categories.
 *
 * Normally invisible — Dexie opens in single-digit milliseconds — but it is
 * what stands between the user and a white screen when the browser decides to
 * take its time (a first-run schema upgrade, a cold profile, a throttled tab).
 */
import {Spinner} from '@astryxdesign/core/Spinner';
import {Stack} from '@astryxdesign/core/Stack';

export function BootFallback() {
  return (
    <Stack height="100dvh" hAlign="center" vAlign="center" padding={6}>
      <Spinner size="lg" label="Loading your data" />
    </Stack>
  );
}
