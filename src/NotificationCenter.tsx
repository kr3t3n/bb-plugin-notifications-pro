import { useCallback, useEffect, useState } from "react";
import {
  useBbNavigate,
  useRealtime,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract, NotificationRow } from "../server";
import { Button } from "@/components/ui/button";
import { openTasksPluginTask } from "./assigned-tasks";
import { useNotificationEngine } from "./useNotificationEngine";
import { cn } from "@/lib/utils";

function relativeTime(epochMs: number, now: number): string {
  const delta = Math.max(0, now - epochMs);
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function sourceLabel(source: NotificationRow["source"]): string {
  switch (source) {
    case "thread":
      return "Thread";
    case "assigned_task":
      return "Task";
  }
}

export function NotificationCenter() {
  // Keep the engine alive on compact viewports (sidebar accessory is hidden).
  useNotificationEngine();

  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const settings = useSettings();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMinute, setNowMinute] = useState(() =>
    Math.floor(Date.now() / 60_000),
  );

  useEffect(() => {
    const timer = setInterval(
      () => setNowMinute(Math.floor(Date.now() / 60_000)),
      60_000,
    );
    return () => clearInterval(timer);
  }, []);
  const now = nowMinute * 60_000;

  const refresh = useCallback(async () => {
    try {
      const result = await rpc.call("list", {
        includeDismissed: false,
        limit: 50,
      });
      setItems(result.items);
      setUnreadCount(result.unreadCount);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useRealtime("notifications", () => {
    void refresh();
  });

  const openItem = async (item: NotificationRow) => {
    if (item.readAt == null) {
      await rpc.call("markRead", { id: item.id }).catch(() => undefined);
    }
    if (item.targetKind === "thread") {
      navigate.toThread(item.targetId);
      return;
    }
    openTasksPluginTask(item.targetId);
  };

  const markAllRead = async () => {
    await rpc.call("markAllRead", null);
    await refresh();
  };

  const dismiss = async (id: string) => {
    await rpc.call("dismiss", { id });
    await refresh();
  };

  const threadsOn = (settings.values?.sourceThreads as boolean | undefined) ?? true;
  const tasksOn =
    (settings.values?.sourceAssignedTasks as boolean | undefined) ?? true;
  const osOn = (settings.values?.osNotifications as boolean | undefined) ?? true;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 overflow-auto p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-muted-foreground">
              {unreadCount === 0
                ? "No unread notifications."
                : `${unreadCount} unread`}
            </p>
            <p className="text-xs text-muted-foreground">
              Sources:{" "}
              {[
                threadsOn ? "threads" : null,
                tasksOn ? "assigned tasks" : null,
              ]
                .filter(Boolean)
                .join(", ") || "none"}
              {osOn ? " · OS toasts on" : " · OS toasts off"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={unreadCount === 0}
              onClick={() => {
                void markAllRead();
              }}
            >
              Mark all read
            </Button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}

        {!loading && items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              New thread responses and assigned tasks will show up here.
            </p>
          </div>
        ) : null}

        <ul className="space-y-2">
          {items.map((item) => {
            const unread = item.readAt == null;
            return (
              <li key={item.id}>
                <div
                  className={cn(
                    "flex items-start gap-3 rounded-lg border border-border px-3 py-3 transition-colors",
                    unread ? "bg-accent/40" : "bg-background",
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      void openItem(item);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {unread ? (
                        <span
                          className="inline-block size-1.5 shrink-0 rounded-full bg-primary"
                          aria-hidden
                        />
                      ) : (
                        <span className="inline-block size-1.5 shrink-0" />
                      )}
                      <span className="truncate text-sm font-medium text-foreground">
                        {item.title}
                      </span>
                    </div>
                    <p className="mt-1 pl-3.5 text-sm text-muted-foreground">
                      {item.body}
                    </p>
                    <p className="mt-1 pl-3.5 text-xs text-muted-foreground">
                      {sourceLabel(item.source)} ·{" "}
                      {relativeTime(item.createdAt, now)}
                    </p>
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => {
                      void dismiss(item.id);
                    }}
                  >
                    Dismiss
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
