# Notifications Pro

Standalone BB plugin for desktop notifications, Dock/app badge counts, and an
in-app notification center. Separate from Sidebar Pro.

## Features

- **Desktop OS notifications** — edge-triggered when a thread newly needs
  attention (unread, waiting for input, unread error, pending interaction).
  Skips the active thread. Click opens the thread.
- **Assigned tasks** — edge-triggered when Tasks Pro assigns a task to you
  (`kind: "me"`). Click opens the task in the Tasks plugin. Toggle separately
  from thread alerts via `sourceAssignedTasks`.
- **App / Dock badge** — unread notification count (same as the center) via
  `navigator.setAppBadge`. Mark-all-read and dismiss clear it.
- **Notification center** — nav panel at Notifications with unread history,
  mark-read, and dismiss. Unread rows sort above read rows; within each group
  newest trigger time first. Thread rows auto-dismiss when that thread leaves
  attention (read / resolved). Mark-read and dismiss both clear that item from
  the nav and Dock badge, and mark the underlying thread read so the Sidebar
  Pro bell drops too.
- **Settings** — enable/disable OS toasts, badge, thread source, and assigned-
  task source independently.

## Install

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
```

## Layout

- `server.ts` — settings, SQLite notification log, RPC (incl. Tasks Pro proxy)
- `app.tsx` — nav panel + settings section
- `src/attention.ts` — thread attention helpers
- `src/assigned-tasks.ts` — assigned-task helpers + Tasks deep link
- `src/desktop-alerts.ts` — `Notification` + Badging API
- `src/useNotificationEngine.ts` — edge watcher + badge sync
- `src/NotificationCenter.tsx` — in-app center UI
- `src/SidebarAccessory.tsx` — unread count on the nav row

## Follow-ups

None open for the core notification path.