import { describe, expect, it } from "vitest";
import {
  collectMutedThreadIds,
  DEFAULT_AUTOMATION_LABEL,
  labelsMatchMute,
  normalizeLabelKey,
  parseMutedLabels,
  serializeMutedLabels,
  suggestedMuteLabels,
  threadIdIsMuted,
} from "./muted-labels";

describe("parseMutedLabels", () => {
  it("splits commas and newlines", () => {
    expect(parseMutedLabels("automation, bots\nquiet")).toEqual([
      "automation",
      "bots",
      "quiet",
    ]);
  });

  it("dedupes case-insensitively", () => {
    expect(parseMutedLabels("Automation, automation, AUTOMATION")).toEqual([
      "automation",
    ]);
  });

  it("accepts string arrays", () => {
    expect(parseMutedLabels(["  Bots ", "bots", ""])).toEqual(["bots"]);
  });

  it("returns empty for junk", () => {
    expect(parseMutedLabels(null)).toEqual([]);
    expect(parseMutedLabels(42)).toEqual([]);
  });
});

describe("serializeMutedLabels", () => {
  it("normalizes and sorts", () => {
    expect(serializeMutedLabels(["Zed", " automation "])).toEqual([
      "automation",
      "zed",
    ]);
  });
});

describe("labelsMatchMute", () => {
  it("matches by name or slug", () => {
    const muted = new Set(["automation"]);
    expect(
      labelsMatchMute([{ id: "1", name: "Automation", slug: "automation" }], muted),
    ).toBe(true);
    expect(
      labelsMatchMute([{ id: "1", name: "Ops", slug: "automation" }], muted),
    ).toBe(true);
    expect(
      labelsMatchMute([{ id: "1", name: "manual", slug: "manual" }], muted),
    ).toBe(false);
  });
});

describe("collectMutedThreadIds", () => {
  it("unions threads that carry any muted label", () => {
    const labelsByThreadId = new Map([
      ["thr_a", [{ id: "1", name: "automation", slug: "automation" }]],
      ["thr_b", [{ id: "2", name: "manual", slug: "manual" }]],
      [
        "thr_c",
        [
          { id: "2", name: "manual", slug: "manual" },
          { id: "1", name: "automation", slug: "automation" },
        ],
      ],
    ]);
    expect(
      collectMutedThreadIds({
        mutedKeys: new Set(["automation"]),
        labelsByThreadId,
      }),
    ).toEqual(new Set(["thr_a", "thr_c"]));
  });
});

describe("suggestedMuteLabels", () => {
  it("suggests automation when auto-tag is on", () => {
    expect(
      suggestedMuteLabels({
        mutedKeys: new Set(),
        autoTagEnabled: true,
        autoTagLabelName: DEFAULT_AUTOMATION_LABEL,
        existingLabels: [],
      }),
    ).toEqual(["automation"]);
  });

  it("suggests when the automation label already exists", () => {
    expect(
      suggestedMuteLabels({
        mutedKeys: new Set(),
        autoTagEnabled: false,
        autoTagLabelName: DEFAULT_AUTOMATION_LABEL,
        existingLabels: [
          { id: "1", name: "automation", slug: "automation" },
        ],
      }),
    ).toEqual(["automation"]);
  });

  it("skips when already muted", () => {
    expect(
      suggestedMuteLabels({
        mutedKeys: new Set(["automation"]),
        autoTagEnabled: true,
        autoTagLabelName: DEFAULT_AUTOMATION_LABEL,
        existingLabels: [
          { id: "1", name: "automation", slug: "automation" },
        ],
      }),
    ).toEqual([]);
  });
});

describe("threadIdIsMuted", () => {
  it("is false for empty sets", () => {
    expect(threadIdIsMuted("thr_1", null)).toBe(false);
    expect(threadIdIsMuted("thr_1", new Set())).toBe(false);
  });

  it("checks membership", () => {
    expect(threadIdIsMuted("thr_1", new Set(["thr_1"]))).toBe(true);
    expect(threadIdIsMuted("thr_2", new Set(["thr_1"]))).toBe(false);
  });
});

describe("normalizeLabelKey", () => {
  it("trims and lowercases", () => {
    expect(normalizeLabelKey("  Auto ")).toBe("auto");
  });
});
