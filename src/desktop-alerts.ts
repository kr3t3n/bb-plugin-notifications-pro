import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import {
  attentionNotificationBody,
  attentionNotificationTitle,
} from "./attention";

type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

type BbDesktopBridge = {
  platform?: string;
};

/** Live page notifications, so dismiss can close the original instead of a blank stand-in. */
const openOsNotifications = new Map<string, Notification>();

function desktopPlatform(): string | null {
  if (typeof window === "undefined") return null;
  const desktop = (window as Window & { bbDesktop?: BbDesktopBridge }).bbDesktop;
  return typeof desktop?.platform === "string" ? desktop.platform : null;
}

function rememberOsNotification(tag: string, notification: Notification): void {
  openOsNotifications.set(tag, notification);
  notification.onclose = () => {
    if (openOsNotifications.get(tag) === notification) {
      openOsNotifications.delete(tag);
    }
  };
}

/** Ask the browser for notification permission when it is still undecided. */
export async function ensureNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function notificationPermission():
  | NotificationPermission
  | "unsupported" {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.permission;
}

/**
 * Show one OS notification for a thread that just entered attention.
 * `tag` collapses repeat alerts for the same thread.
 */
export function showOsNotification(options: {
  title: string;
  body: string;
  tag: string;
  onOpen: () => void;
}): boolean {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return false;
  }
  if (Notification.permission !== "granted") return false;
  try {
    const notification = new Notification(options.title, {
      body: options.body,
      tag: options.tag,
    });
    rememberOsNotification(options.tag, notification);
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        // Some embeds block focus(); opening the target still helps.
      }
      options.onOpen();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}

export function threadOsNotificationTag(threadId: string): string {
  return `bb-notifications-pro:thread:${threadId}`;
}

export function showThreadResponseNotification(
  thread: PluginSidebarThread,
  onOpen: () => void,
): boolean {
  return showOsNotification({
    title: attentionNotificationTitle(thread),
    body: attentionNotificationBody(thread),
    tag: threadOsNotificationTag(thread.id),
    onOpen,
  });
}

/**
 * Close a lingering OS toast for a thread.
 * Prefer the original Notification handle. Hosts that ignore close() fall
 * back to a silent same-tag replacement, except the Mac app: there the
 * replacement is shown and close() is ignored, which leaves a blank toast.
 * On macOS the original toast stays until the user dismisses it when close()
 * itself does not stick.
 */
export function closeThreadOsNotification(threadId: string): void {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return;
  }
  if (Notification.permission !== "granted") return;
  const tag = threadOsNotificationTag(threadId);
  const existing = openOsNotifications.get(tag);
  if (existing) {
    openOsNotifications.delete(tag);
    try {
      existing.close();
    } catch {
      // Some hosts ignore Notification.close().
    }
  }
  if (desktopPlatform() === "macos") return;
  try {
    const notification = new Notification(" ", {
      body: " ",
      tag,
      silent: true,
    });
    notification.close();
  } catch {
    // Closing OS toasts is optional.
  }
}

export function showAssignedTaskNotification(
  options: { title: string; body: string; taskId: string },
  onOpen: () => void,
): boolean {
  return showOsNotification({
    title: options.title,
    body: options.body,
    tag: `bb-notifications-pro:assigned_task:${options.taskId}`,
    onOpen,
  });
}

/**
 * Badge the host app icon with a count.
 * On installed PWAs (and bb's Electron macOS Dock) this uses Chromium/WebKit
 * Badging (`navigator.setAppBadge`). Zero clears it. Also mirrors the count
 * into the root service worker — iOS home-screen badges often stick if only
 * the page calls clear while the SW last set the count.
 */
export async function syncAppBadge(count: number): Promise<void> {
  if (typeof navigator === "undefined") return;
  const next = Math.max(0, Math.floor(count));
  const badgeNav = navigator as BadgeNavigator;
  try {
    if (next <= 0) {
      if (typeof badgeNav.clearAppBadge === "function") {
        await badgeNav.clearAppBadge();
      }
      if (typeof badgeNav.setAppBadge === "function") {
        await badgeNav.setAppBadge(0);
      }
      await closeServiceWorkerNotifications();
    } else if (typeof badgeNav.setAppBadge === "function") {
      await badgeNav.setAppBadge(next);
    }
  } catch {
    // Badging is optional; Chromium/Electron may reject it.
  }
  await postBadgeToServiceWorker(next);
}

async function postBadgeToServiceWorker(count: number): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: "np-sync-badge", count });
  } catch {
    // SW may be missing on desktop-only installs.
  }
}

/** Drop SW-shown tray notifications so Android launcher badges can clear. */
async function closeServiceWorkerNotifications(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const notes = await registration.getNotifications();
    for (const note of notes) {
      note.close();
    }
  } catch {
    // Optional.
  }
}
