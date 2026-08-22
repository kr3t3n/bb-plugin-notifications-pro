import type { PluginSidebarThread } from "@get-bb/plugin-sdk";

const NEEDS_YOU_INDICATORS = new Set([
  "waiting-for-input",
  "unread-error",
]);

/** Thread that just got an agent response, or that needs the user now. */
export function threadNeedsAttention(thread: PluginSidebarThread): boolean {
  if (thread.hasPendingInteraction) return true;
  if (NEEDS_YOU_INDICATORS.has(thread.indicator)) return true;
  if (thread.isUnread) return true;
  if (thread.indicator === "unread-success") return true;
  return false;
}

/** How many non-archived threads need attention right now. */
export function countAttentionThreads(
  threads: readonly PluginSidebarThread[],
): number {
  let count = 0;
  for (const thread of threads) {
    if (thread.isArchived) continue;
    if (threadNeedsAttention(thread)) count += 1;
  }
  return count;
}

export function threadDisplayTitle(thread: PluginSidebarThread): string {
  const title = thread.title?.trim();
  if (title) return title;
  const fallback = thread.titleFallback?.trim();
  return fallback ? fallback : "Untitled thread";
}

export function attentionNotificationTitle(
  thread: PluginSidebarThread,
): string {
  return threadDisplayTitle(thread);
}

export function attentionNotificationBody(
  thread: PluginSidebarThread,
): string {
  if (
    thread.hasPendingInteraction ||
    thread.indicator === "waiting-for-input"
  ) {
    return "Needs your input";
  }
  if (thread.indicator === "unread-error") {
    return "Failed — needs attention";
  }
  return "Agent responded";
}

/** Stable id so repeat edge events for the same attention window collapse. */
export function threadNotificationId(thread: PluginSidebarThread): string {
  return `thread:${thread.id}:${thread.latestAttentionAt}`;
}

/**
 * Threads that just entered attention since the prior snapshot.
 * Skips archived threads and the currently active thread.
 */
export function collectNewlyAwaitingThreads(args: {
  threads: readonly PluginSidebarThread[];
  awaiting: Map<string, boolean>;
  prior: Map<string, boolean>;
  activeThreadId: string | null;
}): PluginSidebarThread[] {
  const newly: PluginSidebarThread[] = [];
  for (const thread of args.threads) {
    if (thread.isArchived) continue;
    const now = args.awaiting.get(thread.id) === true;
    const was = args.prior.get(thread.id) === true;
    if (now && !was && thread.id !== args.activeThreadId) {
      newly.push(thread);
    }
  }
  return newly;
}

/**
 * Thread ids that left attention since the prior snapshot (true→false).
 * Includes archived threads so their center rows still clear.
 */
export function collectClearedAttentionThreadIds(args: {
  threads: readonly PluginSidebarThread[];
  awaiting: Map<string, boolean>;
  prior: Map<string, boolean>;
}): string[] {
  const cleared: string[] = [];
  const seen = new Set<string>();

  for (const thread of args.threads) {
    seen.add(thread.id);
    const now = args.awaiting.get(thread.id) === true;
    const was = args.prior.get(thread.id) === true;
    if (was && !now) cleared.push(thread.id);
  }

  // Threads that vanished from the sidebar still need cleanup.
  for (const [id, was] of args.prior) {
    if (!was || seen.has(id)) continue;
    if (args.awaiting.get(id) !== true) cleared.push(id);
  }

  return cleared;
}
