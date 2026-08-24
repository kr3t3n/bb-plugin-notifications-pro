export const RESPONSE_PREVIEW_MAX_CHARS = 140;

/** Plain-text snippet of the latest agent message for toasts and the center. */
export function formatResponsePreview(
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  let normalized = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  if (normalized.length <= RESPONSE_PREVIEW_MAX_CHARS) return normalized;
  return `${normalized.slice(0, RESPONSE_PREVIEW_MAX_CHARS - 1).trimEnd()}…`;
}
