import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  readSwSpikeStatus,
  registerRootScopedServiceWorker,
  type SwSpikeStatus,
} from "./sw-spike";

const PLUGIN_ID = "notifications-pro";

/**
 * NP-9 spike UI: show whether root-scoped SW registration succeeded.
 * Needed on iOS where Application/DevTools panels are unavailable.
 */
export function SwSpikeStatusPanel() {
  const [status, setStatus] = useState<SwSpikeStatus | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      setStatus(await readSwSpikeStatus(PLUGIN_ID));
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    setBusy(true);
    try {
      setStatus(await registerRootScopedServiceWorker(PLUGIN_ID));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Spike success = root scope + our worker active. Controller may stay null
  // on iOS until the home-screen app is fully closed and reopened.
  const ok = status?.rootScoped === true && !status.error;

  return (
    <div className="space-y-3 text-sm text-muted-foreground">
      <p>
        Spike NP-9: register a service worker from the plugin HTTP route with
        scope <code className="text-foreground">/</code>.
      </p>
      <div className="rounded-md border border-border bg-muted/30 p-3 font-mono text-xs text-foreground space-y-1">
        <div>
          result:{" "}
          <span className={ok ? "text-green-600 dark:text-green-400" : ""}>
            {status == null
              ? "…"
              : ok
                ? "YES — root-scoped worker active"
                : "NO / pending"}
          </span>
        </div>
        <div>supported: {String(status?.supported ?? "…")}</div>
        <div>scope: {status?.registrationScope ?? "—"}</div>
        <div className="break-all">active: {status?.activeUrl ?? "—"}</div>
        <div className="break-all">
          controller: {status?.controllerUrl ?? "—"}
        </div>
        <div>rootScoped: {String(status?.rootScoped ?? "…")}</div>
        <div>controlling: {String(status?.controlling ?? "…")}</div>
        {status?.error ? (
          <div className="text-destructive break-all">error: {status.error}</div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void register()}>
          Register root SW
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()}>
          Refresh status
        </Button>
      </div>
      {ok && !status?.controlling ? (
        <p>
          Registered. Fully close the home-screen app and reopen it if
          controlling stays false.
        </p>
      ) : null}
    </div>
  );
}
