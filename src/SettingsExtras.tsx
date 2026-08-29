import { useSettings } from "@get-bb/plugin-sdk/app";
import { ensureNotificationPermission, notificationPermission } from "./desktop-alerts";
import { Button } from "@/components/ui/button";

/**
 * Extra settings UI under the host-rendered declarative toggles.
 * Asks for OS permission when the user enables desktop notifications.
 */
export function SettingsExtras() {
  const settings = useSettings();
  const osOn = (settings.values?.osNotifications as boolean | undefined) ?? true;
  const permission = notificationPermission();

  return (
    <div className="space-y-3 text-sm text-muted-foreground">
      <p>
        Toggle sources above. Thread attention uses the live sidebar feed.
        Assigned-task alerts poll Tasks Pro for `kind: me` assignees. Mute
        labels (below) silence Labels Pro-tagged threads.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span>
          OS permission:{" "}
          <span className="text-foreground">{permission}</span>
        </span>
        {osOn && permission !== "granted" && permission !== "unsupported" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void ensureNotificationPermission();
            }}
          >
            Request permission
          </Button>
        ) : null}
      </div>
    </div>
  );
}
