// bb-plugin-notifications-pro — frontend entry.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { NotificationCenter } from "./src/NotificationCenter";
import { SidebarAccessory } from "./src/SidebarAccessory";
import { SettingsExtras } from "./src/SettingsExtras";

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
});
