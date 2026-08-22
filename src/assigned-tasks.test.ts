import { describe, expect, it } from "vitest";
import {
  assignedTaskNotificationBody,
  assignedTaskNotificationId,
  assignedTaskNotificationTitle,
  newlyAssignedTasks,
  tasksPluginTaskHref,
  type AssignedTask,
} from "./assigned-tasks";

function task(overrides: Partial<AssignedTask> = {}): AssignedTask {
  return {
    taskId: "tid_1",
    key: "NP-2",
    title: "Notify on assign",
    status: "in_progress",
    assignedAt: "2026-08-22T15:00:00.000Z",
    ...overrides,
  };
}

describe("assignedTaskNotificationId", () => {
  it("includes task id and assignedAt", () => {
    expect(assignedTaskNotificationId(task())).toBe(
      "assigned_task:tid_1:2026-08-22T15:00:00.000Z",
    );
  });
});

describe("assignedTaskNotificationTitle", () => {
  it("prefers the title", () => {
    expect(assignedTaskNotificationTitle(task())).toBe("Notify on assign");
  });

  it("falls back to the key", () => {
    expect(assignedTaskNotificationTitle(task({ title: "  " }))).toBe("NP-2");
  });
});

describe("assignedTaskNotificationBody", () => {
  it("names the key", () => {
    expect(assignedTaskNotificationBody(task())).toBe(
      "Assigned to you · NP-2",
    );
  });
});

describe("tasksPluginTaskHref", () => {
  it("builds the Tasks plugin deep link", () => {
    expect(tasksPluginTaskHref("NP-2")).toBe(
      "/plugins/tasks/tasks/task/NP-2",
    );
  });
});

describe("newlyAssignedTasks", () => {
  it("returns nothing on the first snapshot", () => {
    expect(newlyAssignedTasks([task()], null)).toEqual([]);
  });

  it("returns only newly assigned task ids", () => {
    const a = task({ taskId: "a", key: "A-1" });
    const b = task({ taskId: "b", key: "B-1" });
    expect(newlyAssignedTasks([a, b], new Set(["a"]))).toEqual([b]);
  });
});
