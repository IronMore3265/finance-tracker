/**
 * Deleted rows, and the way back.
 *
 * The other half of friction fix 4: the undo toast catches the mistake you
 * notice immediately, and this catches the one you notice next week. Deletes
 * are soft everywhere (`repo.softDelete` sets `deletedAt`), so nothing on this
 * screen is a special case — restoring is just clearing that column.
 *
 * Emptying the trash is the one genuinely irreversible action in the app, and
 * it carries a caveat worth stating on screen: `purge` deliberately does not
 * enqueue an outbox entry. There is no tombstone protocol yet, so a permanent
 * delete is local-only and a peer that still holds the row could push it back
 * once sync lands in Phase 5.
 */
import {useMemo, useState} from 'react';
import {AlertDialog} from '@astryxdesign/core/AlertDialog';
import {Badge} from '@astryxdesign/core/Badge';
import {Button} from '@astryxdesign/core/Button';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Icon} from '@astryxdesign/core/Icon';
import {Item} from '@astryxdesign/core/Item';
import {List} from '@astryxdesign/core/List';
import {Section} from '@astryxdesign/core/Section';
import {Stack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Trash2} from 'lucide-react';
import {useTrash, type TrashEntry} from '../db/queries';
import {REPOSITORIES} from '../db/repositories';
import {describeRelativeDay} from '../format/dates';
import {Page} from '../components/Page';

export function TrashPage() {
  const entries = useTrash();
  const [isConfirmingEmpty, setIsConfirmingEmpty] = useState(false);
  const [isEmptying, setIsEmptying] = useState(false);

  const count = entries?.length ?? 0;

  const grouped = useMemo(() => groupByDeletionDay(entries ?? []), [entries]);

  async function restore(entry: TrashEntry) {
    await REPOSITORIES[entry.table].restore(entry.id);
  }

  async function purge(entry: TrashEntry) {
    await REPOSITORIES[entry.table].purge(entry.id);
  }

  async function emptyAll() {
    setIsEmptying(true);
    try {
      // Purges exactly what was listed, not "everything deleted": a row soft-
      // deleted in another tab while this dialog was open has not been shown
      // to the user and should not be destroyed by a click they made before
      // it existed.
      for (const entry of entries ?? []) {
        await REPOSITORIES[entry.table].purge(entry.id);
      }
      setIsConfirmingEmpty(false);
    } finally {
      setIsEmptying(false);
    }
  }

  return (
    <Page
      title="Trash"
      description="Everything you have deleted. Nothing here is gone until you empty it."
      actions={
        count > 0 ? (
          <Button
            label="Empty trash"
            variant="destructive"
            onClick={() => setIsConfirmingEmpty(true)}
          />
        ) : null
      }
    >
      {entries === undefined ? null : count === 0 ? (
        <Section variant="muted" padding={8}>
          <EmptyState
            headingLevel={2}
            icon={<Icon icon={Trash2} size="lg" />}
            title="Trash is empty"
            description="Deleted transactions, accounts and categories land here first, so a mistake is never final."
          />
        </Section>
      ) : (
        <Stack gap={4}>
          {grouped.map(([day, items]) => (
            <Section key={day} padding={0}>
              <List
                hasDividers
                header={
                  <Stack paddingInline={4} paddingBlock={3}>
                    <Text weight="semibold">{day}</Text>
                  </Stack>
                }
              >
                {items.map((entry) => (
                  <Item
                    key={`${entry.table}-${entry.id}`}
                    as="li"
                    label={entry.label}
                    startContent={<Icon icon={Trash2} />}
                    description={describeRelativeDay(entry.deletedAt)}
                    endContent={
                      <Stack direction="horizontal" gap={2} vAlign="center">
                        <Badge variant="neutral" label={entry.detail} />
                        <Button
                          label="Restore"
                          size="sm"
                          clickAction={() => restore(entry)}
                        />
                        <Button
                          label="Delete forever"
                          size="sm"
                          variant="ghost"
                          clickAction={() => purge(entry)}
                        />
                      </Stack>
                    }
                  />
                ))}
              </List>
            </Section>
          ))}
        </Stack>
      )}

      <AlertDialog
        isOpen={isConfirmingEmpty}
        onOpenChange={setIsConfirmingEmpty}
        title="Empty the trash?"
        description={`This permanently removes ${count} ${count === 1 ? 'item' : 'items'} from this device. It cannot be undone, and it does not travel to other devices — a device that still holds a copy may restore it when sync arrives.`}
        actionLabel="Delete forever"
        onAction={() => void emptyAll()}
        isActionLoading={isEmptying}
      />
    </Page>
  );
}

/**
 * Grouped by the day of deletion.
 *
 * "I deleted something on Tuesday" is how people actually look for a deleted
 * row, and a flat list of 200 items sorted by timestamp does not answer it.
 */
function groupByDeletionDay(entries: readonly TrashEntry[]): [string, TrashEntry[]][] {
  const groups = new Map<string, TrashEntry[]>();

  for (const entry of entries) {
    const key = describeRelativeDay(entry.deletedAt);
    const existing = groups.get(key);
    if (existing) existing.push(entry);
    else groups.set(key, [entry]);
  }

  // Insertion order is already newest-first, because `useTrash` sorts before
  // this runs and Map preserves insertion order.
  return [...groups.entries()];
}
