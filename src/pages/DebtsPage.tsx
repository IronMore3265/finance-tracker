import {HandCoins} from 'lucide-react';
import {Page} from '../components/Page';
import {PhasePlaceholder} from '../components/PhasePlaceholder';

export function DebtsPage() {
  return (
    <Page
      title="Debts"
      description="Money you owe and money owed to you, with part payments."
    >
      <PhasePlaceholder
        icon={HandCoins}
        phase="Phase 3"
        description="Track a debt from open to settled, record partial payments against it, and edit any of it afterwards — the old app exposed no way to update a debt at all."
      />
    </Page>
  );
}
