import {LayoutDashboard} from 'lucide-react';
import {Page} from '../components/Page';
import {PhasePlaceholder} from '../components/PhasePlaceholder';

export function DashboardPage() {
  return (
    <Page
      title="Dashboard"
      description="Balances, this period's spending, and what is due next."
    >
      <PhasePlaceholder
        icon={LayoutDashboard}
        phase="Phase 3"
        description="Derived account balances, budget progress, upcoming planned transactions, and the inline quick-add that replaces the old app's modal entry flow."
      />
    </Page>
  );
}
