// bb-plugin-notifications-pro — backend: settings, notification log, RPC, web push.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import webpush from "web-push";
import { z } from "zod";
import {
  deletePushSubscription,
  listPushSubscriptions,
  sendPushToSubscriptions,
  upsertPushSubscription,
  type VapidKeyPair,
} from "./src/web-push-backend";
import {
  parseMutedLabels,
  serializeMutedLabels,
  suggestedMuteLabels,
} from "./src/muted-labels";
import {
  LABELS_PRO_PLUGIN_ID,
  defaultAutoTagLabelName,
  listAssignmentsOut,
  listLabelsOut,
  listThreadsByLabelOut,
  resolveMutedThreadIds,
  toLabelRef,
  type LabelsProLabel,
} from "./src/labels-pro";

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
  getUnreadCount: {
    input: z.null(),
    output: z.object({ unreadCount: z.number().int() }).strict(),
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
  getVapidPublicKey: {
    input: z.null(),
    output: z.object({ publicKey: z.string().min(1) }).strict(),
  },
  subscribePush: {
    input: z
      .object({
        endpoint: z.string().url(),
        keys: z
          .object({
            p256dh: z.string().min(1),
            auth: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
    output: z
      .object({
        ok: z.literal(true),
        created: z.boolean(),
      })
      .strict(),
  },
  unsubscribePush: {
    input: z.object({ endpoint: z.string().url() }).strict(),
    output: z.object({ ok: z.boolean() }).strict(),
  },
  getMuteConfig: {
    input: z.null(),
    output: z
      .object({
        mutedLabels: z.array(z.string()),
        suggestedLabels: z.array(z.string()),
        mutedThreadIds: z.array(z.string()),
        labelsPro: z
          .object({
            available: z.boolean(),
            error: z.string().nullable(),
            labels: z.array(
              z
                .object({
                  id: z.string(),
                  name: z.string(),
                  slug: z.string(),
                  color: z.string().nullable(),
                })
                .strict(),
            ),
            autoTagEnabled: z.boolean(),
            autoTagLabelName: z.string(),
          })
          .strict(),
      })
      .strict(),
  },
  setMutedLabels: {
    input: z
      .object({
        labels: z.array(z.string()),
      })
      .strict(),
    output: z
      .object({
        mutedLabels: z.array(z.string()),
      })
      .strict(),
  },
});

const VAPID_KV_KEY = "vapid.keypair";
// Apple Push rejects invalid/local subjects with BadJwtToken.
const VAPID_SUBJECT = "https://bb-agents.taile81e05.ts.net";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

const TASKS_PRO_PLUGIN_ID = "task-comment-float";
const MUTED_LABELS_KV_KEY = "mute.labels";

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

type LabelsProSnapshot = {
  available: boolean;
  error: string | null;
  labels: Array<{
    id: string;
    name: string;
    slug: string;
    color: string | null;
  }>;
  autoTagEnabled: boolean;
  autoTagLabelName: string;
  mutedThreadIds: string[];
};

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
    webPush: {
      type: "boolean",
      label: "Phone web push",
      description:
        "Send Web Push when a watched source fires (home-screen PWA). Independent of desktop OS toasts.",
      default: false,
    },
    mutedLabels: {
      type: "string",
      experimental_multiline: true,
      label: "Muted Labels Pro labels",
      description:
        "Comma or newline separated label names/slugs. Threads with these labels skip OS toast, web push, and center attention edges. Prefer the Mute labels panel below for checkboxes.",
      default: "",
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
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  ]);

  async function readMutedLabels(): Promise<string[]> {
    const fromKv = await bb.storage.kv.get<unknown>(MUTED_LABELS_KV_KEY);
    // Undefined = never set via panel/RPC; fall back to the string setting.
    // An explicit empty array means the user cleared every mute.
    if (fromKv !== undefined) {
      return parseMutedLabels(fromKv);
    }
    try {
      const cfg = await settings.get();
      return parseMutedLabels(cfg.mutedLabels);
    } catch {
      return [];
    }
  }

  async function writeMutedLabels(labels: readonly string[]): Promise<string[]> {
    const next = serializeMutedLabels(labels);
    await bb.storage.kv.set(MUTED_LABELS_KV_KEY, next);
    bb.realtime.publish("notifications", {
      type: "mute-labels-changed",
      mutedLabels: next,
    });
    return next;
  }

  async function fetchLabelsProSnapshot(
    mutedLabels: readonly string[],
  ): Promise<LabelsProSnapshot> {
    const mutedKeys = new Set(mutedLabels.map((l) => l.trim().toLowerCase()).filter(Boolean));
    const empty: LabelsProSnapshot = {
      available: false,
      error: null,
      labels: [],
      autoTagEnabled: false,
      autoTagLabelName: defaultAutoTagLabelName(),
      mutedThreadIds: [],
    };

    let labels: LabelsProLabel[] = [];
    try {
      const listed = await bb.sdk.plugins.callRpc({
        pluginId: LABELS_PRO_PLUGIN_ID,
        method: "listLabels",
        input: null,
        outputSchema: listLabelsOut,
      });
      labels = listed.labels;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Labels Pro unavailable";
      return { ...empty, error: message };
    }

    const labelDtos = labels.map((label) => {
      const ref = toLabelRef(label);
      return {
        id: ref.id,
        name: ref.name,
        slug: typeof ref.slug === "string" ? ref.slug : normalizeSlug(ref.name),
        color: label.color ?? null,
      };
    });

    // Auto-tag settings land with LABL-5; until then, treat an existing
    // `automation` label as the signal that auto-tag is in play.
    const autoTagLabelName = defaultAutoTagLabelName();
    const autoTagEnabled = labelDtos.some(
      (label) =>
        label.name.toLowerCase() === autoTagLabelName ||
        label.slug.toLowerCase() === autoTagLabelName,
    );

    let mutedThreadIds: string[] = [];
    if (mutedKeys.size > 0) {
      // Prefer bulk assignments when Labels Pro exposes them (Sidebar Pro).
      try {
        const bulk = await bb.sdk.plugins.callRpc({
          pluginId: LABELS_PRO_PLUGIN_ID,
          method: "listAssignments",
          input: null,
          outputSchema: listAssignmentsOut,
        });
        const labelIdsByThreadId = new Map<string, string[]>();
        for (const row of bulk.assignments) {
          labelIdsByThreadId.set(row.threadId, row.labelIds);
        }
        mutedThreadIds = [
          ...resolveMutedThreadIds({
            mutedKeys,
            labels,
            labelIdsByThreadId,
          }),
        ];
      } catch {
        const threadIdsByMutedKey = new Map<string, string[]>();
        for (const key of mutedKeys) {
          try {
            const result = await bb.sdk.plugins.callRpc({
              pluginId: LABELS_PRO_PLUGIN_ID,
              method: "listThreadsByLabel",
              input: { labelName: key },
              outputSchema: listThreadsByLabelOut,
            });
            threadIdsByMutedKey.set(key, result.threadIds);
          } catch {
            // Label may not exist yet; skip.
          }
        }
        mutedThreadIds = [
          ...resolveMutedThreadIds({
            mutedKeys,
            labels,
            threadIdsByMutedKey,
          }),
        ];
      }
    }

    return {
      available: true,
      error: null,
      labels: labelDtos,
      autoTagEnabled,
      autoTagLabelName,
      mutedThreadIds,
    };
  }

  function normalizeSlug(name: string): string {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    return slug.length > 0 ? slug : "label";
  }

  async function ensureVapidKeys(): Promise<VapidKeyPair> {
    const existing = await bb.storage.kv.get<VapidKeyPair>(VAPID_KV_KEY);
    if (
      existing &&
      typeof existing.publicKey === "string" &&
      existing.publicKey.length > 0 &&
      typeof existing.privateKey === "string" &&
      existing.privateKey.length > 0
    ) {
      return existing;
    }
    const generated = webpush.generateVAPIDKeys();
    const pair: VapidKeyPair = {
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
    };
    await bb.storage.kv.set(VAPID_KV_KEY, pair);
    return pair;
  }

  async function sendPushesForRecord(item: NotificationRow): Promise<void> {
    const cfg = await settings.get();
    if (!cfg.webPush) return;

    const subscriptions = listPushSubscriptions(db);
    if (subscriptions.length === 0) return;

    const keys = await ensureVapidKeys();
    const href =
      item.targetKind === "thread"
        ? `/threads/${encodeURIComponent(item.targetId)}`
        : item.targetKind === "task"
          ? `/plugins/tasks/tasks/task/${encodeURIComponent(item.targetId)}`
          : "/";
    // Use the same title/body the desktop toast already recorded (from
    // attentionNotificationTitle / attentionNotificationBody on the client).
    await sendPushToSubscriptions({
      subscriptions,
      payload: {
        title: item.title,
        body: item.body,
        targetKind: item.targetKind,
        targetId: item.targetId,
        notificationId: item.id,
      },
      send: async (subscription, payload) => {
        // Embed href for the service worker click handler.
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        const withHref = JSON.stringify({ ...parsed, href });
        await webpush.sendNotification(subscription, withHref, {
          vapidDetails: {
            subject: VAPID_SUBJECT,
            publicKey: keys.publicKey,
            privateKey: keys.privateKey,
          },
          TTL: 60,
          urgency: "high",
        });
      },
      deleteEndpoint: (endpoint) => {
        deletePushSubscription(db, endpoint);
      },
    }).then((stats) => {
      if (stats.failed > 0 || stats.pruned > 0) {
        bb.log.warn(
          `web push stats sent=${stats.sent} pruned=${stats.pruned} failed=${stats.failed}`,
        );
      }
    });
  }

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
      // Push is additive: never let send failures break the notification log.
      void sendPushesForRecord(item).catch((error) => {
        const message =
          error instanceof Error ? error.message : "push send failed";
        bb.log.warn(`web push after record failed: ${message}`);
      });
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
      // Always publish so clients clear the app/tab badge even when the
      // unread set was already empty (stale badge) or this is a no-op.
      bb.realtime.publish("notifications", {
        type: "mark-all-read",
        updated: result.changes,
      });
      return { updated: result.changes };
    },
    dismiss: ({ id }) => {
      const existing = db
        .prepare(`SELECT * FROM notifications WHERE id = ?`)
        .get(id) as Record<string, unknown> | undefined;
      const result = db
        .prepare(
          `UPDATE notifications
           SET dismissed_at = ?, read_at = COALESCE(read_at, ?)
           WHERE id = ? AND dismissed_at IS NULL`,
        )
        .run(Date.now(), Date.now(), id);
      if (result.changes > 0) {
        bb.realtime.publish("notifications", {
          type: "dismiss",
          id,
          targetKind: existing?.target_kind ?? null,
          targetId: existing?.target_id ?? null,
        });
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
    getUnreadCount: () => {
      const unreadCount = (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM notifications
             WHERE read_at IS NULL AND dismissed_at IS NULL`,
          )
          .get() as { c: number }
      ).c;
      return { unreadCount };
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
    async getVapidPublicKey() {
      const keys = await ensureVapidKeys();
      return { publicKey: keys.publicKey };
    },
    subscribePush(input) {
      const { created } = upsertPushSubscription(db, {
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      });
      return { ok: true as const, created };
    },
    unsubscribePush({ endpoint }) {
      return { ok: deletePushSubscription(db, endpoint) };
    },
    async getMuteConfig() {
      const mutedLabels = await readMutedLabels();
      const labelsPro = await fetchLabelsProSnapshot(mutedLabels);
      const mutedKeys = new Set(mutedLabels);
      const suggestedLabels = suggestedMuteLabels({
        mutedKeys,
        autoTagEnabled: labelsPro.autoTagEnabled,
        autoTagLabelName: labelsPro.autoTagLabelName,
        existingLabels: labelsPro.labels,
      });
      return {
        mutedLabels,
        suggestedLabels,
        mutedThreadIds: labelsPro.mutedThreadIds,
        labelsPro: {
          available: labelsPro.available,
          error: labelsPro.error,
          labels: labelsPro.labels,
          autoTagEnabled: labelsPro.autoTagEnabled,
          autoTagLabelName: labelsPro.autoTagLabelName,
        },
      };
    },
    async setMutedLabels({ labels }) {
      const mutedLabels = await writeMutedLabels(labels);
      return { mutedLabels };
    },
  });

  void settings.get();

  // Root-scoped service worker: push display + click → thread/task.
  // Path is /api/v1/plugins/<id>/http/sw.js — Service-Worker-Allowed expands scope.
  const SW_SCRIPT = [
    "/* notifications-pro web-push v2 */",
    "self.addEventListener('install', (event) => {",
    "  event.waitUntil(self.skipWaiting());",
    "});",
    "self.addEventListener('activate', (event) => {",
    "  event.waitUntil(self.clients.claim());",
    "});",
    "self.addEventListener('message', (event) => {",
    "  if (event.data && event.data.type === 'np-spike-skip-waiting') {",
    "    self.skipWaiting();",
    "  }",
    "});",
    "self.addEventListener('push', (event) => {",
    "  event.waitUntil((async () => {",
    "    let data = {};",
    "    try { data = event.data ? event.data.json() : {}; } catch (_) {}",
    "    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });",
    "    const visible = clients.some((c) => c.visibilityState === 'visible');",
    "    // Double-alert rule: if any bb window is visible, skip push UI;",
    "    // the open page may show a desktop OS toast instead.",
    "    if (visible) return;",
    "    const title = typeof data.title === 'string' && data.title ? data.title : 'bb';",
    "    const body = typeof data.body === 'string' ? data.body : '';",
    "    const tag = typeof data.notificationId === 'string' && data.notificationId",
    "      ? data.notificationId",
    "      : (typeof data.targetId === 'string' ? data.targetId : 'bb-notifications-pro');",
    "    await self.registration.showNotification(title, {",
    "      body,",
    "      tag,",
    "      data: {",
    "        targetKind: data.targetKind || null,",
    "        targetId: data.targetId || null,",
    "        notificationId: data.notificationId || null,",
    "        href: data.href || '/',",
    "      },",
    "    });",
    "  })());",
    "});",
    "self.addEventListener('notificationclick', (event) => {",
    "  event.notification.close();",
    "  const data = event.notification.data || {};",
    "  const href = typeof data.href === 'string' && data.href ? data.href : '/';",
    "  event.waitUntil((async () => {",
    "    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });",
    "    for (const client of clients) {",
    "      if ('focus' in client) {",
    "        await client.focus();",
    "        if ('navigate' in client && typeof client.navigate === 'function') {",
    "          try { await client.navigate(href); return; } catch (_) {}",
    "        }",
    "        try { client.postMessage({ type: 'np-push-open', href, data }); } catch (_) {}",
    "        return;",
    "      }",
    "    }",
    "    await self.clients.openWindow(href);",
    "  })());",
    "});",
  ].join("\n");

  bb.http.route(
    "GET",
    "/sw.js",
    () =>
      new Response(SW_SCRIPT, {
        status: 200,
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          "Service-Worker-Allowed": "/",
          "Cache-Control": "no-store",
        },
      }),
    // "local" trusts Origin equal to the request host (Tailscale Serve included)
    // and configured BB_APP_URL origins. Do not use "none" for this script.
    { auth: "local" },
  );

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
