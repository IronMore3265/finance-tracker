import {Trash2} from 'lucide-react';
import {Page} from '../components/Page';
import {PhasePlaceholder} from '../components/PhasePlaceholder';

export function TrashPage() {
  return (
    <Page
      title="Trash"
      description="Deleted items, and the way back from an accidental delete."
    >
      <PhasePlaceholder
        icon={Trash2}
        phase="Phase 3"
        description="Deletes are soft everywhere in this app, so nothing is actually gone until it is purged from here. Restore is already implemented in the data layer."
      />
    </Page>
  );
}
