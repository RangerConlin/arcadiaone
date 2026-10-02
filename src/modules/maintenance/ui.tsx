import Link from "next/link";
import type { DueState } from "./due";
import type { RentalConflict } from "./rental-conflicts";
import { dateKeyInZone, formatDayKey } from "@/lib/datetime";

const DUE_LABEL: Record<DueState, string> = { OK: "on schedule", DUE_SOON: "due soon", DUE: "due", OVERDUE: "overdue" };
const TONE: Record<DueState, "ok" | "warn" | "bad" | "info"> = { OK: "ok", DUE_SOON: "warn", DUE: "warn", OVERDUE: "bad" };

export function DueBadge({ state }: { state: DueState }) {
  return <span className="badge" data-tone={TONE[state]}>{DUE_LABEL[state]}</span>;
}

/** Plain-language warning for rentals that still need an asset that is (becoming) unavailable. */
export function ConflictList({ conflicts, zone }: { conflicts: RentalConflict[]; zone: string }) {
  if (!conflicts.length) return null;
  return (
    <section className="mb-6 max-w-4xl rounded-sm border border-[color:var(--danger)] bg-[color:var(--panel)] p-4" role="alert">
      <h2 className="text-base font-semibold text-[color:var(--danger)]">Rental conflict: {conflicts.length} reservation{conflicts.length === 1 ? "" : "s"} need this equipment</h2>
      <p className="mb-2 text-sm text-[color:var(--muted)]">Nothing was reassigned. Open each rental and decide whether to substitute another asset, change the dates, or cancel.</p>
      <ul className="grid gap-1 text-sm">
        {conflicts.map((rental) => (
          <li key={rental.id}>
            <Link className="font-semibold text-[color:var(--accent)] underline" href={`/rentals/${rental.id}`}>{rental.rentalNumber}</Link>{" "}
            · {rental.status.toLowerCase().replaceAll("_", " ")} · {formatDayKey(dateKeyInZone(rental.reservationStart, zone), { month: "short", day: "numeric" })} – {formatDayKey(dateKeyInZone(rental.reservationEnd, zone), { month: "short", day: "numeric", year: "numeric" })}
            {rental.client ? ` · ${rental.client.name}` : rental.project ? ` · ${rental.project.name}` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}
