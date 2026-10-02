import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SecondaryLink } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { formatDateTimeInZone } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { auditEntityHref } from "@/modules/audit/actions";
import { sanitizeMetadata } from "@/modules/audit/sanitize";
import { getViewerTimeZone } from "@/modules/calendar/service";

export const dynamic = "force-dynamic";

const humanize = (key: string) => key.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const show = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value));

export default async function AuditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("ADMIN");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const event = await prisma.auditEvent.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!event) notFound();
  const zone = await getViewerTimeZone(user);
  // Defense in depth: re-sanitize on read in case an older row predates a rule change.
  const metadata = sanitizeMetadata(event.metadata);
  const { changes, ...context } = metadata as { changes?: Array<{ field: string; from: unknown; to: unknown }> } & Record<string, unknown>;
  const href = auditEntityHref(event.entityType, event.entityId);
  return (
    <>
      <PageHeader
        actions={<SecondaryLink href="/administration/audit">Back to audit log</SecondaryLink>}
        breadcrumbs={[{ label: "Administration", href: "/administration" }, { label: "Audit log", href: "/administration/audit" }, { label: "Event" }]}
        title={event.summary}
      />
      <section className="mb-6 max-w-4xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="font-semibold">When</dt><dd>{formatDateTimeInZone(event.occurredAt, zone)} ({zone})</dd></div>
          <div><dt className="font-semibold">Actor</dt><dd>{event.actorLabel ?? "System"}{event.actorPortalUserId ? " — client portal user" : event.actorUserId ? " — internal user" : ""}</dd></div>
          <div><dt className="font-semibold">Action</dt><dd><code>{event.action}</code></dd></div>
          <div><dt className="font-semibold">Result</dt><dd>{event.outcome === "FAILURE" ? "Failed" : "Succeeded"}</dd></div>
          <div><dt className="font-semibold">Record</dt><dd>{event.entityType}{href ? <> · <Link className="underline" href={href}>open record</Link></> : null}{event.entityId ? <> · <Link className="underline" href={`/administration/audit?entityType=${event.entityType}&entityId=${event.entityId}`}>history</Link></> : null}</dd></div>
          <div><dt className="font-semibold">Source</dt><dd>{event.ipAddress ?? "unknown address"}{event.userAgent ? <span className="block break-all text-xs text-[color:var(--muted)]">{event.userAgent}</span> : null}</dd></div>
        </dl>
      </section>
      {changes?.length ? (
        <section className="mb-6 max-w-4xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)]">
          <h2 className="p-4 text-base font-semibold">What changed</h2>
          <table className="w-full text-left text-sm">
            <thead><tr className="border-y border-[color:var(--border)] text-xs uppercase text-[color:var(--muted)]"><th className="p-3">Field</th><th className="p-3">Before</th><th className="p-3">After</th></tr></thead>
            <tbody>{changes.map((change) => <tr className="border-b border-[color:var(--border)] last:border-0" key={change.field}><td className="p-3 font-semibold">{humanize(change.field)}</td><td className="p-3">{show(change.from)}</td><td className="p-3">{show(change.to)}</td></tr>)}</tbody>
          </table>
        </section>
      ) : null}
      {Object.keys(context).length ? (
        <section className="max-w-4xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
          <h2 className="mb-3 text-base font-semibold">Details</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {Object.entries(context).map(([key, value]) => <div key={key}><dt className="font-semibold">{humanize(key)}</dt><dd className="break-words">{show(value)}</dd></div>)}
          </dl>
        </section>
      ) : null}
    </>
  );
}
