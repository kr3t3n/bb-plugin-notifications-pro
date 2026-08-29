/**
 * Labels Pro consumer helpers for Notifications Pro.
 *
 * Canonical methods live in Labels Pro `src/rpc-contract.ts`.
 * An optional bulk `listAssignments` may exist in future; we try that
 * first and fall back to per-muted-label `listThreadsByLabel`.
 */

import { z } from "zod";
import {
  DEFAULT_AUTOMATION_LABEL,
  type LabelRef,
  normalizeLabelKey,
} from "./muted-labels";

export const LABELS_PRO_PLUGIN_ID = "labels-pro";
export const LABELS_PRO_REALTIME_CHANNEL = "labels";

export const labelsProLabelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string().optional(),
    color: z.string().nullable().optional(),
    createdAt: z.number().int().optional(),
    updatedAt: z.number().int().optional(),
  })
  .passthrough();

export const listLabelsOut = z
  .object({
    labels: z.array(labelsProLabelSchema),
  })
  .strict();

export const listThreadsByLabelOut = z
  .object({
    label: labelsProLabelSchema.nullable(),
    threadIds: z.array(z.string()),
  })
  .strict();

/** Optional bulk map; not part of the stable Labels Pro contract today. */
export const listAssignmentsOut = z
  .object({
    assignments: z.array(
      z
        .object({
          threadId: z.string(),
          labelIds: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();

export type LabelsProLabel = z.infer<typeof labelsProLabelSchema>;

export function toLabelRef(label: LabelsProLabel): LabelRef {
  return {
    id: label.id,
    name: label.name,
    slug: label.slug ?? normalizeLabelKey(label.name),
  };
}

/**
 * Resolve muted thread ids given Labels Pro outputs.
 * Prefers bulk assignments when present; otherwise unions
 * `listThreadsByLabel` results keyed by muted name.
 */
export function resolveMutedThreadIds(args: {
  mutedKeys: ReadonlySet<string>;
  labels: readonly LabelsProLabel[];
  /** threadId → label ids from listAssignments, if available. */
  labelIdsByThreadId?: ReadonlyMap<string, readonly string[]>;
  /** label key (name/slug normalized) → thread ids from listThreadsByLabel. */
  threadIdsByMutedKey?: ReadonlyMap<string, readonly string[]>;
}): Set<string> {
  const muted = new Set<string>();
  if (args.mutedKeys.size === 0) return muted;

  if (args.labelIdsByThreadId && args.labelIdsByThreadId.size > 0) {
    const idToKeys = new Map<string, Set<string>>();
    for (const label of args.labels) {
      const keys = new Set<string>();
      const nameKey = normalizeLabelKey(label.name);
      if (nameKey) keys.add(nameKey);
      if (typeof label.slug === "string") {
        const slugKey = normalizeLabelKey(label.slug);
        if (slugKey) keys.add(slugKey);
      }
      idToKeys.set(label.id, keys);
    }
    for (const [threadId, labelIds] of args.labelIdsByThreadId) {
      for (const labelId of labelIds) {
        const keys = idToKeys.get(labelId);
        if (!keys) continue;
        for (const key of keys) {
          if (args.mutedKeys.has(key)) {
            muted.add(threadId);
            break;
          }
        }
        if (muted.has(threadId)) break;
      }
    }
    return muted;
  }

  if (args.threadIdsByMutedKey) {
    for (const key of args.mutedKeys) {
      const ids = args.threadIdsByMutedKey.get(key);
      if (!ids) continue;
      for (const id of ids) muted.add(id);
    }
  }
  return muted;
}

export function defaultAutoTagLabelName(): string {
  return DEFAULT_AUTOMATION_LABEL;
}
