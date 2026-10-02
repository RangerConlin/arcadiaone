import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DataTable, Pager, rowClass } from "@/components/data-table";
import { ButtonLink, SecondaryLink, StatusBadge } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { dateKeyUtc, formatDateTimeInZone, formatDayKey } from "@/lib/datetime";
import { formatName } from "@/lib/format";
import { getViewerTimeZone } from "@/modules/calendar/service";
import { canManageCourses, canManageSessions, canVerifyAny, getTrainingPolicy } from "@/modules/training/authorization";
import { listCourses, listRecords, listSessions, sessionTitle, TRAINING_PAGE_SIZE, type RecordFilter } from "@/modules/training/data";
import { DELIVERY_LABELS } from "@/modules/training/validation";

export const dynamic = "force-dynamic";

const TABS = [["upcoming", "Upcoming sessions"], ["recent", "Recent sessions"], ["courses", "Courses"], ["records", "Training records"]] as const;
const FILTERS: Array<[RecordFilter, string]> = [["unverified", "Awaiting verification"], ["verified", "Verified"], ["rejected", "Rejected"], ["all", "All"]];

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ tab?: string; filter?: string; page?: string; success?: string }> }) {
  const [user, query] = await Promise.all([requireAuthenticatedUser(), searchParams]);
  const tab = TABS.some(([id]) => id === query.tab) ? (query.tab as (typeof TABS)[number][0]) : "upcoming";
  const [zone, policy] = await Promise.all([getViewerTimeZone(user), getTrainingPolicy(user.organizationId)]);
  const filter = FILTERS.some(([id]) => id === query.filter) ? (query.filter as RecordFilter) : user.role === "EMPLOYEE" ? "all" : "unverified";
  return (
    <>
      <PageHeader
        actions={<>
          <SecondaryLink href="/training/records/new">Submit external training</SecondaryLink>
          {canManageSessions(user) ? <ButtonLink href="/training/sessions/new">Schedule session</ButtonLink> : null}
        </>}
        description="Personnel development records: what was taken, when, for how long, and who verified it. Qualifications are tracked separately on each profile."
        title="Training"
      />
      <div className="cal-toolbar">
        <div className="cal-views" role="tablist" aria-label="Training sections">
          {TABS.map(([id, label]) => <Link aria-current={tab === id ? "page" : undefined} className="cal-btn" href={`/training?tab=${id}`} key={id}>{label}</Link>)}
        </div>
      </div>
      {tab === "upcoming" || tab === "recent" ? <Sessions mode={tab} user={user} zone={zone} /> : null}
      {tab === "courses" ? <Courses canManage={canManageCourses(user)} user={user} /> : null}
      {tab === "records" ? <Records canVerify={canVerifyAny(user, policy)} filter={filter} page={Number(query.page) || 1} user={user} /> : null}
    </>
  );
}

async function Sessions({ mode, user, zone }: { mode: "upcoming" | "recent"; user: Awaited<ReturnType<typeof requireAuthenticatedUser>>; zone: string }) {
  const sessions = await listSessions(user, mode);
  return (
    <DataTable columns={[{ label: "When" }, { label: "Session" }, { label: "Location" }, { label: "Instructor" }, { label: "Participants" }, { label: "Status" }]} empty={sessions.length ? undefined : mode === "upcoming" ? "No upcoming sessions." : "No recent sessions."}>
      {sessions.map((s) => (
        <tr className={rowClass} key={s.id}>
          <td className="p-3 whitespace-nowrap">{formatDateTimeInZone(s.startAt, zone)}</td>
          <td className="p-3"><Link className="font-semibold text-[color:var(--accent)]" href={`/training/sessions/${s.id}`}>{sessionTitle(s)}</Link></td>
          <td className="p-3">{s.location ?? "—"}</td>
          <td className="p-3">{s.instructor ?? "—"}</td>
          <td className="p-3">{s._count.enrollments}{s.maxParticipants ? ` / ${s.maxParticipants}` : ""}</td>
          <td className="p-3"><StatusBadge status={s.status} /></td>
        </tr>
      ))}
    </DataTable>
  );
}

async function Courses({ user, canManage }: { user: Awaited<ReturnType<typeof requireAuthenticatedUser>>; canManage: boolean }) {
  const courses = await listCourses(user);
  return (
    <>
      {canManage ? <p className="mb-3 text-sm"><Link className="text-[color:var(--accent)] underline" href="/administration/training-courses">Manage courses</Link></p> : null}
      <DataTable columns={[{ label: "Course" }, { label: "Code" }, { label: "Provider" }, { label: "Default hours", align: "right" }, { label: "Delivery" }, { label: "May lead to" }]} empty={courses.length ? undefined : "No courses have been defined yet."}>
        {courses.map((c) => (
          <tr className={rowClass} key={c.id}>
            <td className="p-3 font-semibold">{c.name}</td><td className="p-3">{c.code ?? "—"}</td><td className="p-3">{c.provider ?? "—"}</td>
            <td className="p-3 text-right tabular-nums">{c.defaultDurationHours?.toFixed(2) ?? "—"}</td>
            <td className="p-3">{c.deliveryMethod ? DELIVERY_LABELS[c.deliveryMethod] : "—"}</td>
            <td className="p-3">{c.qualificationLinks.filter((l) => l.effect !== "NONE").map((l) => l.qualificationType.name).join(", ") || "—"}</td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}

async function Records({ user, filter, page, canVerify }: { user: Awaited<ReturnType<typeof requireAuthenticatedUser>>; filter: RecordFilter; page: number; canVerify: boolean }) {
  const list = await listRecords(user, filter, page);
  return (
    <>
      <div className="cal-views mb-3" role="group" aria-label="Record status">
        {FILTERS.map(([id, label]) => <Link aria-current={filter === id ? "page" : undefined} className="cal-btn" href={`/training?tab=records&filter=${id}`} key={id}>{label}</Link>)}
      </div>
      <DataTable columns={[{ label: "Employee" }, { label: "Course" }, { label: "Provider" }, { label: "Completed" }, { label: "Hours", align: "right" }, { label: "Status" }]} empty={list.rows.length ? undefined : "No records."}>
        {list.rows.map((r) => (
          <tr className={rowClass} key={r.id}>
            <td className="p-3">{formatName(r.employee)}</td>
            <td className="p-3"><Link className="font-semibold text-[color:var(--accent)]" href={`/training/records/${r.id}`}>{r.courseName}</Link></td>
            <td className="p-3">{r.provider}</td><td className="p-3 whitespace-nowrap">{formatDayKey(dateKeyUtc(r.completionDate), { month: "short", day: "numeric", year: "numeric" })}</td>
            <td className="p-3 text-right tabular-nums">{r.hours?.toFixed(2) ?? "—"}</td>
            <td className="p-3"><StatusBadge status={r.verified ? "verified" : r.rejectedAt ? "rejected" : "pending"} /></td>
          </tr>
        ))}
      </DataTable>
      <Pager basePath="/training" page={list.page} pageSize={TRAINING_PAGE_SIZE} pages={list.pages} params={{ tab: "records", filter }} total={list.total} />
      {canVerify ? null : user.role !== "EMPLOYEE" ? <p className="mt-3 text-xs text-[color:var(--muted)]">Verification is performed by administrators{user.role === "MANAGER" ? " (managers are not currently permitted to verify)" : ""}.</p> : null}
    </>
  );
}
