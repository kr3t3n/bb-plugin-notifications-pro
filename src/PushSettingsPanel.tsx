import { useEffect, useRef, useState } from "react";
import { useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { Button } from "@/components/ui/button";
import { notificationPermission } from "./desktop-alerts";
import {
  disableWebPushOnThisDevice,
  enableWebPushOnThisDevice,
  reconcileExistingPushSubscription,
  storedPushEndpoint,
} from "./push-client";

const PLUGIN_ID = "notifications-pro";

/**
 * Phone web-push controls. iOS only prompts from a user gesture in the
 * home-screen PWA — once. Later launches reconcile the existing subscription.
 */
export function PushSettingsPanel() {
  const settings = useSettings();
  const rpc = useRpc<typeof rpcContract>();
  const pushOn = (settings.values?.webPush as boolean | undefined) ?? false;
  const settingsReady = settings.isLoading !== true;
  const [busy, setBusy] = useState(false);
  const [endpoint, setEndpoint] = useState<string | null>(() =>
    storedPushEndpoint(),
  );
  const [message, setMessage] = useState<string | null>(null);
  const permission = notificationPermission();
  const prevPushOn = useRef<boolean | null>(null);

  // Restore an existing browser subscription after settings load (no prompt).
  useEffect(() => {
    if (!settingsReady || !pushOn) return;
    void (async () => {
      const restored = await reconcileExistingPushSubscription({ rpc });
      if (restored) setEndpoint(restored);
    })();
  }, [settingsReady, pushOn, rpc]);

  // Only remove when the user turns the toggle off after settings are ready.
  // Do not treat the loading default (false) as an explicit off — that wiped
  // subscriptions on every home-screen cold start.
  useEffect(() => {
    if (!settingsReady) return;
    const was = prevPushOn.current;
    prevPushOn.current = pushOn;
    if (was === null) return;
    if (was === true && pushOn === false) {
      void (async () => {
        await disableWebPushOnThisDevice({ rpc });
        setEndpoint(null);
        setMessage("Push subscription removed (toggle off).");
      })();
    }
  }, [settingsReady, pushOn, rpc]);

  async function onEnable() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await enableWebPushOnThisDevice({ pluginId: PLUGIN_ID, rpc });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setEndpoint(result.endpoint);
      setMessage(
        result.created
          ? "This device is subscribed for web push."
          : "This device subscription was refreshed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onDisable() {
    setBusy(true);
    setMessage(null);
    try {
      await disableWebPushOnThisDevice({ rpc });
      setEndpoint(null);
      setMessage("This device unsubscribed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm text-muted-foreground">
      <p>
        Enable once from the home-screen app. Later launches keep the same
        subscription; you should not need to tap Enable again.
      </p>
      <div className="font-mono text-xs text-foreground space-y-1">
        <div>
          permission: <span>{permission}</span>
        </div>
        <div>
          subscribed:{" "}
          <span>{endpoint ? "yes" : "no"}</span>
        </div>
        {endpoint ? (
          <div className="break-all text-muted-foreground">
            endpoint: {endpoint.slice(0, 48)}…
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !pushOn}
          onClick={() => void onEnable()}
        >
          Enable on this device
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !endpoint}
          onClick={() => void onDisable()}
        >
          Remove this device
        </Button>
      </div>
      {!pushOn ? (
        <p>Turn on “Phone web push” above, then tap Enable on this device.</p>
      ) : null}
      {message ? <p className="text-foreground">{message}</p> : null}
    </div>
  );
}
