/**
 * Astryx components that Motion can animate.
 *
 * Resolves the tension flagged in PROGRESS.md §7. The Phase 0 gate screen
 * animated a `motion.div` wrapped *around* a `Card`, which violates the
 * project's no-raw-`<div>` rule and adds a layout box the design system knows
 * nothing about — the wrapper carries the transform while the Card carries the
 * padding, so anything reading the Card's box (sticky offsets, scroll
 * anchoring, `gap`) sees the wrong element.
 *
 * `create()` animates the Astryx component itself instead. It works because
 * every Astryx component extends `BaseProps`, which forwards `className`,
 * `style`, and `ref` to the root element — exactly what Motion needs to drive.
 *
 * **Import `create` from `motion/react-m`, never `motion` from `motion/react`.**
 * The `motion` proxy is eagerly wired to every feature Motion has, including
 * layout projection and drag gestures — about 110kb of code this app has no
 * use for, and which lands in the initial chunk because the frame animates
 * route changes. `motion/react-m` is the same proxy with no features attached;
 * `<LazyMotion features={domAnimation}>` in providers.tsx supplies the ones we
 * actually use. That provider runs in `strict` mode, so reaching for `motion`
 * out of habit throws instead of silently re-inflating the bundle.
 *
 * Phase 8's shared-element transitions will need layout projection. Widen the
 * feature set there (`domMax`, or an async `features={() => import(...)}`) —
 * do not go back to the full proxy.
 *
 * Create these once at module scope, never inside a render: `create()` returns
 * a new component type each call, so a per-render call would remount the
 * subtree on every render and restart the animation.
 */
import {Card} from '@astryxdesign/core/Card';
import {Stack} from '@astryxdesign/core/Stack';
import {create} from 'motion/react-m';

export const MotionStack = create(Stack);
export const MotionCard = create(Card);
