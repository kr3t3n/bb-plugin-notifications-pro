import { describe, expect, it } from "vitest";
import {
  RESPONSE_PREVIEW_MAX_CHARS,
  formatResponsePreview,
} from "./response-preview";

describe("formatResponsePreview", () => {
  it("returns null for empty input", () => {
    expect(formatResponsePreview(null)).toBeNull();
    expect(formatResponsePreview("   ")).toBeNull();
  });

  it("strips markdown and collapses whitespace", () => {
    expect(
      formatResponsePreview("# Title\n\n**Done.** Run `npm test`."),
    ).toBe("Title Done. Run npm test.");
  });

  it("truncates long text", () => {
    const long = "word ".repeat(40).trim();
    const preview = formatResponsePreview(long);
    expect(preview).not.toBeNull();
    expect(preview!.length).toBeLessThanOrEqual(RESPONSE_PREVIEW_MAX_CHARS);
    expect(preview!.endsWith("…")).toBe(true);
  });
});
