// bb-plugin-notifications-pro — frontend entry.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { NotificationCenter } from "./src/NotificationCenter";
import { SidebarAccessory } from "./src/SidebarAccessory";
import { SettingsExtras } from "./src/SettingsExtras";
import { PushSettingsPanel } from "./src/PushSettingsPanel";
import { MuteLabelsSettingsPanel } from "./src/MuteLabelsSettingsPanel";
import {
  callNotificationsProRpc,
  reconcileExistingPushSubscription,
  type PushSubscribeRpc,
} from "./src/push-client";
import { registerRootScopedServiceWorker } from "./src/sw-spike";

function contentScriptRpc(): PushSubscribeRpc {
  return {
    call(method, input) {
      return callNotificationsProRpc(method, input);
    },
  } as PushSubscribeRpc;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "center",
    title: "Notifications",
    icon: "./assets/icon.svg",
    path: "center",
    component: NotificationCenter,
    experimental_sidebarAccessory: SidebarAccessory,
  });

  app.slots.settingsSection({
    id: "permission",
    title: "Desktop permission",
    description: "Grant the browser permission used for OS toasts.",
    component: SettingsExtras,
  });

  app.slots.settingsSection({
    id: "mute-labels",
    title: "Mute labels",
    description:
      "Silence OS toast, web push, and center edges for threads with selected Labels Pro labels.",
    component: MuteLabelsSettingsPanel,
  });

  app.slots.settingsSection({
    id: "web-push",
    title: "Phone web push",
    description:
      "Subscribe this home-screen device after enabling the Phone web push toggle.",
    component: PushSettingsPanel,
  });

  // Register SW and re-upsert an existing PushSubscription on every launch.
  app.contentScripts.register({
    id: "sw-register",
    mount({ pluginId, signal }) {
      void (async () => {
        const status = await registerRootScopedServiceWorker(pluginId);
        if (signal.aborted) return;
        if (status.error) {
          console.warn("[notifications-pro] SW register failed", status);
        }
        const endpoint = await reconcileExistingPushSubscription({
          rpc: contentScriptRpc(),
        });
        if (signal.aborted) return;
        if (endpoint) {
          console.info("[notifications-pro] push subscription reconciled");
        }
      })();
    },
  });
});
