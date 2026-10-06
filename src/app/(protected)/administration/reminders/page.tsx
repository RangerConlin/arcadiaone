import { redirect } from "next/navigation";

/** Superseded by Administration → Settings → Thresholds; kept so old bookmarks and links keep working. */
export default function RemindersPage() {
  redirect("/administration/settings?tab=thresholds");
}
