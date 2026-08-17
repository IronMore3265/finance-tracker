/**
 * Category management.
 *
 * Friction fix 5 of PROGRESS.md §6, and the reason categories were promoted
 * from a bare string on each transaction to a real table: a string cannot be
 * renamed without orphaning history, cannot carry a per-category budget, and
 * cannot be merged when the same thing was entered under two names.
 *
 * Merge is the operation worth care. It rewrites every transaction, planned
 * rule, per-occurrence override and budget that pointed at the source, then
 * retires the source — see `mergeCategories`, which does all of it in one
 * transaction. It is the only action here behind a confirmation dialog, since
 * unlike a delete it cannot be undone by restoring the row.
 */
import {useMemo, useState} from 'react';
import {Badge} from '@astryxdesign/core/Badge';
import {Button} from '@astryxdesign/core/Button';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Item} from '@astryxdesign/core/Item';
import {List} from '@astryxdesign/core/List';
import {MoreMenu} from '@astryxdesign/core/MoreMenu';
import {Section} from '@astryxdesign/core/Section';
import {Selector} from '@astryxdesign/core/Selector';
import {Stack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {ArrowDown, ArrowUp, Plus, Tags} from 'lucide-react';
import {applyDisplayOrder, mergeCategories} from '../db/commands';
import {useCategories, useTransactions} from '../db/queries';
import {categoriesRepo} from '../db/repositories';
import type {Category, CategoryKind} from '../db/types';
import {EntityIcon} from '../components/EntityIcon';
import {FormDialog} from '../components/FormDialog';
import {Page} from '../components/Page';
import {ColorPicker, IconPicker} from '../components/Pickers';
import {useUndoableDelete} from '../components/useUndoableDelete';

const KIND_OPTIONS = [
  {value: 'EXPENSE', label: 'Expense'},
  {value: 'INCOME', label: 'Income'},
  {value: 'BOTH', label: 'Both'},
];

const KIND_BADGE: Record<CategoryKind, 'red' | 'green' | 'neutral'> = {
  EXPENSE: 'red',
  INCOME: 'green',
  BOTH: 'neutral',
};

export function CategoriesPage() {
  const categories = useCategories();
  const transactions = useTransactions();
  const deleteWithUndo = useUndoableDelete();

  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [merging, setMerging] = useState<Category | null>(null);

  /** How many transactions each category is carrying, shown on its row. */
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const txn of transactions ?? []) {
      if (txn.categoryId === null) continue;
      counts.set(txn.categoryId, (counts.get(txn.categoryId) ?? 0) + 1);
    }
    return counts;
  }, [transactions]);

  async function move(index: number, delta: number) {
    if (!categories) return;
    const target = index + delta;
    if (target < 0 || target >= categories.length) return;

    const ordered = categories.map((category) => category.id);
    const [moved] = ordered.splice(index, 1);
    if (moved === undefined) return;
    ordered.splice(target, 0, moved);

    await applyDisplayOrder('categories', ordered);
  }

  return (
    <Page
      title="Categories"
      description="Rename, recolour, reorder, or fold two categories into one."
      actions={
        <Button
          label="New category"
          variant="primary"
          icon={<Icon icon={Plus} />}
          onClick={() => setEditing('new')}
        />
      }
    >
      {categories === undefined ? null : categories.length === 0 ? (
        <Section variant="muted" padding={8}>
          <EmptyState
            headingLevel={2}
            icon={<Icon icon={Tags} size="lg" />}
            title="No categories"
            description="Categories group your spending so budgets and analytics have something to measure."
            actions={
              <Button
                label="New category"
                variant="primary"
                onClick={() => setEditing('new')}
              />
            }
          />
        </Section>
      ) : (
        <Section padding={0}>
          <List hasDividers>
            {categories.map((category, index) => (
              <Item
                key={category.id}
                as="li"
                label={category.name}
                startContent={
                  <EntityIcon name={category.icon} color={category.colorHex} />
                }
                description={describeUsage(usage.get(category.id) ?? 0)}
                endContent={
                  <Stack direction="horizontal" gap={1} vAlign="center">
                    <Badge
                      variant={KIND_BADGE[category.kind]}
                      label={kindLabel(category.kind)}
                    />
                    <IconButton
                      label={`Move ${category.name} up`}
                      icon={<Icon icon={ArrowUp} />}
                      variant="ghost"
                      size="sm"
                      isDisabled={index === 0}
                      clickAction={() => move(index, -1)}
                    />
                    <IconButton
                      label={`Move ${category.name} down`}
                      icon={<Icon icon={ArrowDown} />}
                      variant="ghost"
                      size="sm"
                      isDisabled={index === categories.length - 1}
                      clickAction={() => move(index, 1)}
                    />
                    <MoreMenu
                      label={`Actions for ${category.name}`}
                      alignment="end"
                      items={[
                        {label: 'Edit', onClick: () => setEditing(category)},
                        {
                          label: 'Merge into…',
                          onClick: () => setMerging(category),
                          isDisabled: categories.length < 2,
                        },
                        {type: 'divider'},
                        {
                          label: 'Delete',
                          variant: 'destructive',
                          onClick: () =>
                            void deleteWithUndo(categoriesRepo, category.id, {
                              label: category.name,
                            }),
                        },
                      ]}
                    />
                  </Stack>
                }
              />
            ))}
          </List>
        </Section>
      )}

      {editing !== null ? (
        <CategoryDialog
          category={editing === 'new' ? null : editing}
          nextOrder={categories?.length ?? 0}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {merging !== null && categories !== undefined ? (
        <MergeDialog
          source={merging}
          candidates={categories.filter((c) => c.id !== merging.id)}
          onClose={() => setMerging(null)}
        />
      ) : null}
    </Page>
  );
}

function describeUsage(count: number): string {
  if (count === 0) return 'Not used yet';
  return count === 1 ? '1 transaction' : `${count} transactions`;
}

function kindLabel(kind: CategoryKind): string {
  return kind === 'BOTH' ? 'Both' : kind === 'INCOME' ? 'Income' : 'Expense';
}

/** Create or edit — the same form either way, which is the Phase 3 point. */
function CategoryDialog({
  category,
  nextOrder,
  onClose,
}: {
  category: Category | null;
  nextOrder: number;
  onClose: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState(category?.icon ?? 'circle-ellipsis');
  const [colorHex, setColorHex] = useState(category?.colorHex ?? '#2196F3');
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? 'EXPENSE');

  const trimmed = name.trim();

  async function submit() {
    if (trimmed.length === 0) return false;

    if (category) {
      await categoriesRepo.update(category.id, {name: trimmed, icon, colorHex, kind});
    } else {
      await categoriesRepo.create({
        name: trimmed,
        icon,
        colorHex,
        kind,
        displayOrder: nextOrder,
        // Only the seed marks rows as default; a user-made category is not one
        // and should not be treated as un-restorable.
        isDefault: false,
      });
    }
    return true;
  }

  return (
    <FormDialog
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={category ? 'Edit category' : 'New category'}
      submitLabel={category ? 'Save changes' : 'Add category'}
      isSubmitDisabled={trimmed.length === 0}
      onSubmit={submit}
    >
      <TextInput
        label="Name"
        value={name}
        onChange={setName}
        isRequired
        hasAutoFocus
        width="100%"
      />
      <Selector
        label="Used for"
        value={kind}
        onChange={(next) => {
          if (next !== null) setKind(next as CategoryKind);
        }}
        options={KIND_OPTIONS}
        description="Controls which categories appear when entering income or an expense."
        width="100%"
      />
      <ColorPicker label="Colour" value={colorHex} onChange={setColorHex} />
      <IconPicker label="Icon" value={icon} onChange={setIcon} color={colorHex} />
    </FormDialog>
  );
}

/**
 * Merge confirmation.
 *
 * The one action on this screen that a toast-with-Undo cannot cover: restoring
 * the source category afterwards brings back the row but not the
 * reassignment. So the consequence is spelled out before it happens rather
 * than reported after — which is also why this asks for a destination in a
 * dialog instead of offering "merge" straight off the row's menu.
 */
function MergeDialog({
  source,
  candidates,
  onClose,
}: {
  source: Category;
  candidates: Category[];
  onClose: () => void;
}) {
  const [targetId, setTargetId] = useState<string>(candidates[0]?.id ?? '');
  const [isRunning, setIsRunning] = useState(false);
  const target = candidates.find((candidate) => candidate.id === targetId);

  async function run() {
    if (!target) return;
    setIsRunning(true);
    try {
      await mergeCategories(source.id, target.id);
      onClose();
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <FormDialog
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Merge ${source.name}`}
      subtitle="Everything filed under this category moves to the one you pick, and this category is retired."
      submitLabel="Merge"
      isSubmitDisabled={target === undefined || isRunning}
      onSubmit={run}
    >
      <Selector
        label="Move everything into"
        value={targetId}
        onChange={(next) => {
          if (next !== null) setTargetId(next);
        }}
        options={candidates.map((candidate) => ({
          value: candidate.id,
          label: candidate.name,
        }))}
        isRequired
        width="100%"
      />
      <Text type="supporting" as="p">
        Transactions, planned entries and budgets all move. This one cannot be
        undone from Trash — restoring {source.name} afterwards brings the
        category back, but not what was moved out of it.
      </Text>
    </FormDialog>
  );
}
