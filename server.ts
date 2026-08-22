// bb-plugin-notifications-pro — backend: settings, notification log, RPC.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const notificationSourceSchema = z.enum(["thread", "assigned_task"]);
const notificationTargetKindSchema = z.enum(["thread", "task"]);

const notificationRowSchema = z
  .object({
    id: z.string(),
    source: notificationSourceSchema,
    title: z.string(),
    body: z.string(),
    targetKind: notificationTargetKindSchema,
    targetId: z.string(),
    createdAt: z.number().int(),
    readAt: z.number().int().nullable(),
    dismissedAt: z.number().int().nullable(),
  })
  .strict();

export type NotificationRow = z.infer<typeof notificationRowSchema>;

export const rpcContract = defineRpcContract({
  list: {
    input: z
      .object({
        includeDismissed: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .strict(),
    output: z
      .object({
        items: z.array(notificationRowSchema),
        unreadCount: z.number().int(),
      })
      .strict(),
  },
  record: {
    input: z
      .object({
        id: z.string().min(1),
        source: notificationSourceSchema,
        title: z.string().min(1),
        body: z.string(),
        targetKind: notificationTargetKindSchema,
        targetId: z.string().min(1),
      })
      .strict(),
    output: z
      .object({
        item: notificationRowSchema,
        created: z.boolean(),
      })
      .strict(),
  },
  markRead: {
    input: z.object({ id: z.string().min(1) }).strict(),
    output: z.object({ ok: z.boolean() }).strict(),
  },
  markAllRead: {
    input: z.null(),
    output: z.object({ updated: z.number().int() }).strict(),
  },
  dismiss: {
    input: z.object({ id: z.string().min(1) }).strict(),
    output: z.object({ ok: z.boolean() }).strict(),
  },
  dismissForTarget: {
    input: z
      .object({
        targetKind: notificationTargetKindSchema,
        targetId: z.string().min(1),
      })
      .strict(),
    output: z.object({ dismissed: z.number().int() }).strict(),
  },
  clearDismissed: {
    input: z.null(),
    output: z.object({ removed: z.number().int() }).strict(),
  },
  listAssignedToMe: {
    input: z.null(),
    output: z
      .object({
        available: z.boolean(),
        error: z.string().nullable(),
        tasks: z.array(
          z
            .object({
              taskId: z.string(),
              key: z.string(),
              title: z.string(),
              status: z.string(),
              assignedAt: z.string(),
            })
            .strict(),
        ),
      })
      .strict(),
  },
});

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

const TASKS_PRO_PLUGIN_ID = "task-comment-float";

const assignedToMeOut = z
  .object({
    available: z.boolean(),
    error: z.string().nullable(),
    tasks: z.array(
      z
        .object({
          taskId: z.string(),
          key: z.string(),
          title: z.string(),
          status: z.string(),
          assignedAt: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

function rowFromStmt(row: Record<string, unknown>): NotificationRow {
  return notificationRowSchema.parse({
    id: row.id,
    source: row.source,
    title: row.title,
    body: row.body,
    targetKind: row.target_kind,
    targetId: row.target_id,
    createdAt: row.created_at,
    readAt: row.read_at ?? null,
    dismissedAt: row.dismissed_at ?? null,
  });
}

function listNotifications(
  db: Db,
  includeDismissed: boolean,
  limit: number,
): { items: NotificationRow[]; unreadCount: number } {
  const unreadCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM notifications
         WHERE read_at IS NULL AND dismissed_at IS NULL`,
      )
      .get() as { c: number }
  ).c;

  const items = includeDismissed
    ? (db
        .prepare(
          `SELECT * FROM notifications
           ORDER BY (read_at IS NULL) DESC, created_at DESC
           LIMIT ?`,
        )
        .all(limit) as Record<string, unknown>[])
    : (db
        .prepare(
          `SELECT * FROM notifications
           WHERE dismissed_at IS NULL
           ORDER BY (read_at IS NULL) DESC, created_at DESC
           LIMIT ?`,
        )
        .all(limit) as Record<string, unknown>[]);

  return { items: items.map(rowFromStmt), unreadCount };
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const settings = bb.settings.define({
    osNotifications: {
      type: "boolean",
      label: "Desktop OS notifications",
      description: "Show system toasts when a watched source fires.",
      default: true,
    },
    appBadge: {
      type: "boolean",
      label: "App / Dock badge",
      description: "Show the unread attention count on the app icon.",
      default: true,
    },
    sourceThreads: {
      type: "boolean",
      label: "Threads needing attention",
      description:
        "Notify when a thread becomes unread, waiting for input, or errors.",
      default: true,
    },
    sourceAssignedTasks: {
      type: "boolean",
      label: "Tasks assigned to me",
      description:
        "Notify when a Tasks Pro task is newly assigned to you.",
      default: true,
    },
  });

  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY NOT NULL,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      read_at INTEGER,
      dismissed_at INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS notifications_created_at_idx
      ON notifications (created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS notifications_unread_idx
      ON notifications (read_at, dismissed_at)`,
  ]);

  bb.rpc.register(rpcContract, {
    list: (input) =>
      listNotifications(db, input.includeDismissed, input.limit),
    record: (input) => {
      const existing = db
        .prepare(`SELECT id FROM notifications WHERE id = ?`)
        .get(input.id) as { id: string } | undefined;
      if (existing) {
        const row = db
          .prepare(`SELECT * FROM notifications WHERE id = ?`)
          .get(input.id) as Record<string, unknown>;
        return { item: rowFromStmt(row), created: false };
      }
      const createdAt = Date.now();
      db.prepare(
        `INSERT INTO notifications
          (id, source, title, body, target_kind, target_id, created_at, read_at, dismissed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      ).run(
        input.id,
        input.source,
        input.title,
        input.body,
        input.targetKind,
        input.targetId,
        createdAt,
      );
      const item: NotificationRow = {
        id: input.id,
        source: input.source,
        title: input.title,
        body: input.body,
        targetKind: input.targetKind,
        targetId: input.targetId,
        createdAt,
        readAt: null,
        dismissedAt: null,
      };
      bb.realtime.publish("notifications", { type: "recorded", item });
      return { item, created: true };
    },
    markRead: ({ id }) => {
      const result = db
        .prepare(
          `UPDATE notifications
           SET read_at = ?
           WHERE id = ? AND read_at IS NULL AND dismissed_at IS NULL`,
        )
        .run(Date.now(), id);
      if (result.changes > 0) {
        bb.realtime.publish("notifications", { type: "mark-read", id });
      }
      return { ok: result.changes > 0 };
    },
    markAllRead: () => {
      const result = db
        .prepare(
          `UPDATE notifications
           SET read_at = ?
           WHERE read_at IS NULL AND dismissed_at IS NULL`,
        )
        .run(Date.now());
      if (result.changes > 0) {
        bb.realtime.publish("notifications", { type: "mark-all-read" });
      }
      return { updated: result.changes };
    },
    dismiss: ({ id }) => {
      const result = db
        .prepare(
          `UPDATE notifications
           SET dismissed_at = ?, read_at = COALESCE(read_at, ?)
           WHERE id = ? AND dismissed_at IS NULL`,
        )
        .run(Date.now(), Date.now(), id);
      if (result.changes > 0) {
        bb.realtime.publish("notifications", { type: "dismiss", id });
      }
      return { ok: result.changes > 0 };
    },
    dismissForTarget: ({ targetKind, targetId }) => {
      const now = Date.now();
      const result = db
        .prepare(
          `UPDATE notifications
           SET dismissed_at = ?, read_at = COALESCE(read_at, ?)
           WHERE target_kind = ? AND target_id = ? AND dismissed_at IS NULL`,
        )
        .run(now, now, targetKind, targetId);
      if (result.changes > 0) {
        bb.realtime.publish("notifications", {
          type: "dismiss-for-target",
          targetKind,
          targetId,
          dismissed: result.changes,
        });
      }
      return { dismissed: result.changes };
    },
    clearDismissed: () => {
      const result = db
        .prepare(`DELETE FROM notifications WHERE dismissed_at IS NOT NULL`)
        .run();
      return { removed: result.changes };
    },
    async listAssignedToMe() {
      try {
        return await bb.sdk.plugins.callRpc({
          pluginId: TASKS_PRO_PLUGIN_ID,
          method: "listAssignedToMe",
          input: null,
          outputSchema: assignedToMeOut,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Tasks Pro unavailable";
        return { available: false, error: message, tasks: [] };
      }
    },
  });

  void settings.get();

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
