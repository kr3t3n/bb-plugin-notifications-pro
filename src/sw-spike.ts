/** NP-9 spike: root-scoped service worker from a plugin HTTP route. */

export const SW_SPIKE_PATH = "/sw.js";

export type SwSpikeStatus = {
  supported: boolean;
  scriptUrl: string | null;
  registrationScope: string | null;
  activeUrl: string | null;
  controllerUrl: string | null;
  /** Registration has root scope and our worker is active (spike success). */
  rootScoped: boolean;
  /** This page is currently controlled (may need a reload after first register). */
  controlling: boolean;
  error: string | null;
  checkedAt: number;
};

export function serviceWorkerScriptUrl(pluginId: string): string {
  return `/api/v1/plugins/${pluginId}/http${SW_SPIKE_PATH}`;
}

function absoluteScriptUrl(pluginId: string): string {
  return new URL(serviceWorkerScriptUrl(pluginId), location.origin).href;
}

function isOurWorker(scriptURL: string | undefined, pluginId: string): boolean {
  return scriptURL === absoluteScriptUrl(pluginId);
}

function isRootScope(scope: string | undefined): boolean {
  return scope === `${location.origin}/`;
}

export function emptySwSpikeStatus(error: string | null = null): SwSpikeStatus {
  return {
    supported: typeof navigator !== "undefined" && "serviceWorker" in navigator,
    scriptUrl: null,
    registrationScope: null,
    activeUrl: null,
    controllerUrl: null,
    rootScoped: false,
    controlling: false,
    error,
    checkedAt: Date.now(),
  };
}

export async function readSwSpikeStatus(
  pluginId: string,
): Promise<SwSpikeStatus> {
  const scriptUrl = serviceWorkerScriptUrl(pluginId);
  if (!("serviceWorker" in navigator)) {
    return emptySwSpikeStatus("serviceWorker unsupported");
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const active = registration?.active ?? null;
    const controller = navigator.serviceWorker.controller;
    const rootScoped =
      isRootScope(registration?.scope) && isOurWorker(active?.scriptURL, pluginId);
    const controlling = isOurWorker(controller?.scriptURL, pluginId);
    return {
      supported: true,
      scriptUrl,
      registrationScope: registration?.scope ?? null,
      activeUrl: active?.scriptURL ?? null,
      controllerUrl: controller?.scriptURL ?? null,
      rootScoped,
      controlling,
      error: null,
      checkedAt: Date.now(),
    };
  } catch (error) {
    return {
      ...emptySwSpikeStatus(
        error instanceof Error ? error.message : String(error),
      ),
      scriptUrl,
    };
  }
}

/**
 * Register the plugin-served worker with root scope.
 * Requires Service-Worker-Allowed: / on the script response.
 */
export async function registerRootScopedServiceWorker(
  pluginId: string,
): Promise<SwSpikeStatus> {
  const scriptUrl = serviceWorkerScriptUrl(pluginId);
  if (!("serviceWorker" in navigator)) {
    return emptySwSpikeStatus("serviceWorker unsupported");
  }

  try {
    const registration = await navigator.serviceWorker.register(scriptUrl, {
      scope: "/",
      updateViaCache: "none",
    });
    await registration.update();
    if (registration.installing) {
      await waitForWorkerState(registration.installing, "activated");
    } else if (registration.waiting) {
      registration.waiting.postMessage({ type: "np-spike-skip-waiting" });
      await waitForWorkerState(registration.waiting, "activated");
    }
    await navigator.serviceWorker.ready;
    // Claim may need a moment; iOS often leaves controller null until reload.
    await new Promise((resolve) => setTimeout(resolve, 100));
    return readSwSpikeStatus(pluginId);
  } catch (error) {
    return {
      ...emptySwSpikeStatus(
        error instanceof Error ? error.message : String(error),
      ),
      scriptUrl,
    };
  }
}

function waitForWorkerState(
  worker: ServiceWorker,
  state: ServiceWorkerState,
): Promise<void> {
  if (worker.state === state) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onChange = () => {
      if (worker.state === state) {
        worker.removeEventListener("statechange", onChange);
        resolve();
      } else if (worker.state === "redundant") {
        worker.removeEventListener("statechange", onChange);
        reject(new Error("service worker became redundant"));
      }
    };
    worker.addEventListener("statechange", onChange);
  });
}
