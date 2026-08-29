/**
 * Mute-by-label helpers for Notifications Pro (NOTIF-1).
 *
 * Muted label keys are compared case-insensitively against Labels Pro
 * `name` and `slug`. Threads that carry any muted label skip OS toast,
 * web push (via skipped `record`), and center attention edges.
 */

export const DEFAULT_AUTOMATION_LABEL = "automation";

/** Normalize a label name or slug for set membership. */
export function normalizeLabelKey(value: string): string {
  return value.trim().toLowerCase();
}

/** Parse a comma / newline / whitespace-separated mute list. */
export function parseMutedLabels(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const keys = new Set<string>();
    for (const entry of raw) {
      if (typeof entry !== "string") continue;
      const key = normalizeLabelKey(entry);
      if (key) keys.add(key);
    }
    return [...keys].sort();
  }
  if (typeof raw !== "string") return [];
  const keys = new Set<string>();
  for (const part of raw.split(/[\n,]+/)) {
    const key = normalizeLabelKey(part);
    if (key) keys.add(key);
  }
  return [...keys].sort();
}

export function serializeMutedLabels(labels: readonly string[]): string[] {
  return parseMutedLabels([...labels]);
}

export type LabelRef = {
  id: string;
  name: string;
  slug?: string | null;
};

/** True when any of the thread's labels matches a muted key (name or slug). */
export function labelsMatchMute(
  threadLabels: readonly LabelRef[],
  mutedKeys: ReadonlySet<string>,
): boolean {
  if (mutedKeys.size === 0 || threadLabels.length === 0) return false;
  for (const label of threadLabels) {
    const nameKey = normalizeLabelKey(label.name);
    if (nameKey && mutedKeys.has(nameKey)) return true;
    if (typeof label.slug === "string") {
      const slugKey = normalizeLabelKey(label.slug);
      if (slugKey && mutedKeys.has(slugKey)) return true;
    }
  }
  return false;
}

/**
 * Build the set of thread ids that should stay silent given muted keys and
 * a Labels Pro assignment map (threadId → label refs).
 */
export function collectMutedThreadIds(args: {
  mutedKeys: ReadonlySet<string>;
  labelsByThreadId: ReadonlyMap<string, readonly LabelRef[]>;
}): Set<string> {
  const muted = new Set<string>();
  if (args.mutedKeys.size === 0) return muted;
  for (const [threadId, labels] of args.labelsByThreadId) {
    if (labelsMatchMute(labels, args.mutedKeys)) muted.add(threadId);
  }
  return muted;
}

/**
 * Suggest muting `automation` when Labels Pro auto-tag is on (or the
 * automation label already exists) and it is not already muted.
 */
export function suggestedMuteLabels(args: {
  mutedKeys: ReadonlySet<string>;
  autoTagEnabled: boolean;
  autoTagLabelName: string;
  existingLabels: readonly LabelRef[];
}): string[] {
  const suggestions: string[] = [];
  const autoName = normalizeLabelKey(args.autoTagLabelName);
  if (!autoName) return suggestions;

  const autoExists = args.existingLabels.some((label) => {
    if (normalizeLabelKey(label.name) === autoName) return true;
    if (
      typeof label.slug === "string" &&
      normalizeLabelKey(label.slug) === autoName
    ) {
      return true;
    }
    return false;
  });

  if ((args.autoTagEnabled || autoExists) && !args.mutedKeys.has(autoName)) {
    suggestions.push(autoName);
  }
  return suggestions;
}

/** True when this thread id is in the muted set. */
export function threadIdIsMuted(
  threadId: string,
  mutedThreadIds: ReadonlySet<string> | null | undefined,
): boolean {
  if (!mutedThreadIds || mutedThreadIds.size === 0) return false;
  return mutedThreadIds.has(threadId);
}
