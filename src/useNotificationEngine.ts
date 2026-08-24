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

export type NotificationEngineState = {
  attentionCount: number;
  assignedCount: number;
  badgeCount: number;
};

/** Shared across accessory + center mounts so edges fire once. */
let previousAwaiting: Map<string, boolean> | null = null;
let lastFingerprint: string | null = null;
let previousAssignedIds: Set<string> | null = null;
let lastAssignedFingerprint: string | null = null;
let engineMounts = 0;

const ASSIGNED_POLL_MS = 5_000;

type ProcessThreadArgs = {
  threads: readonly PluginSidebarThread[];
  activeThreadId: string | null;
  threadsEnabled: boolean;
  osEnabled: boolean;
  openThread: (threadId: string) => void;
  record: (
    thread: PluginSidebarThread,
    content: { title: string; body: string },
  ) => Promise<void>;
  fetchResponsePreview: (threadId: string) => Promise<string | null>;
  markRead: (id: string) => Promise<void>;
  dismissForThread: (threadId: string) => Promise<void>;
};

function awaitingFingerprint(
  awaiting: Map<string, boolean>,
  activeThreadId: string | null,
  threadsEnabled: boolean,
): string {
  const parts: string[] = [
    `a:${activeThreadId ?? ""}`,
    `t:${threadsEnabled ? 1 : 0}`,
  ];
  for (const [id, on] of awaiting) {
    if (on) parts.push(id);
  }
  parts.sort();
  return parts.join("|");
}

function processThreadSnapshot(args: ProcessThreadArgs): number {
  const count = args.threadsEnabled
    ? countAttentionThreads(args.threads)
    : 0;

  const awaiting = new Map<string, boolean>();
  for (const thread of args.threads) {
    if (thread.isArchived || !args.threadsEnabled) {
      awaiting.set(thread.id, false);
      continue;
    }
    awaiting.set(thread.id, threadNeedsAttention(thread));
  }

  const fingerprint = awaitingFingerprint(
    awaiting,
    args.activeThreadId,
    args.threadsEnabled,
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
      const responsePreview = await args
        .fetchResponsePreview(thread.id)
        .catch(() => null);
      const title = attentionNotificationTitle(thread);
      const body = attentionNotificationBody(thread, { responsePreview });
      await args.record(thread, { title, body }).catch(() => undefined);
      if (args.osEnabled) {
        const id = threadNotificationId(thread);
        showThreadResponseNotification(
          thread,
          () => {
            args.openThread(thread.id);
            void args.markRead(id);
          },
          { body },
        );
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
  const [badgeCount, setBadgeCount] = useState(0);
  const [assignedTasks, setAssignedTasks] = useState<AssignedTask[]>([]);

  const threadsEnabled =
    (settings.values?.sourceThreads as boolean | undefined) ?? true;
  const tasksEnabled =
    (settings.values?.sourceAssignedTasks as boolean | undefined) ?? true;
  const osEnabled =
    (settings.values?.osNotifications as boolean | undefined) ?? true;
  const badgeEnabled =
    (settings.values?.appBadge as boolean | undefined) ?? true;

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
      try {
        const result = await rpc.call("getUnreadCount", null);
        if (cancelled) return;
        const next = result.unreadCount;
        setBadgeCount(next);
        if (badgeEnabled) {
          void syncAppBadge(next);
        } else {
          void syncAppBadge(0);
        }
      } catch {
        // Leave the last known badge if the lookup fails.
      }
    };

    void refreshBadge();

    return () => {
      cancelled = true;
    };
  }, [rpc, badgeEnabled]);

  useRealtime("notifications", (event) => {
    const payload = event as {
      type?: string;
      targetKind?: string | null;
      targetId?: string | null;
    };
    if (
      payload?.type === "dismiss" &&
      payload.targetKind === "thread" &&
      typeof payload.targetId === "string"
    ) {
      closeThreadOsNotification(payload.targetId);
    }
    void (async () => {
      try {
        const result = await rpc.call("getUnreadCount", null);
        const enabled =
          (settings.values?.appBadge as boolean | undefined) ?? true;
        setBadgeCount(result.unreadCount);
        if (enabled) {
          void syncAppBadge(result.unreadCount);
        } else {
          void syncAppBadge(0);
        }
      } catch {
        // Ignore transient badge refresh failures.
      }
    })();
  });

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
      openThread: (threadId) => {
        void threadActions.setRead(threadId, true).catch(() => undefined);
        navigate.toThread(threadId);
      },
      record: async (thread, content) => {
        await rpc.call("record", {
          id: threadNotificationId(thread),
          source: "thread",
          title: content.title,
          body: content.body,
          targetKind: "thread",
          targetId: thread.id,
        });
      },
      fetchResponsePreview: async (threadId) => {
        const result = await rpc.call("getResponsePreview", { threadId });
        return result.preview;
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
    navigate,
    threadActions,
    rpc,
  ]);

  return {
    attentionCount,
    assignedCount,
    badgeCount,
  };
}
