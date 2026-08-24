import { useNotificationEngine } from "./useNotificationEngine";

/**
 * Trailing badge on the Notifications nav row. Also hosts the always-on
 * notification engine on wide viewports (host hides this on compact).
 */
export function SidebarAccessory() {
  const { badgeCount } = useNotificationEngine();
  if (badgeCount <= 0) {
    return <span className="text-xs text-muted-foreground">0</span>;
  }
  const label = badgeCount > 99 ? "99+" : String(badgeCount);
  return (
    <span
      className="text-xs font-medium tabular-nums text-foreground"
      aria-label={`${badgeCount} unread notifications`}
    >
      {label}
    </span>
  );
}
