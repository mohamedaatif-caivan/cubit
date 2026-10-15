import { registerSW } from 'virtual:pwa-register';

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
        this.changed();
      },
      onRegisteredSW: (_url, registration) => {
        this.registration = registration;
        // Look for a new version every few hours while the app stays open.
        if (registration) setInterval(() => void registration.update(), 4 * 60 * 60 * 1000);
      },
    });
  }

  async checkForUpdate(): Promise<void> {
    try {
      await this.registration?.update();
    } catch {
      // Offline: try again later.
    }
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
