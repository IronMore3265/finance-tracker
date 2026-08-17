import {ScrollText} from 'lucide-react';
import {Page} from '../components/Page';
import {PhasePlaceholder} from '../components/PhasePlaceholder';

export function LedgerPage() {
  return (
    <Page
      title="Ledger"
      description="One account's register, with a running balance."
    >
      <PhasePlaceholder
        icon={ScrollText}
        phase="Phase 3"
        description="A per-account register showing how the opening balance becomes the current one, entry by entry. Balances are derived from this ledger rather than stored, so this view is also how a suspect balance gets checked."
      />
    </Page>
  );
}
