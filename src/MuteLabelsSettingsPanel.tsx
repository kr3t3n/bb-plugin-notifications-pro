import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { Button } from "@/components/ui/button";

type MuteConfig = Awaited<
  ReturnType<
    ReturnType<typeof useRpc<typeof rpcContract>>["call"]
  > extends (...args: infer _A) => infer _R
    ? never
    : never
>;

type MuteConfigResult = {
  mutedLabels: string[];
  suggestedLabels: string[];
  mutedThreadIds: string[];
  labelsPro: {
    available: boolean;
    error: string | null;
    labels: Array<{
      id: string;
      name: string;
      slug: string;
      color: string | null;
    }>;
    autoTagEnabled: boolean;
    autoTagLabelName: string;
  };
};

/**
 * Choose Labels Pro labels whose threads never raise OS toast / web push /
 * center attention edges. Graceful when Labels Pro is missing.
 */
export function MuteLabelsSettingsPanel() {
  const rpc = useRpc<typeof rpcContract>();
  const [config, setConfig] = useState<MuteConfigResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = (await rpc.call(
        "getMuteConfig",
        null,
      )) as MuteConfigResult;
      setConfig(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load mute config");
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useRealtime("notifications", (event) => {
    const payload = event as { type?: string };
    if (payload?.type === "mute-labels-changed") {
      void refresh();
    }
  });

  const muted = new Set(config?.mutedLabels ?? []);

  const save = async (next: string[]) => {
    setBusy(true);
    try {
      await rpc.call("setMutedLabels", { labels: next });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: string) => {
    const next = new Set(muted);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    void save([...next]);
  };

  const applySuggestions = () => {
    if (!config) return;
    const next = new Set(muted);
    for (const label of config.suggestedLabels) next.add(label);
    void save([...next]);
  };

  if (!config) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>Loading mute labels…</p>
        {error ? <p className="text-destructive">{error}</p> : null}
      </div>
    );
  }

  const { labelsPro, suggestedLabels } = config;

  if (!labelsPro.available) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>
          Labels Pro is not installed or not running. Mute-by-label stays off
          until it is available. You can still keep a mute list for later.
        </p>
        {labelsPro.error ? (
          <p className="font-mono text-xs">{labelsPro.error}</p>
        ) : null}
        {muted.size > 0 ? (
          <p>
            Saved mute list:{" "}
            <span className="text-foreground">{[...muted].join(", ")}</span>
          </p>
        ) : null}
        {error ? <p className="text-destructive">{error}</p> : null}
      </div>
    );
  }

  const labels = labelsPro.labels;
  // Include muted keys that are not in the current label catalog yet.
  const extraMuted = [...muted].filter(
    (key) =>
      !labels.some(
        (label) =>
          label.name.toLowerCase() === key || label.slug.toLowerCase() === key,
      ),
  );

  return (
    <div className="space-y-3 text-sm text-muted-foreground">
      <p>
        Threads with a checked label never raise desktop toasts, phone push, or
        notification-center attention edges. Mark-all-read still clears
        non-muted threads.
      </p>

      {suggestedLabels.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
          <span className="text-foreground">
            Suggest muting{" "}
            <span className="font-medium">{suggestedLabels.join(", ")}</span>
            {labelsPro.autoTagEnabled
              ? " (Labels Pro auto-tag)."
              : " (automation label present)."}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => applySuggestions()}
          >
            Mute suggested
          </Button>
        </div>
      ) : null}

      {labels.length === 0 ? (
        <p>No Labels Pro labels yet. Create some in Labels Pro, then refresh.</p>
      ) : (
        <ul className="space-y-1">
          {labels.map((label) => {
            const key = label.slug || label.name.toLowerCase();
            const checked =
              muted.has(key) || muted.has(label.name.toLowerCase());
            return (
              <li key={label.id}>
                <label className="flex cursor-pointer items-center gap-2 text-foreground">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={checked}
                    disabled={busy}
                    onChange={() => toggle(key)}
                  />
                  <span>{label.name}</span>
                  {label.slug !== label.name.toLowerCase() ? (
                    <span className="text-xs text-muted-foreground">
                      ({label.slug})
                    </span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {extraMuted.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs">Also muted (not in catalog):</p>
          <ul className="space-y-1">
            {extraMuted.map((key) => (
              <li key={key}>
                <label className="flex cursor-pointer items-center gap-2 text-foreground">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked
                    disabled={busy}
                    onChange={() => toggle(key)}
                  />
                  <span>{key}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="text-destructive">{error}</p> : null}
    </div>
  );
}

// Keep the unused type alias from confusing tsc when useRpc generics shift.
void 0 as unknown as MuteConfig;
