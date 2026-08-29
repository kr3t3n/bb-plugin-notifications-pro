import { describe, expect, it } from "vitest";
import { resolveMutedThreadIds } from "./labels-pro";

describe("resolveMutedThreadIds", () => {
  const labels = [
    { id: "l1", name: "automation", slug: "automation", color: null },
    { id: "l2", name: "manual", slug: "manual", color: null },
  ];

  it("uses bulk assignments when present", () => {
    const labelIdsByThreadId = new Map([
      ["thr_a", ["l1"]],
      ["thr_b", ["l2"]],
      ["thr_c", ["l1", "l2"]],
    ]);
    expect(
      resolveMutedThreadIds({
        mutedKeys: new Set(["automation"]),
        labels,
        labelIdsByThreadId,
      }),
    ).toEqual(new Set(["thr_a", "thr_c"]));
  });

  it("falls back to per-key thread id lists", () => {
    const threadIdsByMutedKey = new Map([
      ["automation", ["thr_a", "thr_c"]],
      ["bots", ["thr_d"]],
    ]);
    expect(
      resolveMutedThreadIds({
        mutedKeys: new Set(["automation"]),
        labels,
        threadIdsByMutedKey,
      }),
    ).toEqual(new Set(["thr_a", "thr_c"]));
  });

  it("returns empty when nothing is muted", () => {
    expect(
      resolveMutedThreadIds({
        mutedKeys: new Set(),
        labels,
        threadIdsByMutedKey: new Map([["automation", ["thr_a"]]]),
      }),
    ).toEqual(new Set());
  });
});
