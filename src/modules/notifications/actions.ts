"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { NotificationCategory } from "@/generated/prisma/enums";
import { requireAuthenticatedUser, requireRole } from "@/lib/auth/session";
import { isValidTimeZone } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { NOTIFICATION_CATEGORIES } from "./constants";
import { dismiss, markAllRead, markRead, setInAppPreference } from "./service";

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
const refresh = () => revalidatePath("/", "layout");

export async function markNotificationRead(data: FormData) {
  const user = await requireAuthenticatedUser();
  await markRead(user, text(data, "id"));
  refresh();
}

export async function markAllNotificationsRead() {
  const user = await requireAuthenticatedUser();
  await markAllRead(user);
  refresh();
}

export async function dismissNotification(data: FormData) {
  const user = await requireAuthenticatedUser();
  await dismiss(user, text(data, "id"));
  refresh();
}

export async function saveNotificationPreferences(data: FormData) {
  const user = await requireAuthenticatedUser();
  // Checkbox semantics: a category is enabled only when its box was submitted.
  for (const category of NOTIFICATION_CATEGORIES) {
    await setInAppPreference(user, category as NotificationCategory, data.get(`inapp:${category}`) === "on");
  }
  redirect("/notifications/preferences?success=Preferences saved.");
}

export async function saveAccountTimeZone(data: FormData) {
  const user = await requireAuthenticatedUser();
  const zone = text(data, "timezone");
  if (zone && !isValidTimeZone(zone)) redirect("/account?error=Choose a valid time zone.");
  await prisma.user.update({ where: { id: user.id }, data: { timezone: zone || null } });
  refresh();
  redirect("/account?success=Time zone saved.");
}

const days = (label: string, max: number) => z.coerce.number({ error: `${label} must be a number.` }).int().min(1, `${label} must be at least 1.`).max(max, `${label} must be at most ${max}.`);
const settingsSchema = z.object({
  timezone: z.string().refine(isValidTimeZone, "Choose a valid time zone."),
  taskDueSoonDays: days("Task due-soon window", 60),
  rentalDueSoonDays: days("Rental due-soon window", 60),
  invoiceDueSoonDays: days("Invoice due-soon window", 90),
  notificationArchiveAfterDays: z.coerce.number().int().min(0, "Archive window cannot be negative.").max(3650),
});

export async function saveReminderSettings(data: FormData) {
  const admin = await requireRole("ADMIN");
  const parsed = settingsSchema.safeParse(Object.fromEntries([...data.entries()].map(([key, value]) => [key, String(value).trim()])));
  if (!parsed.success) redirect(`/administration/reminders?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid settings.")}`);
  await prisma.organization.update({ where: { id: admin.organizationId }, data: parsed.data! });
  refresh();
  redirect("/administration/reminders?success=Settings saved.");
}
