import { registerSW } from 'virtual:pwa-register';
import { logError, store } from './store';

const HourMs = 60 * 60 * 1000;

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Offline support, install and updates. A new version downloads in the background and is offered,
 * never forced: "Update ready · Restart now", as in the desktop app.
 */
class Pwa {
  readonly supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  updateReady = false;
  offlineReady = false;
  private installPrompt: InstallPrompt | null = null;
  private registration: ServiceWorkerRegistration | undefined;
  private update: ((reload?: boolean) => Promise<void>) | null = null;
  private listeners = new Set<() => void>();
  private lastCheck = Date.now();

  get canInstall(): boolean {
    return this.installPrompt !== null;
  }

  start(): void {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installPrompt = e as InstallPrompt;
      this.changed();
    });
    window.addEventListener('appinstalled', () => {
      this.installPrompt = null;
      this.changed();
    });
    if (!this.supported || import.meta.env.DEV) return;
    this.update = registerSW({
      onNeedRefresh: () => {
        this.updateReady = true;
        this.changed();
      },
      onOfflineReady: () => {
        this.offlineReady = true;
        store.toast('Ready to work offline');
        this.changed();
      },
      onRegisteredSW: (_url, registration) => {
        this.registration = registration;
        // Look for a new version every few hours while the app stays open, and when it comes back to the
        // screen (phones suspend apps rather than closing them, so a timer alone rarely fires).
        if (!registration) return;
        setInterval(() => void this.checkForUpdate(), 4 * HourMs);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && Date.now() - this.lastCheck > HourMs) void this.checkForUpdate();
        });
      },
      onRegisterError: (error: unknown) => logError(`Service worker: ${String(error)}`),
    });
  }

  /** True when a new version was found (it then downloads and shows "Update ready"). */
  async checkForUpdate(): Promise<boolean> {
    this.lastCheck = Date.now();
    try {
      await this.registration?.update();
    } catch {
      return false; // offline: try again later
    }
    return !!this.registration?.installing || !!this.registration?.waiting || this.updateReady;
  }

  applyUpdate(): void {
    void this.update?.(true);
  }

  async install(): Promise<void> {
    const prompt = this.installPrompt;
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    this.installPrompt = null;
    this.changed();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed(): void {
    for (const l of this.listeners) l();
  }
}

export const pwa = new Pwa();
