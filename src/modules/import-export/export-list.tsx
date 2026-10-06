import Link from "next/link";
import type { AuthenticatedUser } from "@/lib/auth/session";
import { exportsFor } from "./exports";

/** Exports available to this user — each is an existing report with its own permissions and filters. */
export function ExportList({ user }: { user: AuthenticatedUser }) {
  const exports = exportsFor(user);
  if (!exports.length) return <p className="text-sm text-[color:var(--muted)]">No exports are available for your role.</p>;
  return (
    <div className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4">
      <p className="mb-3 text-sm text-[color:var(--muted)]">Exports follow your permissions. Open a report to apply filters first; its export buttons keep them.</p>
      <ul className="grid gap-2 text-sm">
        {exports.map((entry) => (
          <li className="flex flex-wrap items-baseline gap-x-3" key={entry.reportId}>
            <span className="w-28 font-semibold">{entry.entity}</span>
            <a className="underline" href={`/reports/${entry.reportId}/export?format=csv`}>Download CSV</a>
            <Link className="underline" href={`/reports/${entry.reportId}`}>Filter first</Link>
            {entry.note ? <span className="text-xs text-[color:var(--muted)]">{entry.note}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
