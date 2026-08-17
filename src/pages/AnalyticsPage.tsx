import {ChartColumn} from 'lucide-react';
import {Page} from '../components/Page';
import {PhasePlaceholder} from '../components/PhasePlaceholder';

export function AnalyticsPage() {
  return (
    <Page
      title="Analytics"
      description="Where the money went, over whatever span you ask for."
    >
      <PhasePlaceholder
        icon={ChartColumn}
        phase="Phase 4"
        description="A shared visx ChartFrame, then spending by category, month over month, cash flow, and net worth over time — replacing the old app's single 7-day line chart."
      />
    </Page>
  );
}
