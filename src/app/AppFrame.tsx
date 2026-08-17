/**
 * The application frame.
 *
 * Rendered by the root route, so it mounts once and survives every navigation:
 * the nav, the Dexie connection and the theme all stay put while only the
 * outlet swaps. Read `npx astryx docs layout` before changing anything here.
 *
 * Responsive contract (AppShell owns the mechanics, this is the intent):
 *   > md   side nav inline, main content scrolls independently of the nav
 *   <= md  nav collapses into a modal drawer; AppShell renders a compact top
 *          bar carrying the heading and the drawer toggle
 *
 * `contentPadding={0}` is deliberate: the dominant content here is dense
 * (tables, ledgers, dashboards), and each page owns its own padding through
 * `Page` so a future full-bleed table can opt out without fighting the shell.
 */
import {useEffect, useState} from 'react';
import {AppShell} from '@astryxdesign/core/AppShell';
// Subpath, not the `@astryxdesign/core` barrel: the barrel re-exports all 156
// components and defeats tree-shaking, putting the entire library in the
// initial chunk.
import {LinkProvider} from '@astryxdesign/core/Link';
import {AnimatePresence} from 'motion/react';
import {useLocation, useOutlet} from 'react-router';
import {MotionStack} from '../components/animated';
import {pageVariants} from './motion';
import {AppSideNav} from './AppSideNav';
import {matchDestination} from './nav';
import {RouterLink} from './router-link';

const APP_NAME = 'Finance Tracker';

export function AppFrame() {
  const {pathname} = useLocation();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // AppShell's drawer is a modal dialog with no knowledge that a link inside it
  // navigated, so uncontrolled it would sit open on top of the page the user
  // just chose. Controlling it here is the only place that sees both.
  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    const destination = matchDestination(pathname);
    document.title = destination ? `${destination.label} · ${APP_NAME}` : APP_NAME;
  }, [pathname]);

  return (
    <LinkProvider component={RouterLink}>
      <AppShell
        height="fill"
        contentPadding={0}
        sideNav={<AppSideNav />}
        mobileNav={{isOpen: isMobileNavOpen, onOpenChange: setIsMobileNavOpen}}
      >
        <RouteTransition />
      </AppShell>
    </LinkProvider>
  );
}

/**
 * Cross-fades between routes.
 *
 * `useOutlet()` rather than `<Outlet />` because AnimatePresence needs to hold
 * on to the *outgoing* element while it exits; `<Outlet />` would re-render to
 * the incoming route and both copies would show the same page.
 *
 * Route-level `lazy()` means React Router has already resolved the next
 * chunk before `pathname` changes, so the exit animation never plays against
 * an empty screen.
 */
function RouteTransition() {
  const {pathname} = useLocation();
  const outlet = useOutlet();

  useEffect(() => {
    // AppShell's main region is its own scroll container in `fill` mode, so
    // neither the browser nor react-router's ScrollRestoration (which drives
    // the window) resets it. Targeted by role rather than by AppShell's
    // internal element id, which is not part of its public API.
    document.querySelector<HTMLElement>('[role="main"]')?.scrollTo({top: 0});
  }, [pathname]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <MotionStack
        key={pathname}
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        height="100%"
      >
        {outlet}
      </MotionStack>
    </AnimatePresence>
  );
}
