/**
 * Web Push helpers for Notifications Pro (NP-10).
 * VAPID private key must never be logged or returned from RPC.
 */

export type PushSubscriptionKeys = {
  p256dh: string;
  auth: string;
};

export type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: number;
  updatedAt: number;
};

export type PushPayload = {
  title: string;
  body: string;
  targetKind: "thread" | "task";
  targetId: string;
  notificationId: string;
};

export type VapidKeyPair = {
  publicKey: string;
  privateKey: string;
};

/** Minimal DB surface used by the push subscription store (better-sqlite3). */
export type PushSubscriptionDb = {
  prepare: (sql: string) => {
    get: (...params: any[]) => any;
    all: (...params: any[]) => any[];
    run: (...params: any[]) => { changes: number };
  };
};

export type PushSendError = {
  statusCode?: number;
  message?: string;
};

export type PushSender = (
  subscription: {
    endpoint: string;
    keys: PushSubscriptionKeys;
  },
  payload: string,
) => Promise<void>;

export function isDeadPushStatus(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}

export function pushErrorStatusCode(error: unknown): number | undefined {
  if (error && typeof error === "object" && "statusCode" in error) {
    const code = (error as PushSendError).statusCode;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}

export function upsertPushSubscription(
  db: PushSubscriptionDb,
  input: { endpoint: string; p256dh: string; auth: string },
  now = Date.now(),
): { created: boolean; row: PushSubscriptionRow } {
  const existing = db
    .prepare(`SELECT endpoint FROM push_subscriptions WHERE endpoint = ?`)
    .get(input.endpoint) as { endpoint: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE push_subscriptions
       SET p256dh = ?, auth = ?, updated_at = ?
       WHERE endpoint = ?`,
    ).run(input.p256dh, input.auth, now, input.endpoint);
    const updated = db
      .prepare(
        `SELECT endpoint, p256dh, auth, created_at, updated_at
         FROM push_subscriptions WHERE endpoint = ?`,
      )
      .get(input.endpoint) as {
      endpoint: string;
      p256dh: string;
      auth: string;
      created_at: number;
      updated_at: number;
    };
    return {
      created: false,
      row: {
        endpoint: updated.endpoint,
        p256dh: updated.p256dh,
        auth: updated.auth,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      },
    };
  }

  db.prepare(
    `INSERT INTO push_subscriptions
      (endpoint, p256dh, auth, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(input.endpoint, input.p256dh, input.auth, now, now);

  return {
    created: true,
    row: {
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      createdAt: now,
      updatedAt: now,
    },
  };
}

export function deletePushSubscription(
  db: PushSubscriptionDb,
  endpoint: string,
): boolean {
  const result = db
    .prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`)
    .run(endpoint);
  return result.changes > 0;
}

export function listPushSubscriptions(
  db: PushSubscriptionDb,
): PushSubscriptionRow[] {
  const rows = db
    .prepare(
      `SELECT endpoint, p256dh, auth, created_at, updated_at
       FROM push_subscriptions
       ORDER BY created_at ASC`,
    )
    .all() as Array<{
    endpoint: string;
    p256dh: string;
    auth: string;
    created_at: number;
    updated_at: number;
  }>;

  return rows.map((row) => ({
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function buildPushPayloadJson(payload: PushPayload): string {
  return JSON.stringify({
    title: payload.title,
    body: payload.body,
    targetKind: payload.targetKind,
    targetId: payload.targetId,
    notificationId: payload.notificationId,
  });
}

/**
 * Send to every stored subscription. Dead endpoints (404/410) are pruned.
 * Other send failures are counted and do not throw.
 */
export async function sendPushToSubscriptions(args: {
  subscriptions: readonly PushSubscriptionRow[];
  payload: PushPayload;
  send: PushSender;
  deleteEndpoint: (endpoint: string) => void;
}): Promise<{ sent: number; pruned: number; failed: number }> {
  const body = buildPushPayloadJson(args.payload);
  let sent = 0;
  let pruned = 0;
  let failed = 0;

  for (const row of args.subscriptions) {
    try {
      await args.send(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        body,
      );
      sent += 1;
    } catch (error) {
      const statusCode = pushErrorStatusCode(error);
      if (isDeadPushStatus(statusCode)) {
        args.deleteEndpoint(row.endpoint);
        pruned += 1;
      } else {
        failed += 1;
      }
    }
  }

  return { sent, pruned, failed };
}
