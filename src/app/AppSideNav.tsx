/**
 * The primary navigation.
 *
 * Rendered once and handed to `AppShell`'s `sideNav` slot. Below the `md`
 * breakpoint AppShell moves this exact node into the mobile drawer and renders
 * its heading in a compact top bar, so there is deliberately no second mobile
 * copy to keep in sync.
 */
import {Icon} from '@astryxdesign/core/Icon';
import {NavIcon} from '@astryxdesign/core/NavIcon';
import {
  SideNav,
  SideNavHeading,
  SideNavItem,
  SideNavSection,
} from '@astryxdesign/core/SideNav';
import {PiggyBank} from 'lucide-react';
import {useLocation} from 'react-router';
import {isDestinationActive, NAV_SECTIONS} from './nav';

export function AppSideNav() {
  const {pathname} = useLocation();

  return (
    <SideNav
      aria-label="Primary"
      header={
        <SideNavHeading
          heading="Finance Tracker"
          headingHref="/"
          icon={<NavIcon icon={<Icon icon={PiggyBank} />} />}
        />
      }
    >
      {NAV_SECTIONS.map((section) => (
        <SideNavSection key={section.title} title={section.title}>
          {section.items.map((destination) => (
            <SideNavItem
              key={destination.path}
              label={destination.label}
              href={destination.path}
              icon={destination.icon}
              // Sets aria-current="page", so the current destination is
              // announced rather than signalled by colour alone.
              isSelected={isDestinationActive(pathname, destination.path)}
            />
          ))}
        </SideNavSection>
      ))}
    </SideNav>
  );
}
