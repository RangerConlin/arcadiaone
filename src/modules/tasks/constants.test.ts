import assert from "node:assert/strict";
import test from "node:test";
import { DUE_SOON_DAYS, isDueSoon, isOverdue } from "./constants";
import { taskSchema } from "./validation";

const now = new Date("2026-10-02T12:00:00Z");
test("open past-due tasks are overdue, but closed tasks are not", () => {
  assert.equal(isOverdue({ dueDate: new Date("2026-10-01T12:00:00Z"), status: "TODO" }, now), true);
  assert.equal(isOverdue({ dueDate: new Date("2026-10-01T12:00:00Z"), status: "COMPLETED" }, now), false);
  assert.equal(isOverdue({ dueDate: new Date("2026-10-01T12:00:00Z"), status: "CANCELLED" }, now), false);
});

test(`due soon covers today through ${DUE_SOON_DAYS} days`, () => {
  assert.equal(isDueSoon({ dueDate: new Date("2026-10-09T12:00:00Z"), status: "IN_PROGRESS" }, now), true);
  assert.equal(isDueSoon({ dueDate: new Date("2026-10-10T12:00:00Z"), status: "TODO" }, now), false);
  assert.equal(isDueSoon({ dueDate: null, status: "TODO" }, now), false);
});

test("task validation accepts standalone and unassigned work", () => {
  const parsed = taskSchema.safeParse({ title: "Renew license", description: "", status: "TODO", priority: "NORMAL", assignedToEmployeeId: "", projectId: "", milestoneId: "", parentTaskId: "", startDate: "", dueDate: "" });
  assert.equal(parsed.success, true);
  if (parsed.success) { assert.equal(parsed.data.projectId, null); assert.equal(parsed.data.assignedToEmployeeId, null); }
});

test("task validation rejects a due date before its start date", () => {
  const parsed = taskSchema.safeParse({ title: "Inspect", description: "", status: "TODO", priority: "HIGH", assignedToEmployeeId: "", projectId: "", milestoneId: "", parentTaskId: "", startDate: "2026-10-10", dueDate: "2026-10-09" });
  assert.equal(parsed.success, false);
});
