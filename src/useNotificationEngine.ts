import { useEffect, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import {
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSettings,
  experimental_useSidebarThreads as useSidebarThreads,
  experimental_useSidebarThreadActions as useSidebarThreadActions,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import {
  attentionNotificationBody,
  attentionNotificationTitle,
  collectClearedAttentionThreadIds,
  collectNewlyAwaitingThreads,
  countAttentionThreads,
  threadNeedsAttention,
  threadNotificationId,
} from "./attention";
import {
  assignedTaskNotificationBody,
  assignedTaskNotificationId,
  assignedTaskNotificationTitle,
  newlyAssignedTasks,
  openTasksPluginTask,
  type AssignedTask,
} from "./assigned-tasks";
import {
  closeThreadOsNotification,
  ensureNotificationPermission,
  showAssignedTaskNotification,
  showThreadResponseNotification,
  syncAppBadge,
} from "./desktop-alerts";
import { threadIdIsMuted } from "./muted-labels";

export type NotificationEngineState = {
  attentionCount: number;
  assignedCount: number;
  badgeCount: number;
  /** Thread ids currently silenced by muted Labels Pro labels. */
  mutedThreadIds: ReadonlySet<string>;
};

/** Shared across accessory + center mounts so edges fire once. */
let previousAwaiting: Map<string, boolean> | null = null;
let lastFingerprint: string | null = null;
let previousAssignedIds: Set<string> | null = null;
let lastAssignedFingerprint: string | null = null;
let engineMounts = 0;

/** Shared nav/Dock badge so accessory + center never diverge after a missed realtime. */
let sharedBadgeCount = 0;
/** Monotonic epoch so a slow getUnreadCount cannot overwrite a newer dismiss/list. */
let badgeEpoch = 0;
const badgeListeners = new Set<(count: number) => void>();

const ASSIGNED_POLL_MS = 5_000;
const MUTE_POLL_MS = 10_000;
const BADGE_POLL_MS = 2_000;

/** Test helper — current shared badge value. */
export function getSharedBadgeCount(): number {
  return sharedBadgeCount;
}

/** Claim the next badge epoch before an async unread lookup. */
export function beginBadgeRefresh(): number {
  badgeEpoch += 1;
  return badgeEpoch;
}

/**
 * Push the center unread count into every mounted engine (sidebar accessory
 * included). Call from the notification list refresh so an empty panel always
 * clears a stuck "1". Pass `epoch` from beginBadgeRefresh() for async lookups.
 */
export function applyUnreadBadgeCount(
  count: number,
  options?: { syncAppBadge?: boolean; epoch?: number },
): void {
  const epoch = options?.epoch ?? beginBadgeRefresh();
  if (epoch < badgeEpoch) return;
  badgeEpoch = epoch;
  const next = Math.max(0, Math.floor(count));
  sharedBadgeCount = next;
  for (const listener of badgeListeners) {
    listener(next);
  }
  if (options?.syncAppBadge === false) {
    void syncAppBadge(0);
    return;
  }
  void syncAppBadge(next);
}

type ProcessThreadArgs = {
  threads: readonly PluginSidebarThread[];
  activeThreadId: string | null;
  threadsEnabled: boolean;
  osEnabled: boolean;
  mutedThreadIds: ReadonlySet<string>;
  openThread: (threadId: string) => void;
  record: (thread: PluginSidebarThread) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  dismissForThread: (threadId: string) => Promise<void>;
};

function awaitingFingerprint(
  awaiting: Map<string, boolean>,
  activeThreadId: string | null,
  threadsEnabled: boolean,
  mutedThreadIds: ReadonlySet<string>,
): string {
  const parts: string[] = [
    `a:${activeThreadId ?? ""}`,
    `t:${threadsEnabled ? 1 : 0}`,
    `m:${[...mutedThreadIds].sort().join(",")}`,
  ];
  for (const [id, on] of awaiting) {
    if (on) parts.push(id);
  }
  parts.sort();
  return parts.join("|");
}

function processThreadSnapshot(args: ProcessThreadArgs): number {
  const count = args.threadsEnabled
    ? countAttentionThreads(args.threads, args.mutedThreadIds)
    : 0;

  const awaiting = new Map<string, boolean>();
  for (const thread of args.threads) {
    if (
      thread.isArchived ||
      !args.threadsEnabled ||
      threadIdIsMuted(thread.id, args.mutedThreadIds)
    ) {
      awaiting.set(thread.id, false);
      continue;
    }
    awaiting.set(thread.id, threadNeedsAttention(thread));
  }

  const fingerprint = awaitingFingerprint(
    awaiting,
    args.activeThreadId,
    args.threadsEnabled,
    args.mutedThreadIds,
  );
  if (fingerprint === lastFingerprint) {
    return count;
  }
  lastFingerprint = fingerprint;

  if (!args.threadsEnabled) {
    previousAwaiting = awaiting;
    return count;
  }

  const prior = previousAwaiting;
  if (prior === null) {
    previousAwaiting = awaiting;
    return count;
  }

  const newlyAwaiting = collectNewlyAwaitingThreads({
    threads: args.threads,
    awaiting,
    prior,
    activeThreadId: args.activeThreadId,
    mutedThreadIds: args.mutedThreadIds,
  });
  const clearedIds = collectClearedAttentionThreadIds({
    threads: args.threads,
    awaiting,
    prior,
  });
  previousAwaiting = awaiting;

  if (clearedIds.length > 0) {
    void (async () => {
      for (const threadId of clearedIds) {
        closeThreadOsNotification(threadId);
        await args.dismissForThread(threadId).catch(() => undefined);
      }
    })();
  }

  if (newlyAwaiting.length === 0) return count;

  void (async () => {
    if (args.osEnabled) {
      await ensureNotificationPermission();
    }
    for (const thread of newlyAwaiting) {
      await args.record(thread).catch(() => undefined);
      if (args.osEnabled) {
        const id = threadNotificationId(thread);
        showThreadResponseNotification(thread, () => {
          args.openThread(thread.id);
          void args.markRead(id);
        });
      }
    }
  })();

  return count;
}

type ProcessAssignedArgs = {
  tasks: readonly AssignedTask[];
  tasksEnabled: boolean;
  osEnabled: boolean;
  record: (task: AssignedTask) => Promise<void>;
  markRead: (id: string) => Promise<void>;
};

function assignedFingerprint(
  tasks: readonly AssignedTask[],
  tasksEnabled: boolean,
): string {
  if (!tasksEnabled) return "off";
  return tasks
    .map((task) => `${task.taskId}@${task.assignedAt}`)
    .sort()
    .join("|");
}

function processAssignedSnapshot(args: ProcessAssignedArgs): number {
  const count = args.tasksEnabled ? args.tasks.length : 0;
  const fingerprint = assignedFingerprint(args.tasks, args.tasksEnabled);
  if (fingerprint === lastAssignedFingerprint) {
    return count;
  }
  lastAssignedFingerprint = fingerprint;

  if (!args.tasksEnabled) {
    previousAssignedIds = null;
    return 0;
  }

  const prior = previousAssignedIds;
  const nextIds = new Set(args.tasks.map((task) => task.taskId));
  const newly = newlyAssignedTasks(args.tasks, prior);
  previousAssignedIds = nextIds;

  if (prior === null || newly.length === 0) {
    return count;
  }

  void (async () => {
    if (args.osEnabled) {
      await ensureNotificationPermission();
    }
    for (const task of newly) {
      await args.record(task).catch(() => undefined);
      if (args.osEnabled) {
        const id = assignedTaskNotificationId(task);
        showAssignedTaskNotification(
          {
            title: assignedTaskNotificationTitle(task),
            body: assignedTaskNotificationBody(task),
            taskId: task.taskId,
          },
          () => {
            openTasksPluginTask(task.key);
            void args.markRead(id);
          },
        );
      }
    }
  })();

  return count;
}

/**
 * Watch live threads + Tasks Pro assignees, edge-trigger OS + center records,
 * keep the Dock / nav badge on the center unread count. Safe to mount from the
 * sidebar accessory and the notification center at the same time.
 */
export function useNotificationEngine(): NotificationEngineState {
  const { threadId: activeThreadId } = useBbContext();
  const navigate = useBbNavigate();
  const { threads } = useSidebarThreads();
  const threadActions = useSidebarThreadActions();
  const settings = useSettings();
  const rpc = useRpc<typeof rpcContract>();
  const [attentionCount, setAttentionCount] = useState(0);
  const [assignedCount, setAssignedCount] = useState(0);
  const [badgeCount, setBadgeCount] = useState(sharedBadgeCount);
  const [assignedTasks, setAssignedTasks] = useState<AssignedTask[]>([]);
  const [mutedThreadIds, setMutedThreadIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const threadsEnabled =
    (settings.values?.sourceThreads as boolean | undefined) ?? true;
  const tasksEnabled =
    (settings.values?.sourceAssignedTasks as boolean | undefined) ?? true;
  const osEnabled =
    (settings.values?.osNotifications as boolean | undefined) ?? true;
  const badgeEnabled =
    (settings.values?.appBadge as boolean | undefined) ?? true;

  useEffect(() => {
    const listener = (count: number) => {
      setBadgeCount(count);
    };
    badgeListeners.add(listener);
    setBadgeCount(sharedBadgeCount);
    return () => {
      badgeListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    engineMounts += 1;
    return () => {
      engineMounts -= 1;
      if (engineMounts <= 0) {
        engineMounts = 0;
        void syncAppBadge(0);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refreshBadge = async () => {
      const epoch = beginBadgeRefresh();
      try {
        const result = await rpc.call("getUnreadCount", null);
        if (cancelled) return;
        applyUnreadBadgeCount(result.unreadCount, {
          syncAppBadge: badgeEnabled,
          epoch,
        });
      } catch {
        // Leave the last known badge if the lookup fails; the poll retries.
      }
    };

    void refreshBadge();
    const timer = window.setInterval(() => {
      void refreshBadge();
    }, BADGE_POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshBadge();
      }
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [rpc, badgeEnabled]);

  useRealtime("notifications", (event) => {
    const payload = event as {
      type?: string;
      targetKind?: string | null;
      targetId?: string | null;
      unreadCount?: number;
    };
    if (
      payload?.type === "dismiss" &&
      payload.targetKind === "thread" &&
      typeof payload.targetId === "string"
    ) {
      closeThreadOsNotification(payload.targetId);
    }
    if (payload?.type === "mute-labels-changed") {
      void rpc
        .call("getMuteConfig", null)
        .then((result) => {
          setMutedThreadIds(new Set(result.mutedThreadIds));
        })
        .catch(() => undefined);
      if (typeof payload.unreadCount === "number") {
        const enabled =
          (settings.values?.appBadge as boolean | undefined) ?? true;
        applyUnreadBadgeCount(payload.unreadCount, {
          syncAppBadge: enabled,
        });
      }
    }
    void (async () => {
      try {
        const enabled =
          (settings.values?.appBadge as boolean | undefined) ?? true;
        // Prefer the count stamped on the event so a slow follow-up RPC
        // cannot resurrect a dismissed badge.
        if (typeof payload?.unreadCount === "number") {
          applyUnreadBadgeCount(payload.unreadCount, {
            syncAppBadge: enabled,
          });
          return;
        }
        if (payload?.type === "mark-all-read") {
          applyUnreadBadgeCount(0, { syncAppBadge: true });
          return;
        }
        const epoch = beginBadgeRefresh();
        const result = await rpc.call("getUnreadCount", null);
        applyUnreadBadgeCount(result.unreadCount, {
          syncAppBadge: enabled,
          epoch,
        });
      } catch {
        // Ignore transient badge refresh failures; the poll retries.
      }
    })();
  });

  useEffect(() => {
    let cancelled = false;

    const pullMute = async () => {
      try {
        const result = await rpc.call("getMuteConfig", null);
        if (cancelled) return;
        setMutedThreadIds(new Set(result.mutedThreadIds));
      } catch {
        if (!cancelled) setMutedThreadIds(new Set());
      }
    };

    void pullMute();
    const timer = window.setInterval(() => {
      void pullMute();
    }, MUTE_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [rpc]);

  useEffect(() => {
    if (!tasksEnabled) {
      setAssignedTasks([]);
      return;
    }

    let cancelled = false;

    const pull = async () => {
      try {
        const result = await rpc.call("listAssignedToMe", null);
        if (cancelled) return;
        if (!result.available) {
          setAssignedTasks([]);
          return;
        }
        setAssignedTasks(result.tasks);
      } catch {
        if (!cancelled) setAssignedTasks([]);
      }
    };

    void pull();
    const timer = window.setInterval(() => {
      void pull();
    }, ASSIGNED_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tasksEnabled, rpc]);

  useEffect(() => {
    const threadCount = processThreadSnapshot({
      threads,
      activeThreadId,
      threadsEnabled,
      osEnabled,
      mutedThreadIds,
      openThread: (threadId) => {
        void threadActions.setRead(threadId, true).catch(() => undefined);
        navigate.toThread(threadId);
      },
      record: async (thread) => {
        await rpc.call("record", {
          id: threadNotificationId(thread),
          source: "thread",
          title: attentionNotificationTitle(thread),
          body: attentionNotificationBody(thread),
          targetKind: "thread",
          targetId: thread.id,
        });
      },
      markRead: async (id) => {
        await rpc.call("markRead", { id }).catch(() => undefined);
      },
      dismissForThread: async (threadId) => {
        await rpc
          .call("dismissForTarget", {
            targetKind: "thread",
            targetId: threadId,
          })
          .catch(() => undefined);
      },
    });

    const taskCount = processAssignedSnapshot({
      tasks: assignedTasks,
      tasksEnabled,
      osEnabled,
      record: async (task) => {
        await rpc.call("record", {
          id: assignedTaskNotificationId(task),
          source: "assigned_task",
          title: assignedTaskNotificationTitle(task),
          body: assignedTaskNotificationBody(task),
          targetKind: "task",
          targetId: task.key,
        });
      },
      markRead: async (id) => {
        await rpc.call("markRead", { id }).catch(() => undefined);
      },
    });

    setAttentionCount(threadCount);
    setAssignedCount(taskCount);
  }, [
    threads,
    assignedTasks,
    activeThreadId,
    threadsEnabled,
    tasksEnabled,
    osEnabled,
    mutedThreadIds,
    navigate,
    threadActions,
    rpc,
  ]);

  return {
    attentionCount,
    assignedCount,
    badgeCount,
    mutedThreadIds,
  };
}
