import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './styles/global.css';
import {Providers} from './app/providers';
import {App} from './app/App';
import {installNativePlatform} from './platform/native';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found in index.html');
}

// An arrow const rather than a hoisted `function`: TypeScript keeps the
// narrowing from the null check above only for a closure created after it.
const render = () => {
  createRoot(container).render(
    <StrictMode>
      <Providers>
        <App />
      </Providers>
    </StrictMode>,
  );
};

/**
 * Install the platform's own behaviour before the first paint, then render.
 *
 * On the web this resolves without importing anything, so it costs a
 * microtask. On Android and the desktop it loads one local chunk, which is
 * worth waiting for on both counts: an export screen reachable before the
 * native saver landed would fall back to a browser download — which inside a
 * Capacitor WebView produces no file at all — and a back button pressed before
 * its listener existed would quit the app.
 *
 * `finally`, not `then`: a shell whose file plugin fails to load still gets
 * the whole app. Nothing here is allowed to keep it off the screen.
 */
void installNativePlatform()
  .then((result) => {
    if (result.host !== 'web' && !result.installed) {
      console.warn(`Native platform module for ${result.host} did not load`, result.error);
    }
  })
  .finally(render);
