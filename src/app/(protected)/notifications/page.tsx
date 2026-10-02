import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { SecondaryLink } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { getViewerTimeZone } from "@/modules/calendar/service";
import { listNotifications, type NotificationFilter } from "@/modules/notifications/service";
import { MarkAllReadButton, NotificationRow } from "@/modules/notifications/notification-ui";

export const dynamic = "force-dynamic";

const FILTERS: Array<[NotificationFilter, string]> = [["unread", "Unread"], ["all", "All"], ["dismissed", "Dismissed"]];

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string }> }) {
  const [user, query] = await Promise.all([requireAuthenticatedUser(), searchParams]);
  const filter = FILTERS.some(([value]) => value === query.filter) ? (query.filter as NotificationFilter) : "unread";
  const [result, zone] = await Promise.all([listNotifications(user, filter, Number(query.page) || 1), getViewerTimeZone(user)]);
  const href = (nextFilter: string, page = 1) => `/notifications?filter=${nextFilter}${page > 1 ? `&page=${page}` : ""}`;
  return (
    <>
      <PageHeader
        actions={<SecondaryLink href="/notifications/preferences">Preferences</SecondaryLink>}
        description="Notifications tell you what changed. Reading or dismissing one never changes the underlying record."
        title="Notifications"
      />
      <div className="cal-toolbar">
        <div className="cal-views" role="group" aria-label="Filter">
          {FILTERS.map(([value, label]) => (
            <Link aria-current={filter === value ? "page" : undefined} className="cal-btn" href={href(value)} key={value}>{label}</Link>
          ))}
        </div>
        {filter === "unread" && result.total ? <MarkAllReadButton /> : null}
      </div>
      {result.items.length ? (
        <ul className="notif-list notif-page">
          {result.items.map((item) => <NotificationRow key={item.id} notification={item} zone={zone} />)}
        </ul>
      ) : (
        <p className="cal-empty-large">{filter === "unread" ? "No unread notifications." : filter === "dismissed" ? "No dismissed notifications." : "No notifications yet."}</p>
      )}
      {result.pages > 1 ? (
        <nav aria-label="Pagination" className="cal-pager">
          {result.page > 1 ? <Link className="cal-btn" href={href(filter, result.page - 1)}>Newer</Link> : <span />}
          <span>Page {result.page} of {result.pages} · {result.total} total</span>
          {result.page < result.pages ? <Link className="cal-btn" href={href(filter, result.page + 1)}>Older</Link> : <span />}
        </nav>
      ) : null}
    </>
  );
}
