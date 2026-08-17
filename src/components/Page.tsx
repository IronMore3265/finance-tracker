/**
 * The standard page frame: heading, optional blurb, optional actions, content.
 *
 * AppShell renders no heading of its own, so the `<h1>` here is the page's
 * document outline. AppShell also runs with `contentPadding={0}`, which makes
 * this the component that owns page padding — a page that needs to be
 * full-bleed (an edge-to-edge ledger table) can drop `Page` without having to
 * cancel padding inherited from the shell.
 *
 * A wrapper rather than direct Astryx use at every call site, per the
 * pre-1.0-churn strategy in PROGRESS.md §7: when Astryx changes its layout
 * API, this file changes, not eleven pages.
 */
import type {ReactNode} from 'react';
import {Heading} from '@astryxdesign/core/Heading';
import {Stack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';

export interface PageProps {
  title: string;
  /** One line on what this screen is for. Shown under the heading. */
  description?: string;
  /** Page-level actions, end-aligned beside the heading. */
  actions?: ReactNode;
  children?: ReactNode;
}

/** Reading-comfort cap. Wide tables should escape it with their own scroller. */
const CONTENT_MAX_WIDTH = 1200;

export function Page({title, description, actions, children}: PageProps) {
  return (
    <Stack gap={5} padding={5} width="100%" maxWidth={CONTENT_MAX_WIDTH}>
      <Stack
        direction="horizontal"
        hAlign="between"
        vAlign="start"
        gap={4}
        wrap="wrap"
      >
        <Stack gap={1}>
          <Heading level={1}>{title}</Heading>
          {description ? (
            <Text type="supporting" as="p">
              {description}
            </Text>
          ) : null}
        </Stack>
        {actions}
      </Stack>
      {children}
    </Stack>
  );
}
