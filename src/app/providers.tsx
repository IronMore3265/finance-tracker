import type {ReactNode} from 'react';
import {Theme} from '@astryxdesign/core';
// The /built subpath skips runtime style injection and relies on the
// pre-compiled theme.css imported in styles/global.css.
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
import {MotionConfig} from 'motion/react';
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
      <ThemeModeProvider>
        <ThemedApp>{children}</ThemedApp>
      </ThemeModeProvider>
    </MotionConfig>
  );
}
