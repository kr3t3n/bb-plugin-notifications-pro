/** Client helpers for Web Push subscribe / unsubscribe (NP-11). */

import { ensureNotificationPermission } from "./desktop-alerts";
import { registerRootScopedServiceWorker } from "./sw-spike";

const ENDPOINT_STORAGE_KEY = "notifications-pro:push-endpoint";
const PLUGIN_ID = "notifications-pro";

export function storedPushEndpoint(): string | null {
  try {
    return localStorage.getItem(ENDPOINT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storePushEndpoint(endpoint: string | null): void {
  try {
    if (endpoint) localStorage.setItem(ENDPOINT_STORAGE_KEY, endpoint);
    else localStorage.removeItem(ENDPOINT_STORAGE_KEY);
  } catch {
    // localStorage may be unavailable.
  }
}

/** Convert a URL-safe base64 VAPID public key to a Uint8Array. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}

export type PushSubscribeRpc = {
  call(
    method: "getVapidPublicKey",
    input: null,
  ): Promise<{ publicKey: string }>;
  call(
    method: "subscribePush",
    input: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    },
  ): Promise<{ ok: true; created: boolean }>;
  call(
    method: "unsubscribePush",
    input: { endpoint: string },
  ): Promise<{ ok: boolean }>;
};

export type EnablePushResult =
  | { ok: true; endpoint: string; created: boolean }
  | { ok: false; error: string };

/** Same-origin RPC for content scripts (no React hooks). */
export async function callNotificationsProRpc<T>(
  method: string,
  input: unknown,
): Promise<T> {
  const response = await fetch(`/api/v1/plugins/${PLUGIN_ID}/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await response.json()) as {
    ok?: boolean;
    result?: T;
    error?: { message?: string };
  };
  if (!response.ok || data.ok !== true) {
    throw new Error(data.error?.message ?? `rpc ${method} failed`);
  }
  return data.result as T;
}

async function upsertSubscriptionFromBrowser(
  rpc: PushSubscribeRpc,
  subscription: PushSubscription,
): Promise<{ endpoint: string; created: boolean }> {
  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    throw new Error("Push subscription missing keys");
  }
  const result = await rpc.call("subscribePush", {
    endpoint,
    keys: { p256dh, auth },
  });
  storePushEndpoint(endpoint);
  return { endpoint, created: result.created };
}

/**
 * Re-attach an existing browser PushSubscription to the server.
 * No permission prompt. Safe to call on every home-screen launch.
 */
export async function reconcileExistingPushSubscription(args: {
  rpc: PushSubscribeRpc;
}): Promise<string | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return storedPushEndpoint();
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      return storedPushEndpoint();
    }
    const { endpoint } = await upsertSubscriptionFromBrowser(
      args.rpc,
      subscription,
    );
    return endpoint;
  } catch {
    return storedPushEndpoint();
  }
}

/**
 * User-gesture entry: permission → root SW → pushManager.subscribe → RPC.
 * Required once on iOS (home-screen PWA). Later launches reconcile only.
 */
export async function enableWebPushOnThisDevice(args: {
  pluginId: string;
  rpc: PushSubscribeRpc;
}): Promise<EnablePushResult> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, error: "Push messaging is unsupported in this browser" };
  }

  const permission = await ensureNotificationPermission();
  if (permission !== "granted") {
    return {
      ok: false,
      error:
        permission === "denied"
          ? "Notification permission denied"
          : "Notification permission not granted",
    };
  }

  const swStatus = await registerRootScopedServiceWorker(args.pluginId);
  if (!swStatus.rootScoped) {
    return {
      ok: false,
      error: swStatus.error ?? "Service worker did not claim root scope",
    };
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    try {
      const { endpoint, created } = await upsertSubscriptionFromBrowser(
        args.rpc,
        existing,
      );
      return { ok: true, endpoint, created };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const { publicKey } = await args.rpc.call("getVapidPublicKey", null);
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });

  try {
    const { endpoint, created } = await upsertSubscriptionFromBrowser(
      args.rpc,
      subscription,
    );
    return { ok: true, endpoint, created };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Drop the local push subscription and tell the server to forget the endpoint. */
export async function disableWebPushOnThisDevice(args: {
  rpc: PushSubscribeRpc;
}): Promise<void> {
  const endpoint = storedPushEndpoint();
  try {
    const registration = await navigator.serviceWorker?.ready;
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe().catch(() => undefined);
      if (!endpoint) storePushEndpoint(subscription.endpoint);
    }
    const toRemove = endpoint ?? subscription?.endpoint ?? null;
    if (toRemove) {
      await args.rpc
        .call("unsubscribePush", { endpoint: toRemove })
        .catch(() => undefined);
    }
  } finally {
    storePushEndpoint(null);
  }
}

export function pushTargetHref(args: {
  targetKind: string;
  targetId: string;
}): string {
  if (args.targetKind === "thread" && args.targetId) {
    return `/threads/${encodeURIComponent(args.targetId)}`;
  }
  if (args.targetKind === "task" && args.targetId) {
    return `/plugins/tasks/tasks/task/${encodeURIComponent(args.targetId)}`;
  }
  return "/";
}
