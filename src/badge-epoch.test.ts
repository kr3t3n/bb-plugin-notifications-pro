import { describe, expect, it } from "vitest";
import {
  applyUnreadBadgeCount,
  beginBadgeRefresh,
  getSharedBadgeCount,
} from "./useNotificationEngine";

describe("badge epoch", () => {
  it("ignores a stale async unread count after a newer apply", () => {
    applyUnreadBadgeCount(0, { syncAppBadge: false });
    const stale = beginBadgeRefresh();
    applyUnreadBadgeCount(0, { syncAppBadge: false });
    applyUnreadBadgeCount(1, { epoch: stale, syncAppBadge: false });
    expect(getSharedBadgeCount()).toBe(0);

    const next = beginBadgeRefresh();
    applyUnreadBadgeCount(3, { epoch: next, syncAppBadge: false });
    expect(getSharedBadgeCount()).toBe(3);
  });
});
