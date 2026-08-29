import { describe, expect, it } from "vitest";
import { pushTargetHref, urlBase64ToUint8Array } from "./push-client";

describe("urlBase64ToUint8Array", () => {
  it("decodes a URL-safe base64 key without throwing", () => {
    // Minimal valid-looking VAPID public key shape (padding handled).
    const bytes = urlBase64ToUint8Array("AQID");
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});

describe("pushTargetHref", () => {
  it("builds thread and task deep links", () => {
    expect(pushTargetHref({ targetKind: "thread", targetId: "thr_1" })).toBe(
      "/threads/thr_1",
    );
    expect(pushTargetHref({ targetKind: "task", targetId: "NP-2" })).toBe(
      "/plugins/tasks/tasks/task/NP-2",
    );
    expect(pushTargetHref({ targetKind: "thread", targetId: "" })).toBe("/");
  });
});
