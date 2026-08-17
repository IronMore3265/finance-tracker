/**
 * Delete with an Undo, everywhere.
 *
 * Friction fix 4 of PROGRESS.md §6. Deletes are already soft and reversible at
 * the data layer — `repo.softDelete` sets `deletedAt` and `repo.restore` clears
 * it — so all that was missing was an affordance. This hook is that affordance,
 * shared so that no screen forgets it and every screen words it the same way.
 *
 * Why a toast with Undo instead of an "Are you sure?" dialog: a confirmation
 * interrupts the 99% of deletes that are intended, to guard the 1% that are
 * not. An undo does the reverse, and matches the fact that nothing is actually
 * destroyed — the row is in Trash either way. Confirmation dialogs are kept
 * for genuinely irreversible actions (purging trash, merging categories).
 */
import {createElement, useCallback} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {useToast} from '@astryxdesign/core/Toast';

/**
 * The toast's trailing action.
 *
 * Built with `createElement` rather than JSX so this stays a `.ts` hooks
 * module: one element in one place does not justify making the whole file a
 * component file.
 */
function undoButton(onUndo: () => void) {
  return createElement(Button, {
    label: 'Undo',
    variant: 'secondary',
    size: 'sm',
    onClick: onUndo,
  });
}

/** Just enough of a repository to delete and put back. */
export interface Undoable {
  softDelete(id: string): Promise<boolean>;
  restore(id: string): Promise<boolean>;
}

export interface DeleteRequest {
  /** What was deleted, as it should read in the toast: "Coffee", "3 transactions". */
  label: string;
}

export type DeleteWithUndo = (
  repo: Undoable,
  id: string,
  request: DeleteRequest,
) => Promise<void>;

export function useUndoableDelete(): DeleteWithUndo {
  const toast = useToast();

  return useCallback(
    async (repo, id, {label}) => {
      const deleted = await repo.softDelete(id);
      if (!deleted) return;

      toast({
        body: `${label} deleted`,
        type: 'info',
        // Longer than the 5s default: an undo the user cannot reach in time is
        // not an undo. Anything missed is still recoverable from Trash.
        autoHideDuration: 8000,
        // Deleting three rows in a row should leave one toast showing the last
        // action, not a stack of three racing each other off screen.
        uniqueID: 'row-deleted',
        collisionBehavior: 'overwrite',
        endContent: undoButton(() => {
          void repo.restore(id);
        }),
      });
    },
    [toast],
  );
}

/**
 * The bulk variant, for multi-select on the transactions list.
 *
 * Restores exactly the ids that were actually deleted, not the ids that were
 * selected: a row already gone (deleted in another tab, say) must not be
 * resurrected by an undo that was never meant to cover it.
 */
export type DeleteManyWithUndo = (
  repo: UndoableMany,
  ids: readonly string[],
  request: {singular: string; plural: string},
) => Promise<number>;

export interface UndoableMany {
  softDeleteMany(ids: readonly string[]): Promise<number>;
  restoreMany(ids: readonly string[]): Promise<number>;
  get(id: string): Promise<unknown>;
}

export function useUndoableDeleteMany(): DeleteManyWithUndo {
  const toast = useToast();

  return useCallback(
    async (repo, ids, {singular, plural}) => {
      // Narrow to rows that are live *now*, so the undo list matches what this
      // call actually removed.
      const present = (
        await Promise.all(
          ids.map(async (id) => ((await repo.get(id)) ? id : null)),
        )
      ).filter((id): id is string => id !== null);

      if (present.length === 0) return 0;

      const count = await repo.softDeleteMany(present);
      const noun = count === 1 ? singular : plural;

      toast({
        body: `${count} ${noun} deleted`,
        type: 'info',
        autoHideDuration: 8000,
        uniqueID: 'row-deleted',
        collisionBehavior: 'overwrite',
        endContent: undoButton(() => {
          void repo.restoreMany(present);
        }),
      });

      return count;
    },
    [toast],
  );
}
