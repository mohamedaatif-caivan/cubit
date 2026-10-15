import { render } from 'preact';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-semi-condensed/500.css';
import '@fontsource/barlow-semi-condensed/600.css';
import './ui/styles.css';
import { App } from './ui/App';
import { pwa } from './ui/pwa';
import { logError } from './ui/store';

window.addEventListener('error', (e) => logError(`${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => logError(`Unhandled: ${String(e.reason)}`));

pwa.start();
render(<App />, document.getElementById('app')!);
