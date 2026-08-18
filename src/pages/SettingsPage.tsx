/**
 * Appearance, privacy, sync, and getting data in and out.
 *
 * The export/restore pair is what makes the advice in PROGRESS.md §7 —
 * "keep the old app installed until Phase 6 verification passes" — honest.
 * Two copies of real financial data beats one behind unproven sync, and a
 * file is a second copy that depends on nothing.
 *
 * Saving goes through `platform/fs.ts` rather than touching an anchor here, so
 * Phase 7 can register a Capacitor or Tauri saver without this screen
 * changing. The name of the active saver is shown next to the button, because
 * "I pressed export and nothing happened" is otherwise undiagnosable.
 */
import {useState} from 'react';
import {AlertDialog} from '@astryxdesign/core/AlertDialog';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {FileInput} from '@astryxdesign/core/FileInput';
import {Heading} from '@astryxdesign/core/Heading';
import {Section} from '@astryxdesign/core/Section';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {Stack} from '@astryxdesign/core/Stack';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {useThemeMode, type ThemeMode} from '../app/theme-mode';
import {usePrivacyMode} from '../app/privacy-mode';
import {
  exportBackup,
  importBackup,
  parseBackupText,
  summarizeBackup,
  type BackupSummary,
  type ImportMode,
} from '../db/backup';
import {activeFileSaverName, saveFile, timestampedFileName} from '../platform/fs';
import {SyncSettings} from '../sync/SyncSettings';
import {Page} from '../components/Page';

export function SettingsPage() {
  const {mode, setMode} = useThemeMode();
  const {isHidden, setIsHidden} = usePrivacyMode();

  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [pending, setPending] = useState<{
    parsed: unknown;
    summary: BackupSummary;
  } | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('replace');
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  async function runExport() {
    setExportError(null);
    setExportMessage(null);

    const backup = await exportBackup();
    const result = await saveFile({
      fileName: timestampedFileName('finance-tracker-backup', 'json'),
      mimeType: 'application/json',
      // Indented: a backup that a human can open and read is a backup they can
      // also repair by hand, which matters when it is the only copy.
      data: JSON.stringify(backup, null, 2),
    });

    if (result.ok) {
      setExportMessage(
        result.location === ''
          ? 'Backup saved.'
          : `Backup saved to ${result.location}.`,
      );
    } else {
      setExportError(result.reason);
    }
  }

  async function stageImport(file: File | File[] | null) {
    setImportError(null);
    setImportMessage(null);

    const chosen = Array.isArray(file) ? file[0] : file;
    if (!chosen) {
      setPending(null);
      return;
    }

    try {
      const parsed = parseBackupText(await chosen.text());
      setPending({parsed, summary: summarizeBackup(parsed)});
    } catch (error) {
      setPending(null);
      setImportError(error instanceof Error ? error.message : String(error));
    }
  }

  async function confirmImport() {
    if (!pending) return;
    setIsRestoring(true);
    try {
      const summary = await importBackup(pending.parsed, importMode);
      setImportMessage(
        `Restored ${summary.total} ${summary.total === 1 ? 'row' : 'rows'}.`,
      );
      setPending(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRestoring(false);
    }
  }

  return (
    <Page
      title="Settings"
      description="Appearance, privacy, sync, and getting your data in and out."
    >
      <Section>
        <Stack gap={3}>
          <Stack gap={1}>
            <Heading level={2}>Appearance</Heading>
            <Text type="supporting" as="p">
              System follows your device's light or dark setting.
            </Text>
          </Stack>
          {/* A horizontal Stack so the control sizes to its three options.
              Left in the vertical Stack it stretches to the full section
              width, which reads as a toolbar rather than a choice. */}
          <Stack direction="horizontal" hAlign="start">
            <SegmentedControl
              label="Colour mode"
              value={mode}
              onChange={(next) => setMode(next as ThemeMode)}
            >
              <SegmentedControlItem value="system" label="System" />
              <SegmentedControlItem value="light" label="Light" />
              <SegmentedControlItem value="dark" label="Dark" />
            </SegmentedControl>
          </Stack>
        </Stack>
      </Section>

      <Section>
        <Stack gap={3}>
          <Stack gap={1}>
            <Heading level={2}>Privacy</Heading>
            <Text type="supporting" as="p">
              There is no telemetry and no analytics, and nothing leaves this
              device unless you turn on cloud sync below — which is off until
              you sign in, and stays off if you never do.
            </Text>
          </Stack>
          <Switch
            label="Hide amounts on screen"
            description="Replaces every figure with dots until you turn this off. For checking something in public."
            value={isHidden}
            onChange={setIsHidden}
            labelPosition="start"
            labelSpacing="spread"
            width="100%"
          />
        </Stack>
      </Section>

      <SyncSettings />

      <Section>
        <Stack gap={3}>
          <Stack gap={1}>
            <Heading level={2}>Back up</Heading>
            <Text type="supporting" as="p">
              A complete copy of everything, ids and all, so a restore brings
              back exactly what you had — including the trash. Saved via the{' '}
              {activeFileSaverName()} file handler.
            </Text>
          </Stack>
          <Stack direction="horizontal" hAlign="start">
            <Button label="Export a backup" variant="primary" clickAction={runExport} />
          </Stack>
          {exportMessage ? (
            <Banner status="success" title={exportMessage} />
          ) : null}
          {exportError ? (
            <Banner status="error" title="Could not save the backup" description={exportError} />
          ) : null}
        </Stack>
      </Section>

      <Section>
        <Stack gap={3}>
          <Stack gap={1}>
            <Heading level={2}>Restore</Heading>
            <Text type="supporting" as="p">
              Read a backup file. You will see what is in it before anything is
              written.
            </Text>
          </Stack>

          <FileInput
            label="Backup file"
            value={null}
            onChange={(file) => void stageImport(file)}
            accept="application/json,.json"
            mode="dropzone"
            width="100%"
          />

          {importError ? (
            <Banner status="error" title="That file could not be read" description={importError} />
          ) : null}
          {importMessage ? <Banner status="success" title={importMessage} /> : null}

          {pending ? (
            <Stack gap={3}>
              <Banner
                status="info"
                title={`Backup from ${formatExportedAt(pending.summary.exportedAt)}`}
                description={describeContents(pending.summary)}
              />
              <SegmentedControl
                label="How to restore"
                value={importMode}
                onChange={(next) => setImportMode(next as ImportMode)}
              >
                <SegmentedControlItem value="replace" label="Replace everything" />
                <SegmentedControlItem value="merge" label="Merge into what is here" />
              </SegmentedControl>
              <Text type="supporting" as="p">
                {importMode === 'replace'
                  ? 'Clears the current data first. The backup becomes the whole truth.'
                  : 'Keeps what is here. Where a row exists in both, the backup wins.'}
              </Text>
              <Stack direction="horizontal" gap={2} hAlign="start">
                <Button
                  label="Restore"
                  variant="destructive"
                  // Opening the confirmation is all this does; the write is
                  // behind the AlertDialog below.
                  onClick={() => setIsConfirmOpen(true)}
                />
                <Button
                  label="Cancel"
                  variant="ghost"
                  onClick={() => setPending(null)}
                />
              </Stack>
            </Stack>
          ) : null}
        </Stack>
      </Section>

      <AlertDialog
        isOpen={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        title={
          importMode === 'replace'
            ? 'Replace everything on this device?'
            : 'Merge this backup in?'
        }
        description={
          importMode === 'replace'
            ? 'The current data is cleared first and cannot be recovered afterwards. Export a backup of what is here now if you are not sure.'
            : 'Rows that exist in both are overwritten by the backup. Anything not in the backup is left alone.'
        }
        actionLabel="Restore"
        onAction={() => {
          void confirmImport().then(() => setIsConfirmOpen(false));
        }}
        isActionLoading={isRestoring}
      />
    </Page>
  );
}

function formatExportedAt(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return 'an unknown date';
  return new Date(parsed).toLocaleString();
}

function describeContents(summary: BackupSummary): string {
  const parts = Object.entries(summary.counts)
    .filter(([, count]) => count > 0)
    .map(([table, count]) => `${count} ${humanise(table, count)}`);

  return parts.length === 0 ? 'It contains no rows.' : parts.join(', ');
}

function humanise(table: string, count: number): string {
  const singular: Record<string, string> = {
    accounts: 'account',
    categories: 'category',
    transactions: 'transaction',
    plannedTransactions: 'planned entry',
    plannedExceptions: 'occurrence change',
    debts: 'debt',
    debtPayments: 'debt payment',
    budgets: 'budget',
  };

  const word = singular[table] ?? table;
  if (count === 1) return word;
  return word.endsWith('y') ? `${word.slice(0, -1)}ies` : `${word}s`;
}
