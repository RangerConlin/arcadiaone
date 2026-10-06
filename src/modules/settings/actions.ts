"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { removeLogo, saveLogo, saveSettingsSection, type SectionResult } from "./service";

const back = (tab: string, result: SectionResult, ok: string) =>
  redirect(`/administration/settings?tab=${tab}&${result.ok ? `success=${encodeURIComponent(result.changed ? ok : "No changes to save.")}` : `error=${encodeURIComponent(result.error)}`}`);

/** Only ADMIN users reach any of these; the check is repeated here, not left to the page. */
export async function saveSettings(form: FormData) {
  const admin = await requireRole("ADMIN");
  const section = String(form.get("section") ?? "");
  const result = await saveSettingsSection(admin, section, form);
  if (result.ok) revalidatePath("/", "layout");
  back(section || "identity", result, "Settings saved.");
}

export async function uploadLogo(form: FormData) {
  const admin = await requireRole("ADMIN");
  const file = form.get("logo");
  const result = await saveLogo(admin, file instanceof File ? file : null);
  if (result.ok) revalidatePath("/", "layout");
  back("identity", result, "Logo saved.");
}

export async function deleteLogo() {
  const admin = await requireRole("ADMIN");
  const result = await removeLogo(admin);
  if (result.ok) revalidatePath("/", "layout");
  back("identity", result, "Logo removed.");
}
