/** One Tasks Pro row assigned to the human operator (`kind: "me"`). */
export type AssignedTask = {
  taskId: string;
  key: string;
  title: string;
  status: string;
  assignedAt: string;
};

export function assignedTaskNotificationId(task: AssignedTask): string {
  return `assigned_task:${task.taskId}:${task.assignedAt}`;
}

export function assignedTaskNotificationTitle(task: AssignedTask): string {
  const title = task.title.trim();
  return title ? title : task.key;
}

export function assignedTaskNotificationBody(task: AssignedTask): string {
  return `Assigned to you · ${task.key}`;
}

/** Tasks plugin nav deep link for a task key (e.g. NP-2). */
export function tasksPluginTaskHref(taskKey: string): string {
  const key = taskKey.trim();
  return `/plugins/tasks/tasks/task/${encodeURIComponent(key)}`;
}

export function openTasksPluginTask(taskKey: string): void {
  if (typeof window === "undefined") return;
  const href = tasksPluginTaskHref(taskKey);
  try {
    window.location.assign(href);
  } catch {
    window.location.href = href;
  }
}

/** Edge-detect task ids that newly appear in the assigned-to-me set. */
export function newlyAssignedTasks(
  current: readonly AssignedTask[],
  previousIds: ReadonlySet<string> | null,
): AssignedTask[] {
  if (previousIds === null) return [];
  const out: AssignedTask[] = [];
  for (const task of current) {
    if (!previousIds.has(task.taskId)) out.push(task);
  }
  return out;
}
