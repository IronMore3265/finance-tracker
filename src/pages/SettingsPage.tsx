import {Heading} from '@astryxdesign/core/Heading';
import {Section} from '@astryxdesign/core/Section';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {Stack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {ShieldCheck} from 'lucide-react';
import {useThemeMode, type ThemeMode} from '../app/theme-mode';
import {Page} from '../components/Page';
import {PhasePlaceholder} from '../components/PhasePlaceholder';

export function SettingsPage() {
  const {mode, setMode} = useThemeMode();

  return (
    <Page
      title="Settings"
      description="Appearance, privacy, and getting your data in and out."
    >
      <Section>
        <Stack gap={3}>
          <Stack gap={1}>
            <Heading level={2}>Appearance</Heading>
            <Text type="supporting" as="p">
              System follows your device's light or dark setting.
            </Text>
          </Stack>
          {/* A horizontal Stack so the control sizes to its three options.
              Left in the vertical Stack it stretches to the full section
              width, which reads as a toolbar rather than a choice. */}
          <Stack direction="horizontal" hAlign="start">
            <SegmentedControl
              label="Colour mode"
              value={mode}
              onChange={(next) => setMode(next as ThemeMode)}
            >
              <SegmentedControlItem value="system" label="System" />
              <SegmentedControlItem value="light" label="Light" />
              <SegmentedControlItem value="dark" label="Dark" />
            </SegmentedControl>
          </Stack>
        </Stack>
      </Section>

      <PhasePlaceholder
        icon={ShieldCheck}
        phase="Phase 3"
        description="Export and back up your data, and hide balances on screen. Optional Supabase sync arrives in Phase 5, and the importer for the old Android app's .xls export in Phase 6 — until then, everything stays on this device."
      />
    </Page>
  );
}
