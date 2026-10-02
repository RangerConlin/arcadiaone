import Link from "next/link";
import type { Notification } from "@/generated/prisma/client";
import { dismissNotification, markAllNotificationsRead, markNotificationRead } from "./actions";
import { isDismissible, isUrgentType, TYPE_LABELS } from "./constants";
import { safeActionUrl } from "./links";

export function formatRelative(date: Date, now = new Date()) {
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" }).format(date);
}

export function NotificationRow({ notification, compact = false, zone = "UTC" }: { notification: Notification; compact?: boolean; zone?: string }) {
  const unread = notification.readAt === null && notification.dismissedAt === null;
  const hasLink = Boolean(safeActionUrl(notification.actionUrl));
  const exact = new Intl.DateTimeFormat("en-US", { timeZone: zone, dateStyle: "medium", timeStyle: "short" }).format(notification.createdAt);
  const body = (
    <>
      <span className="notif-title">{notification.title}</span>
      <span className="notif-message">{notification.message}</span>
    </>
  );
  return (
    <li className="notif-row" data-compact={compact || undefined} data-unread={unread || undefined} data-urgent={isUrgentType(notification.type) || undefined}>
      <span aria-hidden="true" className="notif-dot" />
      <div className="notif-main">
        <p className="notif-meta">
          <span className="notif-type">{TYPE_LABELS[notification.type]}</span>
          <time dateTime={notification.createdAt.toISOString()} title={exact}>{formatRelative(notification.createdAt)}</time>
          {unread ? <span className="sr-only"> (unread)</span> : null}
        </p>
        {hasLink ? <Link className="notif-link" href={`/notifications/open/${notification.id}`} prefetch={false}>{body}</Link> : <div className="notif-link">{body}</div>}
      </div>
      {!compact ? (
        <div className="notif-actions">
          {unread ? (
            <form action={markNotificationRead}><input name="id" type="hidden" value={notification.id} /><button className="notif-btn" type="submit">Mark read</button></form>
          ) : null}
          {notification.dismissedAt === null && isDismissible(notification.type) ? (
            <form action={dismissNotification}><input name="id" type="hidden" value={notification.id} /><button className="notif-btn" type="submit">Dismiss</button></form>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function MarkAllReadButton() {
  return <form action={markAllNotificationsRead}><button className="notif-btn" type="submit">Mark all as read</button></form>;
}
