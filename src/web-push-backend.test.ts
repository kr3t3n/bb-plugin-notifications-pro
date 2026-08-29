import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import {
  deletePushSubscription,
  listPushSubscriptions,
  sendPushToSubscriptions,
  upsertPushSubscription,
  type PushSubscriptionDb,
} from "./web-push-backend";

function openTestDb(): PushSubscriptionDb {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE push_subscriptions (
      endpoint TEXT PRIMARY KEY NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  return db as unknown as PushSubscriptionDb;
}

describe("upsertPushSubscription", () => {
  it("inserts once and updates the same endpoint without duplicating", () => {
    const db = openTestDb();
    const first = upsertPushSubscription(
      db,
      {
        endpoint: "https://push.example/a",
        p256dh: "p1",
        auth: "a1",
      },
      1000,
    );
    expect(first.created).toBe(true);

    const second = upsertPushSubscription(
      db,
      {
        endpoint: "https://push.example/a",
        p256dh: "p2",
        auth: "a2",
      },
      2000,
    );
    expect(second.created).toBe(false);

    const rows = listPushSubscriptions(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      endpoint: "https://push.example/a",
      p256dh: "p2",
      auth: "a2",
      createdAt: 1000,
      updatedAt: 2000,
    });
  });
});

describe("record + push isolation", () => {
  it("keeps a successful record result when every push send fails", async () => {
    const db = openTestDb();
    upsertPushSubscription(db, {
      endpoint: "https://push.example/x",
      p256dh: "p",
      auth: "a",
    });

    const recorded = {
      item: {
        id: "thread:thr_1:1",
        title: "Hello",
        body: "Agent responded",
        targetKind: "thread" as const,
        targetId: "thr_1",
      },
      created: true,
    };

    const pushStats = await sendPushToSubscriptions({
      subscriptions: listPushSubscriptions(db),
      payload: {
        title: recorded.item.title,
        body: recorded.item.body,
        targetKind: recorded.item.targetKind,
        targetId: recorded.item.targetId,
        notificationId: recorded.item.id,
      },
      send: async () => {
        throw Object.assign(new Error("upstream 500"), { statusCode: 500 });
      },
      deleteEndpoint: (endpoint) => {
        deletePushSubscription(db, endpoint);
      },
    });

    expect(recorded.created).toBe(true);
    expect(pushStats.failed).toBe(1);
    expect(pushStats.pruned).toBe(0);
  });
});

describe("sendPushToSubscriptions", () => {
  it("prunes subscriptions that return 404 or 410", async () => {
    const db = openTestDb();
    upsertPushSubscription(db, {
      endpoint: "https://push.example/dead",
      p256dh: "p",
      auth: "a",
    });
    upsertPushSubscription(db, {
      endpoint: "https://push.example/live",
      p256dh: "p",
      auth: "a",
    });

    const send = vi.fn(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith("/dead")) {
        const err = new Error("Gone") as Error & { statusCode: number };
        err.statusCode = 410;
        throw err;
      }
    });

    const result = await sendPushToSubscriptions({
      subscriptions: listPushSubscriptions(db),
      payload: {
        title: "T",
        body: "B",
        targetKind: "thread",
        targetId: "thr_1",
        notificationId: "n1",
      },
      send,
      deleteEndpoint: (endpoint) => {
        deletePushSubscription(db, endpoint);
      },
    });

    expect(result).toEqual({ sent: 1, pruned: 1, failed: 0 });
    expect(listPushSubscriptions(db).map((r) => r.endpoint)).toEqual([
      "https://push.example/live",
    ]);
  });

  it("counts non-dead send failures without throwing", async () => {
    const db = openTestDb();
    upsertPushSubscription(db, {
      endpoint: "https://push.example/flaky",
      p256dh: "p",
      auth: "a",
    });

    const result = await sendPushToSubscriptions({
      subscriptions: listPushSubscriptions(db),
      payload: {
        title: "T",
        body: "B",
        targetKind: "task",
        targetId: "task_1",
        notificationId: "n2",
      },
      send: async () => {
        throw new Error("network down");
      },
      deleteEndpoint: (endpoint) => {
        deletePushSubscription(db, endpoint);
      },
    });

    expect(result).toEqual({ sent: 0, pruned: 0, failed: 1 });
    expect(listPushSubscriptions(db)).toHaveLength(1);
  });
});
