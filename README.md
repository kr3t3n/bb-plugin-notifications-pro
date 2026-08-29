# Notifications Pro

Standalone BB plugin for desktop notifications, Dock/app badge counts, phone
Web Push (home-screen PWA), and an in-app notification center. Separate from
[Sidebar Pro](https://github.com/kr3t3n/bb-plugin-sidebar-pro). Optional mute
integration with [Labels Pro](https://github.com/kr3t3n/bb-plugin-labels-pro).

## Features

- **Desktop OS notifications** — edge-triggered when a thread newly needs
  attention (unread, waiting for input, unread error, pending interaction).
  Skips the active thread. Click opens the thread.
- **Assigned tasks** — edge-triggered when Tasks Pro assigns a task to you
  (`kind: "me"`). Click opens the task in the Tasks plugin. Toggle separately
  from thread alerts via `sourceAssignedTasks`.
- **Phone web push** — when enabled, the same attention edge sends a Web Push
  to subscribed home-screen devices (iOS 16.4+). Independent of desktop OS
  toasts. Tap opens the thread or task.
- **App / Dock badge** — unread notification count (same as the center) via
  `navigator.setAppBadge` (app icon / browser tab badge). Mark-all-read and
  dismiss clear it.
- **Notification center** — nav panel at Notifications with unread history,
  mark-read, and dismiss. Unread rows sort above read rows; within each group
  newest trigger time first. Thread rows auto-dismiss when that thread leaves
  attention (read / resolved). Mark-read and dismiss both clear that item from
  the nav and Dock badge. **Mark all read** also marks live attention threads
  read and clears the app/tab badge, so bb’s unread/pending favicon attention
  drops with the center.
- **Settings** — enable/disable OS toasts, badge, thread source, assigned-task
  source, and phone web push independently.
- **Mute by Labels Pro label** — choose labels whose threads never raise OS
  toast, web push, or center attention edges. Suggests muting `automation`
  when that label exists (Labels Pro auto-tag). Graceful when Labels Pro is
  missing. Mark-all-read still clears non-muted threads only.

### Labels Pro (optional)

**Contract:** plugin id `labels-pro`, realtime channel `labels`, methods
`listLabels` + `listThreadsByLabel` (see Labels Pro
[docs/rpc-contract.md](https://github.com/kr3t3n/bb-plugin-labels-pro/blob/main/docs/rpc-contract.md)).
Helpers: `src/labels-pro.ts`, `src/muted-labels.ts`, mute UI in
`src/MuteLabelsSettingsPanel.tsx`.

**Graceful fallback:** Labels Pro is **not** required in `engines`
(`bb >= 0.39`, `bbPluginSdk >= 0.4.8` for this plugin). If Labels Pro is
missing or RPC fails, mute-by-label stays off / shows unavailable and thread /
task alerts continue normally. An optional bulk assignment probe may be tried;
when absent, Notifications Pro falls back to per-label `listThreadsByLabel`.

**Sidebar Pro:** inbox filter/chips live in
[Sidebar Pro](https://github.com/kr3t3n/bb-plugin-sidebar-pro); this plugin owns
toasts, badge, center, and mute.

## Double-alert rule

One attention edge creates at most one visible system notification:

- If a bb window is **visible**, the service worker **does not** show the push
  UI. The open page may show a desktop OS toast when `osNotifications` is on.
- If no bb window is visible (phone locked, app backgrounded), Web Push shows
  the alert when `webPush` is on and the device is subscribed.

Turn desktop toasts and phone push on or off separately. Turning **Phone web
push** off removes this device’s subscription on the server.

## Phone setup (iOS)

1. Open bb over HTTPS (for example Tailscale Serve).
2. Safari → Share → **Add to Home Screen**.
3. Open bb from the **home-screen icon** (not the Safari tab).
4. Settings → Notifications Pro → turn on **Phone web push**.
5. Tap **Enable on this device** and allow notifications (once).
   Later launches keep the browser subscription and re-attach it to the
   server automatically. You only need Enable again after Remove, revoke,
   or clearing site data.

## Install

Requires `bb >= 0.39` and `bbPluginSdk >= 0.4.8`. Labels Pro is optional.

```sh
npm install
bb plugin install . --yes
bb plugin reload notifications-pro
```

Also reload Tasks Pro after pulling assignee API changes:

```sh
bb plugin reload task-comment-float
```

Dev loop:

```sh
bb plugin dev
```

## Configure

Settings → Notifications Pro, or:

```sh
bb plugin config notifications-pro
bb plugin config notifications-pro set sourceThreads true
bb plugin config notifications-pro set sourceAssignedTasks true
bb plugin config notifications-pro set osNotifications true
bb plugin config notifications-pro set appBadge true
bb plugin config notifications-pro set webPush true
bb plugin config notifications-pro set mutedLabels "automation"
```

Prefer **Settings → Notifications Pro → Mute labels** for checkboxes. The
`mutedLabels` string is a fallback when editing via CLI; the mute panel writes
the same list through RPC (`setMutedLabels`).

## Manual test (with Labels + Sidebar Pro)

See the shared checklist in the
[Labels Pro README](https://github.com/kr3t3n/bb-plugin-labels-pro#manual-test-checklist-pro-stack):
auto-tag → filter/hide → mark filtered read → muted notifications → header edit.

## Layout

- `server.ts` — settings, SQLite log + push subscriptions, VAPID, RPC, SW route
- `app.tsx` — nav panel + settings sections
- `src/attention.ts` — thread attention helpers
- `src/assigned-tasks.ts` — assigned-task helpers + Tasks deep link
- `src/muted-labels.ts` — mute-list parse / match helpers
- `src/labels-pro.ts` — Labels Pro consumer schemas + muted-thread resolution
- `src/MuteLabelsSettingsPanel.tsx` — mute-label checkboxes + automation suggest
- `src/desktop-alerts.ts` — `Notification` + Badging API
- `src/push-client.ts` — VAPID subscribe / unsubscribe helpers
- `src/web-push-backend.ts` — subscription store + send/prune
- `src/useNotificationEngine.ts` — edge watcher + badge sync (push hangs off `record`)
- `src/NotificationCenter.tsx` — in-app center UI
- `src/SidebarAccessory.tsx` — unread count on the nav row
