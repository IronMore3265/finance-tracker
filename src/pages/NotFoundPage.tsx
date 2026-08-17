import {Button} from '@astryxdesign/core/Button';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Icon} from '@astryxdesign/core/Icon';
import {Section} from '@astryxdesign/core/Section';
import {Compass} from 'lucide-react';
import {Page} from '../components/Page';

export function NotFoundPage() {
  return (
    <Page title="Page not found">
      <Section variant="muted" padding={8}>
        <EmptyState
          headingLevel={2}
          icon={<Icon icon={Compass} size="lg" />}
          title="There is nothing at this address"
          description="The link may be out of date, or the screen may not exist yet."
          actions={<Button label="Go to the dashboard" variant="primary" href="/" />}
        />
      </Section>
    </Page>
  );
}
