import Link from "next/link";
import type { Notification } from "@/generated/prisma/client";
import { NOTIFICATION_MENU_SIZE } from "./constants";
import { listNotifications, unreadCount, type Viewer } from "./service";
import { MarkAllReadButton, NotificationRow } from "./notification-ui";

/** Header control. Uses <details> so it works without client JavaScript. */
export async function NotificationBell({ viewer, zone }: { viewer: Viewer; zone: string }) {
  const [count, recent] = await Promise.all([unreadCount(viewer), listNotifications(viewer, "all", 1, NOTIFICATION_MENU_SIZE)]);
  const items: Notification[] = recent.items;
  return (
    <details className="notif-bell">
      <summary aria-label={count ? `Notifications, ${count} unread` : "Notifications"}>
        <svg aria-hidden="true" fill="none" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="20">
          <path d="M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0" />
        </svg>
        {count ? <span className="notif-count">{count > 99 ? "99+" : count}</span> : null}
      </summary>
      <div className="notif-menu">
        <div className="notif-menu-head">
          <strong>Notifications</strong>
          {count ? <MarkAllReadButton /> : null}
        </div>
        {items.length ? (
          <ul className="notif-list">{items.map((item) => <NotificationRow compact key={item.id} notification={item} zone={zone} />)}</ul>
        ) : (
          <p className="notif-empty">You&apos;re all caught up.</p>
        )}
        <Link className="notif-menu-foot" href="/notifications">View all notifications</Link>
      </div>
    </details>
  );
}
