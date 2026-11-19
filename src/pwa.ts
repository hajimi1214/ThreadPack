let registration: ServiceWorkerRegistration | null = null;
let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;
let updateRequested = false;

/** Register the application shell on production HTTP(S), never on file:// or Vite dev. */
export function startPwa(onUpdate: () => void): () => void {
  if (!import.meta.env.PROD || typeof window === 'undefined'
    || !/^https?:$/.test(window.location.protocol) || !window.isSecureContext
    || !('serviceWorker' in navigator)) return () => {};

  let disposed = false;
  const disposers: (() => void)[] = [];
  const onControllerChange = () => {
    // Do not reload other tabs or discard in-memory work unless this tab asked.
    if (updateRequested) { updateRequested = false; window.location.reload(); }
  };
  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
  disposers.push(() => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange));

  const script = new URL('./sw.js', window.location.href);
  script.search = ''; script.hash = '';
  registrationPromise ??= navigator.serviceWorker.register(script.href, { scope: './', updateViaCache: 'none' });
  registrationPromise.then(result => {
    if (disposed) return;
    registration = result;
    const notifyWaiting = () => {
      if (!disposed && result.waiting && navigator.serviceWorker.controller) onUpdate();
    };
    const watchInstalling = () => {
      const installing = result.installing;
      if (!installing) return;
      const onStateChange = () => {
        if (installing.state === 'installed') notifyWaiting();
      };
      installing.addEventListener('statechange', onStateChange);
      disposers.push(() => installing.removeEventListener('statechange', onStateChange));
    };
    result.addEventListener('updatefound', watchInstalling);
    disposers.push(() => result.removeEventListener('updatefound', watchInstalling));
    watchInstalling();
    notifyWaiting();
  }).catch(() => {
    // Offline first visits and unsupported browser policies must not break the app.
    registrationPromise = null;
  });

  return () => {
    disposed = true;
    for (const dispose of disposers) dispose();
  };
}

/** Activate a waiting build and reload this tab; the UI must let users save work first. */
export function applyUpdate(): void {
  const waiting = registration?.waiting;
  if (!waiting) return;
  updateRequested = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}
