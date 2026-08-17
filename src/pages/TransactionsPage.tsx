import {ArrowLeftRight} from 'lucide-react';
import {Page} from '../components/Page';
import {PhasePlaceholder} from '../components/PhasePlaceholder';

export function TransactionsPage() {
  return (
    <Page
      title="Transactions"
      description="Every entry across all accounts, filterable and editable."
    >
      <PhasePlaceholder
        icon={ArrowLeftRight}
        phase="Phase 3"
        description="Search, filter, and bulk select. Full edit support from the first commit — the old app could only delete and re-enter. Deletes are soft, with undo."
      />
    </Page>
  );
}
