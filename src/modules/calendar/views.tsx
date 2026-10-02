import Link from "next/link";
import { StatusBadge } from "@/components/ui";
import { addDays, formatDayKey, formatTimeInZone, monthGrid, startOfMonth, todayKey, weekKeys } from "@/lib/datetime";
import { groupByDay } from "./service";
import { CALENDAR_TYPE_META, calendarHref, type CalendarFilters, type CalendarItem, type CalendarItemType } from "./types";

export function TypeIcon({ type }: { type: CalendarItemType }) {
  return (
    <svg aria-hidden="true" className="cal-icon" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <path d={CALENDAR_TYPE_META[type].icon} />
    </svg>
  );
}

/** Icon + text label, so item type never depends on color. */
export function TypeBadge({ type }: { type: CalendarItemType }) {
  return (
    <span className="cal-type" data-type={type}>
      <TypeIcon type={type} />
      {CALENDAR_TYPE_META[type].label}
    </span>
  );
}

function timeLabel(item: CalendarItem, dayKey: string, zone: string) {
  if (item.allDay || !item.startAt || item.startKey !== dayKey) return null;
  return formatTimeInZone(item.startAt, zone);
}

function Chip({ item, dayKey, zone }: { item: CalendarItem; dayKey: string; zone: string }) {
  const time = timeLabel(item, dayKey, zone);
  return (
    <Link
      className="cal-chip" data-closed={item.closed || undefined} data-overdue={item.overdue || undefined} data-type={item.type}
      href={item.href} title={`${CALENDAR_TYPE_META[item.type].label}: ${item.title}`}
    >
      <TypeIcon type={item.type} />
      <span className="sr-only">{CALENDAR_TYPE_META[item.type].label}: </span>
      {time ? <span className="cal-chip-time">{time}</span> : null}
      <span className="cal-chip-title">{item.title}</span>
    </Link>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS = 3;

export function MonthView({ filters, items, zone, basePath }: { filters: CalendarFilters; items: CalendarItem[]; zone: string; basePath: string }) {
  const weeks = monthGrid(filters.anchor);
  const byDay = groupByDay(items, weeks[0][0], weeks.at(-1)![6]);
  const today = todayKey(zone);
  const month = startOfMonth(filters.anchor).slice(0, 7);
  return (
    <div className="cal-month" role="grid" aria-label={formatDayKey(filters.anchor, { month: "long", year: "numeric" })}>
      <div className="cal-weekdays" role="row">
        {WEEKDAYS.map((day) => <div key={day} role="columnheader">{day}</div>)}
      </div>
      {weeks.map((week) => (
        <div className="cal-week" key={week[0]} role="row">
          {week.map((day) => {
            const list = byDay.get(day) ?? [];
            return (
              <div className="cal-day" data-outside={!day.startsWith(month) || undefined} data-today={day === today || undefined} key={day} role="gridcell">
                <Link aria-label={formatDayKey(day)} className="cal-day-number" href={calendarHref(filters, { view: "agenda", from: day, to: day, anchor: day }, basePath)}>
                  {Number(day.slice(8))}
                </Link>
                <div className="cal-day-items">
                  {list.slice(0, MAX_CHIPS).map((item) => <Chip dayKey={day} item={item} key={`${item.key}`} zone={zone} />)}
                  {list.length > MAX_CHIPS ? (
                    <Link className="cal-more" href={calendarHref(filters, { view: "agenda", from: day, to: day, anchor: day }, basePath)}>
                      +{list.length - MAX_CHIPS} more
                    </Link>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function WeekView({ filters, items, zone, basePath }: { filters: CalendarFilters; items: CalendarItem[]; zone: string; basePath: string }) {
  const days = weekKeys(filters.anchor);
  const byDay = groupByDay(items, days[0], days[6]);
  const today = todayKey(zone);
  return (
    <div className="cal-weekview">
      {days.map((day) => {
        const list = byDay.get(day) ?? [];
        return (
          <section className="cal-weekcol" data-today={day === today || undefined} key={day}>
            <h3 className="cal-weekcol-head">
              <Link href={calendarHref(filters, { view: "agenda", from: day, to: day, anchor: day }, basePath)}>{formatDayKey(day, { weekday: "short", month: "short", day: "numeric" })}</Link>
            </h3>
            {list.length ? list.map((item) => <Chip dayKey={day} item={item} key={item.key} zone={zone} />) : <p className="cal-empty">Nothing scheduled</p>}
          </section>
        );
      })}
    </div>
  );
}

function dayHeading(day: string, today: string) {
  const label = formatDayKey(day, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  if (day === today) return `Today — ${label}`;
  if (day === addDays(today, 1)) return `Tomorrow — ${label}`;
  return label;
}

export function AgendaView({ items, zone, fromKey, toKey }: { items: CalendarItem[]; zone: string; fromKey: string; toKey: string }) {
  const byDay = groupByDay(items, fromKey, toKey);
  const days = [...byDay.keys()].sort();
  const today = todayKey(zone);
  if (!days.length) {
    return <p className="cal-empty-large">Nothing scheduled between {formatDayKey(fromKey)} and {formatDayKey(toKey)} for these filters.</p>;
  }
  return (
    <div className="cal-agenda">
      {days.map((day) => (
        <section aria-labelledby={`agenda-${day}`} key={day}>
          <h3 className="cal-agenda-day" data-today={day === today || undefined} id={`agenda-${day}`}>{dayHeading(day, today)}</h3>
          <ul className="cal-agenda-list">
            {byDay.get(day)!.map((item) => {
              const context = [item.projectName, item.clientName, item.assigneeName, item.detail].filter(Boolean).join(" · ");
              const time = item.allDay ? "All day" : item.startAt && item.startKey === day ? formatTimeInZone(item.startAt, zone) : "Continues";
              return (
                <li className="cal-agenda-row" data-closed={item.closed || undefined} data-overdue={item.overdue || undefined} key={`${day}:${item.key}`}>
                  <span className="cal-agenda-time">{time}</span>
                  <TypeBadge type={item.type} />
                  <div className="cal-agenda-main">
                    <Link className="cal-agenda-title" href={item.href}>{item.title}</Link>
                    <p className="cal-agenda-context"><span>{item.kind}</span>{context ? ` · ${context}` : ""}</p>
                  </div>
                  {item.status ? <StatusBadge status={item.status} /> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
