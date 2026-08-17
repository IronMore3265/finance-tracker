import {CalendarSync} from 'lucide-react';
import {Page} from '../components/Page';
import {PhasePlaceholder} from '../components/PhasePlaceholder';

export function PlannedPage() {
  return (
    <Page
      title="Planned"
      description="Recurring and scheduled transactions, and what is due next."
    >
      <PhasePlaceholder
        icon={CalendarSync}
        phase="Phase 3"
        description="Per-occurrence editing: change or skip a single occurrence without disturbing the series, or split the series and change everything from a date forward. The recurrence engine behind this is already written and tested — only the UI is outstanding."
      />
    </Page>
  );
}
