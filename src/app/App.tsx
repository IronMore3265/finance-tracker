/**
 * The application root: nothing but the router.
 *
 * `createBrowserRouter` is called at module scope, not inside the component —
 * a router created during render is a new router on every render, which resets
 * navigation state and re-runs loaders.
 *
 * Browser history (not hash) is the right default for the web build and for
 * Tauri. The Capacitor Android build in Phase 7 serves from a `capacitor://`
 * origin and may need `createHashRouter` instead; that is the one line to
 * change if deep links misbehave there.
 */
import {RouterProvider, createBrowserRouter} from 'react-router';
import {routes} from './routes';

const router = createBrowserRouter(routes);

export function App() {
  return <RouterProvider router={router} />;
}
