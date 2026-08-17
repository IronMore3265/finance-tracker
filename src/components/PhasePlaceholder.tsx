/**
 * Marks a route that the frame reaches but no phase has filled in yet.
 *
 * Phase 2 builds the frame before the pages on purpose (`npx astryx docs
 * layout`: "Decide the frame before writing any content"), which leaves real,
 * navigable, code-split routes with nothing behind them. Naming the phase that
 * owns each one keeps that state honest instead of looking like a bug.
 *
 * Every one of these is expected to be deleted, not extended.
 */
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Icon} from '@astryxdesign/core/Icon';
import {Section} from '@astryxdesign/core/Section';
import type {NavIconComponent} from '../app/nav';

export interface PhasePlaceholderProps {
  icon: NavIconComponent;
  /** The phase from PROGRESS.md that builds this screen, e.g. "Phase 3". */
  phase: string;
  /** What will be here — concrete, not "coming soon". */
  description: string;
}

export function PhasePlaceholder({icon, phase, description}: PhasePlaceholderProps) {
  return (
    <Section variant="muted" padding={8}>
      <EmptyState
        headingLevel={2}
        icon={<Icon icon={icon} size="lg" />}
        title={`${phase} builds this screen`}
        description={description}
      />
    </Section>
  );
}
