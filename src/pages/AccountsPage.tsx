/**
 * Accounts, with balances derived from the ledger.
 *
 * The balance shown on each row is computed from `openingBalance` plus every
 * transaction touching the account — never read from a stored column. That is
 * the first of the three schema corrections in PROGRESS.md §4: the old app
 * mutated a denormalized `balance` on every write, so one failed or partial
 * write desynced it from the ledger permanently, with nothing to notice it.
 *
 * The practical consequence for this screen is that editing an account cannot
 * corrupt its balance, and deleting one does not need a compensating
 * adjustment — restoring it from Trash brings the balance back exactly.
 */
import {useState} from 'react';
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
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {ArrowDown, ArrowUp, Plus, Wallet} from 'lucide-react';
import {useNavigate} from 'react-router';
import {applyDisplayOrder} from '../db/commands';
import {useAccountBalances, useAccounts, useTransactions} from '../db/queries';
import {accountsRepo} from '../db/repositories';
import type {Account, AccountIcon} from '../db/types';
import {computeTotalBalance} from '../domain/balances';
import {evaluateAmount, roundToMinorUnit} from '../domain/mathEval';
import {COMMON_CURRENCIES, DEFAULT_CURRENCY, dominantCurrency} from '../format/money';
import {AmountInput} from '../components/AmountInput';
import {ACCOUNT_ICON_NAMES, EntityIcon} from '../components/EntityIcon';
import {FormDialog} from '../components/FormDialog';
import {MoneyText} from '../components/MoneyText';
import {Page} from '../components/Page';
import {ColorPicker, IconPicker} from '../components/Pickers';
import {useUndoableDelete} from '../components/useUndoableDelete';

export function AccountsPage() {
  const accounts = useAccounts();
  const transactions = useTransactions();
  const balances = useAccountBalances(accounts, transactions);
  const deleteWithUndo = useUndoableDelete();
  const navigate = useNavigate();

  const [editing, setEditing] = useState<Account | 'new' | null>(null);

  const total =
    accounts && transactions ? computeTotalBalance(accounts, transactions) : 0;

  async function move(index: number, delta: number) {
    if (!accounts) return;
    const target = index + delta;
    if (target < 0 || target >= accounts.length) return;

    const ordered = accounts.map((account) => account.id);
    const [moved] = ordered.splice(index, 1);
    if (moved === undefined) return;
    ordered.splice(target, 0, moved);

    await applyDisplayOrder('accounts', ordered);
  }

  return (
    <Page
      title="Accounts"
      description="Where your money sits. Balances are calculated from the ledger, not stored."
      actions={
        <Button
          label="New account"
          variant="primary"
          icon={<Icon icon={Plus} />}
          onClick={() => setEditing('new')}
        />
      }
    >
      {accounts === undefined ? null : accounts.length === 0 ? (
        <Section variant="muted" padding={8}>
          <EmptyState
            headingLevel={2}
            icon={<Icon icon={Wallet} size="lg" />}
            title="No accounts yet"
            description="Add the wallets, bank accounts and cards you actually use. Every transaction is recorded against one."
            actions={
              <Button
                label="New account"
                variant="primary"
                onClick={() => setEditing('new')}
              />
            }
          />
        </Section>
      ) : (
        <>
          <Section>
            <Stack gap={1}>
              <Text type="supporting" as="p">
                Total across accounts counted in your balance
              </Text>
              <MoneyText
                amount={total}
                currency={dominantCurrency(accounts)}
                type="display-3"
                weight="semibold"
              />
            </Stack>
          </Section>

          <Section padding={0}>
            <List hasDividers>
              {accounts.map((account, index) => (
                <Item
                  key={account.id}
                  as="li"
                  label={account.name}
                  startContent={
                    <EntityIcon name={account.icon} color={account.colorHex} />
                  }
                  description={
                    account.includeInBalance
                      ? account.currency
                      : `${account.currency} · excluded from total`
                  }
                  endContent={
                    <Stack direction="horizontal" gap={2} vAlign="center">
                      <MoneyText
                        amount={balances.get(account.id) ?? 0}
                        currency={account.currency}
                        weight="medium"
                      />
                      <IconButton
                        label={`Move ${account.name} up`}
                        icon={<Icon icon={ArrowUp} />}
                        variant="ghost"
                        size="sm"
                        isDisabled={index === 0}
                        clickAction={() => move(index, -1)}
                      />
                      <IconButton
                        label={`Move ${account.name} down`}
                        icon={<Icon icon={ArrowDown} />}
                        variant="ghost"
                        size="sm"
                        isDisabled={index === accounts.length - 1}
                        clickAction={() => move(index, 1)}
                      />
                      <MoreMenu
                        label={`Actions for ${account.name}`}
                        alignment="end"
                        items={[
                          {label: 'Edit', onClick: () => setEditing(account)},
                          {
                            label: 'Open ledger',
                            onClick: () => void navigate(`/ledger/${account.id}`),
                          },
                          {type: 'divider'},
                          {
                            label: 'Delete',
                            variant: 'destructive',
                            onClick: () =>
                              void deleteWithUndo(accountsRepo, account.id, {
                                label: account.name,
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
        </>
      )}

      {editing !== null ? (
        <AccountDialog
          account={editing === 'new' ? null : editing}
          nextOrder={accounts?.length ?? 0}
          defaultCurrency={accounts ? dominantCurrency(accounts) : DEFAULT_CURRENCY}
          transactionCount={
            editing === 'new'
              ? 0
              : (transactions ?? []).filter(
                  (txn) =>
                    txn.accountId === editing.id || txn.toAccountId === editing.id,
                ).length
          }
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Page>
  );
}

function AccountDialog({
  account,
  nextOrder,
  defaultCurrency,
  transactionCount,
  onClose,
}: {
  account: Account | null;
  nextOrder: number;
  defaultCurrency: string;
  transactionCount: number;
  onClose: () => void;
}) {
  const [name, setName] = useState(account?.name ?? '');
  const [opening, setOpening] = useState(
    account ? String(account.openingBalance) : '',
  );
  const [currency, setCurrency] = useState(account?.currency ?? defaultCurrency);
  const [icon, setIcon] = useState<AccountIcon>(account?.icon ?? 'wallet');
  const [colorHex, setColorHex] = useState(account?.colorHex ?? '#2196F3');
  const [includeInBalance, setIncludeInBalance] = useState(
    account?.includeInBalance ?? true,
  );

  const trimmed = name.trim();

  async function submit() {
    if (trimmed.length === 0) return false;

    const parsed = parseOpeningBalance(opening);
    if (parsed === null) return false;

    if (account) {
      await accountsRepo.update(account.id, {
        name: trimmed,
        openingBalance: parsed,
        currency,
        icon,
        colorHex,
        includeInBalance,
      });
    } else {
      await accountsRepo.create({
        name: trimmed,
        openingBalance: parsed,
        currency,
        icon,
        colorHex,
        includeInBalance,
        displayOrder: nextOrder,
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
      title={account ? 'Edit account' : 'New account'}
      submitLabel={account ? 'Save changes' : 'Add account'}
      isSubmitDisabled={trimmed.length === 0 || parseOpeningBalance(opening) === null}
      onSubmit={submit}
    >
      <TextInput
        label="Name"
        value={name}
        onChange={setName}
        isRequired
        hasAutoFocus
        placeholder="Cash, Brac Bank, …"
        width="100%"
      />

      <AmountInput
        label="Opening balance"
        value={opening}
        onChange={setOpening}
        currency={currency}
        placeholder="0"
      />
      <Text type="supporting" as="p">
        {transactionCount > 0
          ? `What the account held before its first recorded transaction. Changing it shifts the current balance by the same amount across all ${transactionCount} transactions.`
          : 'What the account held before its first recorded transaction. Leave at zero to start from nothing.'}
      </Text>

      <Selector
        label="Currency"
        value={currency}
        onChange={(next) => {
          if (next !== null) setCurrency(next);
        }}
        options={COMMON_CURRENCIES.map((code) => ({value: code, label: code}))}
        hasSearch
        width="100%"
      />

      <ColorPicker label="Colour" value={colorHex} onChange={setColorHex} />
      <IconPicker
        label="Icon"
        value={icon}
        onChange={(next) => setIcon(next as AccountIcon)}
        color={colorHex}
        names={ACCOUNT_ICON_NAMES}
      />

      <Switch
        label="Count towards total balance"
        description="Turn off for a long-term savings account you do not want inflating day-to-day headroom."
        value={includeInBalance}
        onChange={setIncludeInBalance}
        labelPosition="start"
        labelSpacing="spread"
        width="100%"
      />
    </FormDialog>
  );
}

/**
 * Opening balances are the one amount allowed to be zero or negative — an
 * account can be overdrawn, or started from nothing. `parseAmount` rejects
 * both, deliberately: direction is carried by a transaction's `type`, so a
 * negative expense would double-count once balances are derived. That rule is
 * right for transactions and wrong here, so this parses the expression
 * directly and only rounds.
 */
function parseOpeningBalance(raw: string): number | null {
  if (raw.trim().length === 0) return 0;

  const value = evaluateAmount(raw);
  if (value === null) return null;
  return roundToMinorUnit(value);
}
