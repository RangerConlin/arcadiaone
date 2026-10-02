import { addDays, addMonths, isDayKey, monthGrid, startOfMonth, weekKeys } from "@/lib/datetime";

export const CALENDAR_ITEM_TYPES = ["PROJECT", "MILESTONE", "TASK", "RENTAL", "QUALIFICATION", "INVOICE", "SIGNATURE", "APPROVAL", "EVENT"] as const;
export type CalendarItemType = (typeof CALENDAR_ITEM_TYPES)[number];

/** Label and icon are always shown together so type never depends on color alone. */
export const CALENDAR_TYPE_META: Record<CalendarItemType, { label: string; icon: string }> = {
  PROJECT: { label: "Project", icon: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" },
  MILESTONE: { label: "Milestone", icon: "M5 21V4M5 4h11l-2 4 2 4H5" },
  TASK: { label: "Task", icon: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" },
  RENTAL: { label: "Rental", icon: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8" },
  QUALIFICATION: { label: "Qualification", icon: "M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.5 7.1 18.2 8 12.7 4 8.8 9.5 8z" },
  INVOICE: { label: "Invoice", icon: "M4 4h16v16H4zM8 8h8M8 12h8M8 16h5" },
  SIGNATURE: { label: "Signature", icon: "M4 20c4-5 7-8 12-12l3 3c-4 5-7 8-12 12zM14 6l3 3" },
  APPROVAL: { label: "Approval", icon: "M5 12l4 4L19 6M3 3h18v18H3z" },
  EVENT: { label: "General event", icon: "M7 3v4M17 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" },
};

export type CalendarItem = {
  /** Stable, unique per source record + date field. */
  key: string;
  type: CalendarItemType;
  /** What date this item represents ("Due", "Starts", "Expires", ...). */
  kind: string;
  title: string;
  /** First and last calendar day in the viewer's time zone (date-only values are never shifted). */
  startKey: string;
  endKey: string;
  /** True when the item has no meaningful time of day. */
  allDay: boolean;
  /** Instants for timed items, so views can print local times. */
  startAt?: Date;
  endAt?: Date;
  /** Trusted application route of the source record. */
  href: string;
  status?: string;
  /** Muted/closed items (completed tasks, cancelled events). */
  closed?: boolean;
  overdue?: boolean;
  projectName?: string | null;
  clientName?: string | null;
  assigneeName?: string | null;
  detail?: string | null;
};

export type CalendarView = "month" | "week" | "agenda";

export type CalendarFilters = {
  view: CalendarView;
  anchor: string;
  types: CalendarItemType[];
  projectId?: string;
  clientId?: string;
  employeeId?: string;
  departmentId?: string;
  mine: boolean;
  showCompleted: boolean;
  /** Agenda only. */
  from?: string;
  to?: string;
};

export type CalendarRange = { fromKey: string; toKey: string };

const MAX_AGENDA_DAYS = 366;
type Params = Record<string, string | string[] | undefined>;

const one = (params: Params, key: string) => {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
};
const uuidLike = (value?: string) => (value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined);

/** Parses and sanitizes URL query parameters; nothing from the URL is trusted beyond shape. */
export function parseCalendarFilters(params: Params, today: string, forcedMine = false): CalendarFilters {
  const view = ["month", "week", "agenda"].includes(one(params, "view") ?? "") ? (one(params, "view") as CalendarView) : "month";
  const anchor = isDayKey(one(params, "date")) ? one(params, "date")! : today;
  const rawTypes = [params.types ?? ""].flat().join(",").split(",").map((value) => value.trim().toUpperCase());
  const types = CALENDAR_ITEM_TYPES.filter((type) => rawTypes.includes(type));
  const from = isDayKey(one(params, "from")) ? one(params, "from") : undefined;
  const to = isDayKey(one(params, "to")) ? one(params, "to") : undefined;
  return {
    view, anchor, types,
    projectId: uuidLike(one(params, "project")),
    clientId: uuidLike(one(params, "client")),
    employeeId: uuidLike(one(params, "employee")),
    departmentId: uuidLike(one(params, "department")),
    mine: forcedMine || one(params, "scope") === "mine",
    showCompleted: one(params, "completed") === "1",
    from, to,
  };
}

export function calendarRange(filters: CalendarFilters): CalendarRange {
  if (filters.view === "month") {
    const grid = monthGrid(filters.anchor);
    return { fromKey: grid[0][0], toKey: grid.at(-1)![6] };
  }
  if (filters.view === "week") {
    const days = weekKeys(filters.anchor);
    return { fromKey: days[0], toKey: days[6] };
  }
  const fromKey = filters.from ?? filters.anchor;
  const requestedTo = filters.to && filters.to >= fromKey ? filters.to : addDays(fromKey, 30);
  const cap = addDays(fromKey, MAX_AGENDA_DAYS - 1);
  return { fromKey, toKey: requestedTo > cap ? cap : requestedTo };
}

/** Builds a calendar URL from filters; only whitelisted parameters are emitted. */
export function calendarHref(filters: CalendarFilters, overrides: Partial<CalendarFilters> = {}, base = "/calendar") {
  const next = { ...filters, ...overrides };
  const query = new URLSearchParams();
  if (next.view !== "month") query.set("view", next.view);
  query.set("date", next.anchor);
  if (next.types.length) query.set("types", next.types.join(","));
  if (next.projectId) query.set("project", next.projectId);
  if (next.clientId) query.set("client", next.clientId);
  if (next.employeeId) query.set("employee", next.employeeId);
  if (next.departmentId) query.set("department", next.departmentId);
  if (next.mine && base === "/calendar") query.set("scope", "mine");
  if (next.showCompleted) query.set("completed", "1");
  if (next.view === "agenda") {
    if (next.from) query.set("from", next.from);
    if (next.to) query.set("to", next.to);
  }
  return `${base}?${query.toString()}`;
}

/** Previous/next anchor for the current view. */
export function shiftAnchor(filters: CalendarFilters, direction: -1 | 1) {
  if (filters.view === "month") return addMonths(startOfMonth(filters.anchor), direction);
  if (filters.view === "week") return addDays(filters.anchor, 7 * direction);
  const span = Math.max(1, Math.min(MAX_AGENDA_DAYS, rangeDays(calendarRange(filters))));
  return addDays(filters.from ?? filters.anchor, span * direction);
}
const rangeDays = ({ fromKey, toKey }: CalendarRange) => Math.round((Date.parse(toKey) - Date.parse(fromKey)) / 86_400_000) + 1;
