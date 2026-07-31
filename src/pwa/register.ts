import { useSyncExternalStore } from 'react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export const PWA_OFFLINE_READY_STORAGE_KEY = 'gm-pwa-offline-ready-v1';
export const PWA_OFFLINE_CACHE_VERSION = 'gm-offline-v1';

interface OfflineReadyRecord {
  version: 1;
  cacheVersion: typeof PWA_OFFLINE_CACHE_VERSION;
  ready: true;
  cachedAt: number;
}

function browserStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Query the durable flag for the currently shipped offline-cache version. */
export function readPwaOfflineReady(
  storage: Storage | undefined = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    const parsed = JSON.parse(storage.getItem(PWA_OFFLINE_READY_STORAGE_KEY) ?? 'null') as Partial<OfflineReadyRecord> | null;
    return parsed?.version === 1
      && parsed.cacheVersion === PWA_OFFLINE_CACHE_VERSION
      && parsed.ready === true
      && typeof parsed.cachedAt === 'number'
      && Number.isFinite(parsed.cachedAt);
  } catch {
    return false;
  }
}

function persistPwaOfflineReady(storage: Storage | undefined = browserStorage()): boolean {
  if (!storage) return false;
  const record: OfflineReadyRecord = {
    version: 1,
    cacheVersion: PWA_OFFLINE_CACHE_VERSION,
    ready: true,
    cachedAt: Date.now(),
  };
  try {
    storage.setItem(PWA_OFFLINE_READY_STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export interface PwaSnapshot {
  supported: boolean;
  online: boolean;
  registered: boolean;
  ready: boolean;
  installAvailable: boolean;
  installed: boolean;
  updateAvailable: boolean;
  caching: boolean;
  cached: boolean;
  error: string;
}

const initialSnapshot: PwaSnapshot = {
  supported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  registered: false,
  ready: false,
  installAvailable: false,
  installed: typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches,
  updateAvailable: false,
  caching: false,
  cached: readPwaOfflineReady(),
  error: '',
};

let snapshot = initialSnapshot;
let registration: ServiceWorkerRegistration | null = null;
let installPrompt: InstallPromptEvent | null = null;
let registerPromise: Promise<ServiceWorkerRegistration | null> | null = null;
let listenersBound = false;
const listeners = new Set<() => void>();

function publish(patch: Partial<PwaSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}

export function getPwaSnapshot(): PwaSnapshot {
  return snapshot;
}

export function subscribePwa(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePwaStatus(): PwaSnapshot {
  return useSyncExternalStore(subscribePwa, getPwaSnapshot, () => initialSnapshot);
}

function bindBrowserListeners(): void {
  if (listenersBound || typeof window === 'undefined') return;
  listenersBound = true;
  window.addEventListener('online', () => publish({ online: true }));
  window.addEventListener('offline', () => publish({ online: false }));
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    publish({ installAvailable: true });
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    publish({ installed: true, installAvailable: false });
  });
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    publish({ ready: true, updateAvailable: false });
  });
}

function trackRegistration(next: ServiceWorkerRegistration): void {
  registration = next;
  publish({
    registered: true,
    ready: !!navigator.serviceWorker.controller || !!next.active,
    updateAvailable: !!next.waiting,
  });
  next.addEventListener('updatefound', () => {
    const worker = next.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') {
        publish({
          ready: true,
          updateAvailable: !!navigator.serviceWorker.controller && !!next.waiting,
        });
      }
    });
  });
}

export function registerPwa(): Promise<ServiceWorkerRegistration | null> {
  bindBrowserListeners();
  if (registerPromise) return registerPromise;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    publish({ supported: false });
    return Promise.resolve(null);
  }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    publish({ error: 'Offline installation needs a secure connection.' });
    return Promise.resolve(null);
  }
  const url = new URL('sw.js', document.baseURI);
  const scope = new URL('./', document.baseURI).pathname;
  registerPromise = navigator.serviceWorker.register(url, { scope })
    .then((next) => {
      trackRegistration(next);
      return next;
    })
    .catch(() => {
      publish({ error: 'Offline support could not start on this device.' });
      return null;
    });
  return registerPromise;
}

export async function promptPwaInstall(): Promise<boolean> {
  if (!installPrompt) return false;
  try {
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    const accepted = choice.outcome === 'accepted';
    if (accepted) installPrompt = null;
    publish({ installAvailable: !accepted && !!installPrompt, installed: accepted || snapshot.installed });
    return accepted;
  } catch {
    return false;
  }
}

export function activatePwaUpdate(): boolean {
  const waiting = registration?.waiting;
  if (!waiting) return false;
  waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

export async function downloadForOffline(): Promise<boolean> {
  publish({ caching: true, error: '' });
  try {
    const ready = registration ?? await registerPwa() ?? await navigator.serviceWorker.ready;
    const worker = ready.active ?? navigator.serviceWorker.controller;
    if (!worker) throw new Error('No active service worker');
    const result = await new Promise<boolean>((resolve) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(() => resolve(false), 45_000);
      channel.port1.onmessage = (event) => {
        if (event.data?.type !== 'CACHE_APP_DONE') return;
        window.clearTimeout(timeout);
        resolve(event.data.ok === true);
      };
      worker.postMessage({ type: 'CACHE_APP' }, [channel.port2]);
    });
    if (result) persistPwaOfflineReady();
    const cached = result || readPwaOfflineReady();
    publish({
      caching: false,
      cached,
      error: result
        ? ''
        : cached
          ? 'The existing offline library is still ready, but its refresh did not finish.'
          : 'The full library could not be downloaded. Visited games remain available.',
    });
    return result;
  } catch {
    publish({ caching: false, error: 'Offline download is unavailable in this browser.' });
    return false;
  }
}
