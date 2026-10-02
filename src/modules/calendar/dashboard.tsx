import Link from "next/link";
import { SecondaryLink } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { addDays, formatDayKey, todayKey } from "@/lib/datetime";
import { getCalendarItems, getViewerTimeZone } from "./service";
import type { CalendarFilters, CalendarItem } from "./types";
import { TypeBadge } from "./views";

const base = (anchor: string): CalendarFilters => ({ view: "agenda", anchor, types: [], mine: true, showCompleted: false });
const UPCOMING_DAYS = 7;
const OVERDUE_LOOKBACK = 30;
const LIMIT = 6;

function ItemList({ items, empty }: { items: CalendarItem[]; empty: string }) {
  if (!items.length) return <p className="mt-3 text-sm text-[color:var(--muted)]">{empty}</p>;
  return (
    <ul className="mt-3 grid gap-2">
      {items.slice(0, LIMIT).map((item) => (
        <li className="flex flex-wrap items-center gap-2 text-sm" key={item.key}>
          <TypeBadge type={item.type} />
          <Link className="font-semibold hover:underline" href={item.href}>{item.title}</Link>
          <span className="text-xs text-[color:var(--muted)]">
            {formatDayKey(item.startKey, { month: "short", day: "numeric" })}
            {item.endKey !== item.startKey ? ` – ${formatDayKey(item.endKey, { month: "short", day: "numeric" })}` : ""}
          </span>
        </li>
      ))}
      {items.length > LIMIT ? <li className="text-xs text-[color:var(--muted)]">and {items.length - LIMIT} more</li> : null}
    </ul>
  );
}

/** Restrained dashboard summary: only what is assigned to or relevant to the viewer, permission-filtered by each source. */
export async function DashboardSchedule() {
  const user = await requireAuthenticatedUser();
  const zone = await getViewerTimeZone(user);
  const today = todayKey(zone);
  const [upcoming, overdue] = await Promise.all([
    getCalendarItems(user, base(today), { zone, range: { fromKey: today, toKey: addDays(today, UPCOMING_DAYS) } }),
    getCalendarItems(user, base(today), { zone, range: { fromKey: addDays(today, -OVERDUE_LOOKBACK), toKey: addDays(today, -1) } }),
  ]);
  const todays = upcoming.items.filter((item) => item.startKey <= today && item.endKey >= today);
  const soon = upcoming.items.filter((item) => item.startKey > today);
  const late = overdue.items.filter((item) => item.overdue);
  return (
    <section className="mt-6 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">My schedule</h2>
          <p className="mt-1 text-sm text-[color:var(--muted)]">Today, the next {UPCOMING_DAYS} days, and anything overdue that is yours.</p>
        </div>
        <SecondaryLink href="/calendar/my">Open my calendar</SecondaryLink>
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <div><h3 className="text-sm font-semibold">Today</h3><ItemList empty="Nothing scheduled today." items={todays}/></div>
        <div><h3 className="text-sm font-semibold">Coming up</h3><ItemList empty="Nothing in the next week." items={soon}/></div>
        <div><h3 className="text-sm font-semibold">Overdue</h3><ItemList empty="Nothing overdue." items={late}/></div>
      </div>
    </section>
  );
}
