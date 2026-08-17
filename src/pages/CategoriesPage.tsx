import {Tags} from 'lucide-react';
import {Page} from '../components/Page';
import {PhasePlaceholder} from '../components/PhasePlaceholder';

export function CategoriesPage() {
  return (
    <Page
      title="Categories"
      description="Rename, recolour, reorder, and merge."
    >
      <PhasePlaceholder
        icon={Tags}
        phase="Phase 3"
        description="Categories are a real table here rather than a string on each transaction, which is what makes renaming, merging, and per-category budgets possible. Merging reassigns every affected transaction, then soft-deletes the emptied category."
      />
    </Page>
  );
}
