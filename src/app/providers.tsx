import type {ReactNode} from 'react';
import {Theme} from '@astryxdesign/core/theme';
// The /built subpath skips runtime style injection and relies on the
// pre-compiled theme.css imported in styles/global.css.
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
import {LazyMotion, MotionConfig, domAnimation} from 'motion/react';
import {ThemeModeProvider, useThemeMode} from './theme-mode';

function ThemedApp({children}: {children: ReactNode}) {
  const {mode} = useThemeMode();
  return (
    <Theme theme={neutralTheme} mode={mode}>
      {children}
    </Theme>
  );
}

export function Providers({children}: {children: ReactNode}) {
  return (
    // reducedMotion="user" honours the OS accessibility setting globally, so
    // individual components never need to check it themselves.
    <MotionConfig reducedMotion="user">
      {/*
       * Supplies the animation features that components from
       * `motion/react-m` need. `domAnimation` covers animations, variants and
       * AnimatePresence exits — everything this app uses — while leaving out
       * layout projection and drag, which the full `motion` proxy would pull
       * into the initial chunk whether or not anything used them.
       *
       * `strict` turns an accidental `motion.div` into an error rather than a
       * silent re-inflation of the bundle. See components/animated.ts.
       */}
      <LazyMotion features={domAnimation} strict>
        <ThemeModeProvider>
          <ThemedApp>{children}</ThemedApp>
        </ThemeModeProvider>
      </LazyMotion>
    </MotionConfig>
  );
}
