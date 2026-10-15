import { render } from 'preact';
// Latin only: it has every mark Cubit shows (′ ″ × ÷ ² ³ −); the other subsets would only slow the first load.
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-semi-condensed/latin-500.css';
import '@fontsource/barlow-semi-condensed/latin-600.css';
import './ui/styles.css';
import { App } from './ui/App';
import { pwa } from './ui/pwa';
import { logError, store } from './ui/store';

window.addEventListener('error', (e) => logError(`${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => logError(`Unhandled: ${String(e.reason)}`));

pwa.start();
render(<App />, document.getElementById('app')!);

// Development only (stripped from builds): ?tape=a|b commits calculations, ?input=… types one, and
// ?theme=dark|light, ?layout=compact, ?settings=1 set the look, so screenshots can be taken without a keyboard.
if (import.meta.env.DEV) setTimeout(() => {
  const q = new URLSearchParams(location.search);
  const theme = q.get('theme');
  if (theme === 'dark' || theme === 'light') store.settings.theme = theme === 'dark' ? 'Dark' : 'Light';
  if (q.get('layout') === 'compact') store.settings.layout = 'Compact';
  for (const line of (q.get('tape') ?? '').split('|').filter(Boolean)) {
    store.setInput(line);
    store.commit();
  }
  if (q.get('input')) store.setInput(q.get('input')!);
  store.settingsChanged();
  if (q.get('settings')) store.openSettings(true);
}, 50);
