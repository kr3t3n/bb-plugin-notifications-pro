import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import {
  attentionNotificationBody,
  attentionNotificationTitle,
} from "./attention";

type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

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
 * Close a lingering OS toast for a thread by replacing the tag then closing.
 * Best-effort; some hosts ignore silent replace-close.
 */
export function closeThreadOsNotification(threadId: string): void {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return;
  }
  if (Notification.permission !== "granted") return;
  try {
    const notification = new Notification(" ", {
      body: " ",
      tag: threadOsNotificationTag(threadId),
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
 * On bb's Electron macOS build this maps to the Dock badge via Chromium's
 * Badging API (`navigator.setAppBadge`). Zero clears it.
 */
export async function syncAppBadge(count: number): Promise<void> {
  if (typeof navigator === "undefined") return;
  const badgeNav = navigator as BadgeNavigator;
  try {
    if (count <= 0) {
      if (typeof badgeNav.clearAppBadge === "function") {
        await badgeNav.clearAppBadge();
      } else if (typeof badgeNav.setAppBadge === "function") {
        await badgeNav.setAppBadge(0);
      }
      return;
    }
    if (typeof badgeNav.setAppBadge === "function") {
      await badgeNav.setAppBadge(count);
    }
  } catch {
    // Badging is optional; Chromium/Electron may reject it.
  }
}
