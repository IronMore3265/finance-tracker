import {Wallet} from 'lucide-react';
import {Page} from '../components/Page';
import {PhasePlaceholder} from '../components/PhasePlaceholder';

export function AccountsPage() {
  return (
    <Page
      title="Accounts"
      description="Cash, bank, and anything else you track a balance for."
    >
      <PhasePlaceholder
        icon={Wallet}
        phase="Phase 3"
        description="Add, edit, reorder, and archive accounts. Each shows a balance computed from the ledger, not a stored number that can drift out of sync with it."
      />
    </Page>
  );
}
