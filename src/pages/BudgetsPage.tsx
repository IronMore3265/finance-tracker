import {Target} from 'lucide-react';
import {Page} from '../components/Page';
import {PhasePlaceholder} from '../components/PhasePlaceholder';

export function BudgetsPage() {
  return (
    <Page
      title="Budgets"
      description="Per-category limits, on periods anchored to when you get paid."
    >
      <PhasePlaceholder
        icon={Target}
        phase="Phase 4"
        description="The old app had a single global budget period. Progress calculation is already written and tested; this screen sets the limits and renders the result."
      />
    </Page>
  );
}
