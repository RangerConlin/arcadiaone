"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { NotificationCategory } from "@/generated/prisma/enums";
import { requireAuthenticatedUser } from "@/lib/auth/session";
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
