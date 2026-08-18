/**
 * The sync section of the Settings screen.
 *
 * Everything about sync that a person can see or do is here, and it is
 * deliberately one section on an existing screen rather than a destination of
 * its own: sync is a setting, not a feature you visit. The nav has no entry
 * for it and nothing else in the app mentions it, which is the honest
 * presentation of something that is off until you turn it on.
 *
 * What it insists on showing, because each answers a question that is
 * otherwise unanswerable from inside the app:
 *
 *   - **How many changes have not reached the cloud.** "Synced" with a queue
 *     behind it is the claim that would cost someone real data.
 *   - **The actual error text.** A generic "sync failed" turns a wrong
 *     password, an expired session and a dead connection into one
 *     indistinguishable state.
 *   - **That the local copy is the real one.** Signing out is not a data loss
 *     event here, and saying so is what makes signing out feel safe enough to
 *     do.
 */
import {useState} from 'react';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Heading} from '@astryxdesign/core/Heading';
import {Section} from '@astryxdesign/core/Section';
import {Stack} from '@astryxdesign/core/Stack';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {useSync, type SyncState} from './sync-context';

export function SyncSettings() {
  const sync = useSync();

  return (
    <Section>
      <Stack gap={3}>
        <Stack gap={1}>
          <Heading level={2}>Cloud sync</Heading>
          <Text type="supporting" as="p">
            Optional. Keeps this device and any other you sign in on carrying
            the same data. Everything works without it — your data lives on
            this device either way, and syncing adds a copy rather than moving
            it somewhere.
          </Text>
        </Stack>

        {sync.state === 'unconfigured' ? (
          <Banner
            status="info"
            title="Sync is not set up in this build"
            description="No Supabase project is configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env and restart to enable it."
          />
        ) : sync.email === null ? (
          <SignInForm />
        ) : (
          <SignedIn />
        )}
      </Stack>
    </Section>
  );
}

function SignInForm() {
  const {signIn, signUp} = useSync();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'in' | 'up' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canSubmit = email.trim() !== '' && password !== '' && busy === null;

  async function attempt(kind: 'in' | 'up') {
    setBusy(kind);
    setError(null);
    setNotice(null);

    try {
      if (kind === 'in') {
        await signIn(email.trim(), password);
      } else {
        const {needsConfirmation} = await signUp(email.trim(), password);
        if (needsConfirmation) {
          setNotice(
            `Check ${email.trim()} for a confirmation link, then sign in here.`,
          );
        }
      }
      // Cleared on success either way: leaving a password in a controlled
      // input keeps it in memory for as long as the screen is mounted.
      setPassword('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Stack gap={3}>
      <TextInput
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        htmlName="email"
        width="100%"
      />
      <TextInput
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        description="At least six characters."
        htmlName="new-password"
        width="100%"
      />

      {error ? <Banner status="error" title="That did not work" description={error} /> : null}
      {notice ? <Banner status="info" title="Almost there" description={notice} /> : null}

      <Stack direction="horizontal" gap={2} hAlign="start">
        <Button
          label="Sign in"
          variant="primary"
          isDisabled={!canSubmit}
          isLoading={busy === 'in'}
          onClick={() => void attempt('in')}
        />
        <Button
          label="Create account"
          variant="secondary"
          isDisabled={!canSubmit}
          isLoading={busy === 'up'}
          onClick={() => void attempt('up')}
        />
      </Stack>
    </Stack>
  );
}

function SignedIn() {
  const {email, state, pendingCount, lastSyncedAt, error, syncNow, signOut} = useSync();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap={3}>
      <Stack direction="horizontal" gap={2} vAlign="center" hAlign="start">
        <StatusDot
          variant={dotVariant(state, pendingCount)}
          label={describeState(state, pendingCount)}
          isPulsing={state === 'syncing'}
        />
        <Text as="p">{describeState(state, pendingCount)}</Text>
      </Stack>

      <Text type="supporting" as="p">
        Signed in as {email}. Last synced {describeLastSync(lastSyncedAt)}.
      </Text>

      {error ? (
        <Banner
          status="error"
          title="The last sync did not finish"
          description={`${error} Nothing was lost — the changes are still queued on this device and will go up on the next try.`}
        />
      ) : null}

      <Stack direction="horizontal" gap={2} hAlign="start">
        <Button
          label="Sync now"
          variant="secondary"
          isDisabled={busy || state === 'syncing'}
          isLoading={state === 'syncing'}
          onClick={() => void run(syncNow)}
        />
        <Button
          label="Sign out"
          variant="ghost"
          isDisabled={busy}
          onClick={() => void run(signOut)}
        />
      </Stack>

      <Text type="supporting" as="p">
        Signing out stops syncing and leaves everything on this device exactly
        as it is. It does not delete anything, here or in the cloud.
      </Text>
    </Stack>
  );
}

function dotVariant(
  state: SyncState,
  pendingCount: number,
): 'success' | 'warning' | 'error' | 'accent' | 'neutral' {
  if (state === 'error') return 'error';
  if (state === 'syncing') return 'accent';
  if (pendingCount > 0) return 'warning';
  return state === 'idle' ? 'success' : 'neutral';
}

function describeState(state: SyncState, pendingCount: number): string {
  if (state === 'syncing') return 'Syncing…';
  if (state === 'error') return 'Not synced';
  if (pendingCount > 0) {
    return `${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'} waiting to go up`;
  }
  return 'Everything is synced';
}

function describeLastSync(at: number | null): string {
  if (at === null) return 'never';

  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }
  // Beyond an hour the exact wall-clock time is more use than an approximation
  // — "yesterday" and "on Tuesday at 09:14" answer different questions, and
  // this is the one someone asks when they are checking whether it is stuck.
  return new Date(at).toLocaleString();
}
