/**
 * Teaches every Astryx component to navigate through React Router.
 *
 * Astryx components that render links (SideNavItem, Button, Breadcrumbs, …)
 * call `useLinkComponent()`, which resolves to a plain `<a>` unless a
 * `LinkProvider` supplies something better. A plain `<a>` triggers a full
 * document load, which throws away the Dexie connection and the React tree —
 * so one provider at the frame root is what keeps in-app navigation client
 * side everywhere, without threading `as={Link}` through every call site.
 *
 * The adapter exists because the two APIs disagree on one prop name: Astryx
 * passes `href`, React Router's `Link` wants `to`.
 */
import type {LinkProps} from 'react-router';
import {Link} from 'react-router';

export type RouterLinkProps = Omit<LinkProps, 'to'> & {href?: string};

/** `http://…`, `mailto:…`, `//cdn…` — anything the router cannot resolve. */
const EXTERNAL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

export function RouterLink({href, ...rest}: RouterLinkProps) {
  // Router-external targets (and links with no href, which Astryx renders as
  // inert anchors) must stay native — handing them to `Link` would push a
  // history entry for a URL no route matches.
  if (href === undefined || EXTERNAL.test(href)) {
    return <a href={href} {...rest} />;
  }
  return <Link to={href} {...rest} />;
}

RouterLink.displayName = 'RouterLink';
