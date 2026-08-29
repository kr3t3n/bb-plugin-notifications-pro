import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import {
  attentionNotificationBody,
  countAttentionThreads,
  collectClearedAttentionThreadIds,
  collectNewlyAwaitingThreads,
  threadNeedsAttention,
  threadNotificationId,
} from "./attention";

function thread(
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id: "thr_1",
    projectId: "proj_1",
    title: "A thread",
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
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
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

describe("threadNeedsAttention", () => {
  it("is true for unread threads", () => {
    expect(threadNeedsAttention(thread({ isUnread: true }))).toBe(true);
  });

  it("is true for unread-success", () => {
    expect(
      threadNeedsAttention(thread({ indicator: "unread-success" })),
    ).toBe(true);
  });

  it("is true when waiting for input", () => {
    expect(
      threadNeedsAttention(thread({ indicator: "waiting-for-input" })),
    ).toBe(true);
  });

  it("is true for pending interaction", () => {
    expect(
      threadNeedsAttention(thread({ hasPendingInteraction: true })),
    ).toBe(true);
  });

  it("is false for a quiet idle thread", () => {
    expect(threadNeedsAttention(thread())).toBe(false);
  });
});

describe("countAttentionThreads", () => {
  it("skips archived threads", () => {
    expect(
      countAttentionThreads([
        thread({ id: "a", isUnread: true }),
        thread({ id: "b", isUnread: true, isArchived: true }),
      ]),
    ).toBe(1);
  });

  it("skips muted-label threads", () => {
    expect(
      countAttentionThreads(
        [
          thread({ id: "a", isUnread: true }),
          thread({ id: "b", isUnread: true }),
        ],
        new Set(["b"]),
      ),
    ).toBe(1);
  });
});

describe("attentionNotificationBody", () => {
  it("names waiting-for-input", () => {
    expect(
      attentionNotificationBody(
        thread({ indicator: "waiting-for-input" }),
      ),
    ).toBe("Needs your input");
  });

  it("names agent response", () => {
    expect(attentionNotificationBody(thread({ isUnread: true }))).toBe(
      "Agent responded",
    );
  });
});

describe("threadNotificationId", () => {
  it("includes attention timestamp", () => {
    expect(
      threadNotificationId(thread({ id: "thr_x", latestAttentionAt: 42 })),
    ).toBe("thread:thr_x:42");
  });
});

describe("collectNewlyAwaitingThreads", () => {
  it("edge-triggers only false→true transitions", () => {
    const quiet = thread({ id: "a", isUnread: false });
    const rising = thread({ id: "b", isUnread: true });
    const still = thread({ id: "c", isUnread: true });
    const awaiting = new Map([
      ["a", false],
      ["b", true],
      ["c", true],
    ]);
    const prior = new Map([
      ["a", false],
      ["b", false],
      ["c", true],
    ]);
    expect(
      collectNewlyAwaitingThreads({
        threads: [quiet, rising, still],
        awaiting,
        prior,
        activeThreadId: null,
      }).map((t) => t.id),
    ).toEqual(["b"]);
  });

  it("skips the active thread", () => {
    const active = thread({ id: "active", isUnread: true });
    const other = thread({ id: "other", isUnread: true });
    const awaiting = new Map([
      ["active", true],
      ["other", true],
    ]);
    const prior = new Map([
      ["active", false],
      ["other", false],
    ]);
    expect(
      collectNewlyAwaitingThreads({
        threads: [active, other],
        awaiting,
        prior,
        activeThreadId: "active",
      }).map((t) => t.id),
    ).toEqual(["other"]);
  });

  it("skips archived threads", () => {
    const archived = thread({
      id: "arch",
      isUnread: true,
      isArchived: true,
    });
    const awaiting = new Map([["arch", true]]);
    const prior = new Map([["arch", false]]);
    expect(
      collectNewlyAwaitingThreads({
        threads: [archived],
        awaiting,
        prior,
        activeThreadId: null,
      }),
    ).toEqual([]);
  });

  it("skips muted-label threads", () => {
    const muted = thread({ id: "muted", isUnread: true });
    const other = thread({ id: "other", isUnread: true });
    const awaiting = new Map([
      ["muted", true],
      ["other", true],
    ]);
    const prior = new Map([
      ["muted", false],
      ["other", false],
    ]);
    expect(
      collectNewlyAwaitingThreads({
        threads: [muted, other],
        awaiting,
        prior,
        activeThreadId: null,
        mutedThreadIds: new Set(["muted"]),
      }).map((t) => t.id),
    ).toEqual(["other"]);
  });
});

describe("collectClearedAttentionThreadIds", () => {
  it("edge-triggers only true→false transitions", () => {
    const still = thread({ id: "a", isUnread: true });
    const cleared = thread({ id: "b", isUnread: false });
    const quiet = thread({ id: "c", isUnread: false });
    const awaiting = new Map([
      ["a", true],
      ["b", false],
      ["c", false],
    ]);
    const prior = new Map([
      ["a", true],
      ["b", true],
      ["c", false],
    ]);
    expect(
      collectClearedAttentionThreadIds({
        threads: [still, cleared, quiet],
        awaiting,
        prior,
      }),
    ).toEqual(["b"]);
  });

  it("clears archived threads that leave attention", () => {
    const archived = thread({
      id: "arch",
      isUnread: false,
      isArchived: true,
    });
    expect(
      collectClearedAttentionThreadIds({
        threads: [archived],
        awaiting: new Map([["arch", false]]),
        prior: new Map([["arch", true]]),
      }),
    ).toEqual(["arch"]);
  });

  it("clears ids that disappeared from the sidebar", () => {
    expect(
      collectClearedAttentionThreadIds({
        threads: [],
        awaiting: new Map(),
        prior: new Map([
          ["gone", true],
          ["quiet", false],
        ]),
      }),
    ).toEqual(["gone"]);
  });
});
