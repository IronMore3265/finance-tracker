/**
 * Phase 0 gate screen.
 *
 * Exists to prove the foundation works before any feature is built:
 * Astryx components render themed, Figtree loads, light/dark switches, and
 * Motion animates with the theme's own tokens. Phase 2 replaces this with
 * the real AppShell.
 */
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Heading} from '@astryxdesign/core/Heading';
import {Stack} from '@astryxdesign/core/Stack';
import {HStack} from '@astryxdesign/core/HStack';
import {Text} from '@astryxdesign/core/Text';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {motion} from 'motion/react';
import {motionTokens, popVariants} from './motion';
import {useThemeMode, type ThemeMode} from './theme-mode';

export function App() {
  const {mode, setMode, resolved} = useThemeMode();

  return (
    <Stack padding={6} gap={5} align="start">
      <Stack gap={2} align="start">
        <Heading level={1}>Finance Tracker</Heading>
        <Text>Phase 0 — foundation check.</Text>
      </Stack>

      <SegmentedControl
        label="Colour mode"
        value={mode}
        onChange={(next) => setMode(next as ThemeMode)}
      >
        <SegmentedControlItem value="system" label="System" />
        <SegmentedControlItem value="light" label="Light" />
        <SegmentedControlItem value="dark" label="Dark" />
      </SegmentedControl>

      <motion.div
        initial="initial"
        animate="animate"
        variants={popVariants}
        style={{width: '100%', maxWidth: 520}}
      >
        <Card elevation="low">
          <Stack gap={4} align="start">
            <Heading level={2}>Foundation</Heading>

            <Stack gap={1} align="start">
              <Text>
                Resolved colour mode: <strong>{resolved}</strong>
              </Text>
              <Text>
                Motion tokens read from theme: fast {motionTokens.fast}ms, medium{' '}
                {motionTokens.medium}ms, slow {motionTokens.slow}ms
              </Text>
              <Text>
                Easing: cubic-bezier({motionTokens.ease.join(', ')})
              </Text>
            </Stack>

            {/* If this line renders in a serif face, the Figtree webfont
                failed to load and the theme fell through to its fallbacks. */}
            <Text>
              Typeface check — this should be Figtree, not a serif fallback.
            </Text>

            <HStack gap={2}>
              <Button label="Primary" variant="primary" />
              <Button label="Secondary" variant="secondary" />
              <Button label="Ghost" variant="ghost" />
            </HStack>
          </Stack>
        </Card>
      </motion.div>
    </Stack>
  );
}
