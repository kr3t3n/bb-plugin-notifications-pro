import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import {
  closeThreadOsNotification,
  showAssignedTaskNotification,
  showThreadResponseNotification,
  syncAppBadge,
} from "./desktop-alerts";

function thread(
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id: "thr_1",
    projectId: "proj_1",
    title: "Hello",
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "unread-success",
    indicatorLabel: null,
    isUnread: true,
    isPinned: false,
    isArchived: false,
    environment: null,
    host: null,
    createdAt: 100,
    updatedAt: 100,
    lastReadAt: 100,
    latestAttentionAt: 100,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("syncAppBadge", () => {
  it("sets the badge when the Badging API exists", async () => {
    const setAppBadge = vi.fn(async () => undefined);
    const clearAppBadge = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { setAppBadge, clearAppBadge });
    await syncAppBadge(3);
    expect(setAppBadge).toHaveBeenCalledWith(3);
  });

  it("clears the badge at zero", async () => {
    const setAppBadge = vi.fn(async () => undefined);
    const clearAppBadge = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { setAppBadge, clearAppBadge });
    await syncAppBadge(0);
    expect(clearAppBadge).toHaveBeenCalled();
  });
});

describe("showThreadResponseNotification", () => {
  it("returns false when permission is not granted", () => {
    vi.stubGlobal("Notification", {
      permission: "denied",
    });
    expect(showThreadResponseNotification(thread(), () => undefined)).toBe(
      false,
    );
  });

  it("creates a tagged notification when granted", () => {
    const NotificationMock = vi.fn(function NotificationMock(
      this: { onclick: null | (() => void); close: () => void },
      _title: string,
      _opts: unknown,
    ) {
      this.onclick = null;
      this.close = vi.fn();
    });
    Object.assign(NotificationMock, {
      permission: "granted" as NotificationPermission,
    });
    vi.stubGlobal("Notification", NotificationMock);
    vi.stubGlobal("window", { focus: vi.fn() });

    expect(showThreadResponseNotification(thread(), () => undefined)).toBe(
      true,
    );
    expect(NotificationMock).toHaveBeenCalledWith("Hello", {
      body: "Agent responded",
      tag: "bb-notifications-pro:thread:thr_1",
    });
  });
});

describe("closeThreadOsNotification", () => {
  it("replaces the tag and closes when permission is granted", () => {
    const close = vi.fn();
    const NotificationMock = vi.fn(function NotificationMock(
      this: { onclick: null | (() => void); close: () => void },
    ) {
      this.onclick = null;
      this.close = close;
    });
    Object.assign(NotificationMock, {
      permission: "granted" as NotificationPermission,
    });
    vi.stubGlobal("Notification", NotificationMock);
    vi.stubGlobal("window", { focus: vi.fn() });

    closeThreadOsNotification("thr_1");
    expect(NotificationMock).toHaveBeenCalledWith(" ", {
      body: " ",
      tag: "bb-notifications-pro:thread:thr_1",
      silent: true,
    });
    expect(close).toHaveBeenCalled();
  });
});

describe("showAssignedTaskNotification", () => {
  it("creates a tagged assigned-task notification", () => {
    const NotificationMock = vi.fn(function NotificationMock(
      this: { onclick: null | (() => void); close: () => void },
      _title: string,
      _opts: unknown,
    ) {
      this.onclick = null;
      this.close = vi.fn();
    });
    Object.assign(NotificationMock, {
      permission: "granted" as NotificationPermission,
    });
    vi.stubGlobal("Notification", NotificationMock);
    vi.stubGlobal("window", { focus: vi.fn() });

    expect(
      showAssignedTaskNotification(
        {
          title: "Notify on assign",
          body: "Assigned to you · NP-2",
          taskId: "tid_1",
        },
        () => undefined,
      ),
    ).toBe(true);
    expect(NotificationMock).toHaveBeenCalledWith("Notify on assign", {
      body: "Assigned to you · NP-2",
      tag: "bb-notifications-pro:assigned_task:tid_1",
    });
  });
});
