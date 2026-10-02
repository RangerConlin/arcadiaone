import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ButtonLink, inputClass, Notice } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { formatDayKey, todayKey } from "@/lib/datetime";
import { formatName } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { clientVisibilityWhere } from "@/modules/clients/authorization";
import { projectVisibilityWhere } from "@/modules/projects/authorization";
import { getCalendarItems, getViewerTimeZone } from "./service";
import {
  CALENDAR_ITEM_TYPES, CALENDAR_TYPE_META, calendarHref, calendarRange, parseCalendarFilters, shiftAnchor, type CalendarFilters,
} from "./types";
import { AgendaView, MonthView, WeekView } from "./views";

type Params = Record<string, string | string[] | undefined>;

const VIEWS = [["month", "Month"], ["week", "Week"], ["agenda", "Agenda"]] as const;

async function filterOptions(user: Awaited<ReturnType<typeof requireAuthenticatedUser>>) {
  const staff = user.role !== "EMPLOYEE";
  const [projects, clients, employees, departments] = await Promise.all([
    prisma.project.findMany({ where: projectVisibilityWhere(user), select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }),
    prisma.client.findMany({ where: clientVisibilityWhere(user), select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }),
    staff ? prisma.employee.findMany({ where: { organizationId: user.organizationId, employmentStatus: { not: "TERMINATED" } }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 500 }) : [],
    staff ? prisma.department.findMany({ where: { organizationId: user.organizationId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
  ]);
  return { projects, clients, employees, departments, staff };
}

function title(filters: CalendarFilters, fromKey: string, toKey: string) {
  if (filters.view === "month") return formatDayKey(filters.anchor, { month: "long", year: "numeric" });
  if (filters.view === "week") return `${formatDayKey(fromKey, { month: "short", day: "numeric" })} – ${formatDayKey(toKey, { month: "short", day: "numeric", year: "numeric" })}`;
  return `${formatDayKey(fromKey, { month: "short", day: "numeric", year: "numeric" })} – ${formatDayKey(toKey, { month: "short", day: "numeric", year: "numeric" })}`;
}

export async function CalendarScreen({ params, basePath, forcedMine = false }: { params: Params; basePath: string; forcedMine?: boolean }) {
  const user = await requireAuthenticatedUser();
  const zone = await getViewerTimeZone(user);
  const today = todayKey(zone);
  const filters = parseCalendarFilters(params, today, forcedMine);
  const range = calendarRange(filters);
  const [result, options] = await Promise.all([getCalendarItems(user, filters, { zone, range }), filterOptions(user)]);
  const success = typeof params.success === "string" ? params.success : undefined;
  const link = (overrides: Partial<CalendarFilters>) => calendarHref(filters, overrides, basePath);
  const anchorToday = filters.view === "agenda" ? { anchor: today, from: undefined, to: undefined } : { anchor: today };
  const mineHref = forcedMine ? "/calendar" : calendarHref(filters, { mine: !filters.mine }, basePath);
  const activeFilters = Boolean(filters.types.length || filters.projectId || filters.clientId || filters.employeeId || filters.departmentId || filters.showCompleted || filters.from || filters.to);
  const prevAnchor = shiftAnchor(filters, -1);
  const nextAnchor = shiftAnchor(filters, 1);
  const shifted = (anchor: string) => filters.view === "agenda" ? link({ anchor, from: anchor, to: undefined }) : link({ anchor });

  return (
    <>
      <PageHeader
        actions={<ButtonLink href="/calendar/events/new">New event</ButtonLink>}
        description={forcedMine ? "Everything assigned to you, your projects, your credentials and your events." : `Showing times in ${zone}. Dates without a time of day are never shifted by time zone.`}
        title={forcedMine ? "My calendar" : "Calendar"}
      />
      <Notice message={success} tone="success" />
      <div className="cal-toolbar">
        <div className="cal-nav" role="group" aria-label="Navigate">
          <Link className="cal-btn" href={shifted(prevAnchor)} aria-label="Previous">‹</Link>
          <Link className="cal-btn" href={link(anchorToday)}>Today</Link>
          <Link className="cal-btn" href={shifted(nextAnchor)} aria-label="Next">›</Link>
        </div>
        <h2 className="cal-title">{title(filters, result.range.fromKey, result.range.toKey)}</h2>
        <div className="cal-views" role="group" aria-label="View">
          {VIEWS.map(([view, label]) => (
            <Link aria-current={filters.view === view ? "page" : undefined} className="cal-btn" href={link({ view })} key={view}>{label}</Link>
          ))}
          {!forcedMine ? (
            <Link aria-pressed={filters.mine} className="cal-btn" data-active={filters.mine || undefined} href={mineHref}>Assigned to me</Link>
          ) : null}
        </div>
      </div>

      <details className="cal-filterbox" open={activeFilters}>
      <summary>Filters{activeFilters ? " (active)" : ""}</summary>
      <form action={basePath} className="cal-filters" method="get">
        <input name="view" type="hidden" value={filters.view} />
        <input name="date" type="hidden" value={filters.anchor} />
        {filters.mine && !forcedMine ? <input name="scope" type="hidden" value="mine" /> : null}
        <fieldset className="cal-types">
          <legend>Event types</legend>
          {CALENDAR_ITEM_TYPES.map((type) => (
            <label key={type}>
              <input defaultChecked={filters.types.includes(type)} name="types" type="checkbox" value={type} />
              {CALENDAR_TYPE_META[type].label}
            </label>
          ))}
          <small>None selected shows every type.</small>
        </fieldset>
        <div className="cal-filter-grid">
          <label>Project
            <select className={inputClass} defaultValue={filters.projectId ?? ""} name="project">
              <option value="">All projects</option>
              {options.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label>Client
            <select className={inputClass} defaultValue={filters.clientId ?? ""} name="client">
              <option value="">All clients</option>
              {options.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>
          {options.staff ? (
            <>
              <label>Employee
                <select className={inputClass} defaultValue={filters.employeeId ?? ""} name="employee">
                  <option value="">Anyone</option>
                  {options.employees.map((employee) => <option key={employee.id} value={employee.id}>{formatName(employee)}</option>)}
                </select>
              </label>
              <label>Department
                <select className={inputClass} defaultValue={filters.departmentId ?? ""} name="department">
                  <option value="">All departments</option>
                  {options.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </select>
              </label>
            </>
          ) : null}
          {filters.view === "agenda" ? (
            <>
              <label>From<input className={inputClass} defaultValue={result.range.fromKey} name="from" type="date" /></label>
              <label>To<input className={inputClass} defaultValue={result.range.toKey} name="to" type="date" /></label>
            </>
          ) : null}
        </div>
        <label className="cal-check"><input defaultChecked={filters.showCompleted} name="completed" type="checkbox" value="1" /> Include completed and cancelled</label>
        <div className="cal-filter-actions">
          <button className="cal-btn cal-btn-primary" type="submit">Apply filters</button>
          <Link className="cal-btn" href={forcedMine ? basePath : `${basePath}?view=${filters.view}&date=${filters.anchor}`}>Reset</Link>
        </div>
      </form>
      </details>

      {result.truncated ? <Notice message="Some sources have more items than can be shown. Narrow the date range or filters to see everything." /> : null}

      {filters.view === "month" ? <MonthView basePath={basePath} filters={filters} items={result.items} zone={zone} /> : null}
      {filters.view === "week" ? <WeekView basePath={basePath} filters={filters} items={result.items} zone={zone} /> : null}
      {filters.view === "agenda" ? <AgendaView fromKey={result.range.fromKey} items={result.items} toKey={result.range.toKey} zone={zone} /> : null}
    </>
  );
}
