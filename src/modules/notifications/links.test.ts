import assert from "node:assert/strict";
import test from "node:test";
import { notificationLinks, safeActionUrl } from "./links";
import { isDismissible, TYPE_CATEGORY } from "./constants";

const id = "3f8b2a54-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

test("generated links are accepted by the allow-list", () => {
  for (const url of [
    notificationLinks.task(id), notificationLinks.project(id), notificationLinks.projectTeam(id), notificationLinks.qualification(id),
    notificationLinks.rental(id), notificationLinks.invoice(id), notificationLinks.signature(id), notificationLinks.approval(id), notificationLinks.document(id),
  ]) assert.equal(safeActionUrl(url), url);
});

test("untrusted or foreign targets are rejected", () => {
  for (const url of [
    "https://evil.example/tasks/" + id, "//evil.example", "/\\evil.example", "javascript:alert(1)", "/tasks/not-a-uuid",
    `/tasks/${id}/../../admin`, `/tasks/${id}?next=https://evil.example`, "/administration/users", "", null, undefined,
  ]) assert.equal(safeActionUrl(url as string), null, String(url));
});

test("serious overdue conditions cannot be dismissed", () => {
  for (const type of ["TASK_OVERDUE", "RENTAL_OVERDUE", "INVOICE_OVERDUE", "QUALIFICATION_EXPIRED"] as const) assert.equal(isDismissible(type), false);
  assert.equal(isDismissible("TASK_ASSIGNED"), true);
  assert.equal(isDismissible("TASK_DUE_SOON"), true);
});

test("every notification type maps to a preference category", () => {
  assert.equal(TYPE_CATEGORY.INVOICE_OVERDUE, "INVOICES");
  assert.equal(TYPE_CATEGORY.CLIENT_RESPONSE_RECEIVED, "APPROVALS");
});
