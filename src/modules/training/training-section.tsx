import Link from "next/link";
import { StatusBadge } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { dateKeyUtc, formatDayKey } from "@/lib/datetime";
import { Prisma } from "@/generated/prisma/client";
import { canSubmitRecordFor, canViewEmployeeTraining } from "./authorization";
import { employeeHistory } from "./data";

/** Employee profile section: completed training (sessions and external), hours, verification, linked qualification. */
export async function TrainingSection({ employeeId }: { employeeId: string }) {
  const user = await requireAuthenticatedUser();
  if (!canViewEmployeeTraining(user, employeeId)) return null;
  const items = await employeeHistory(user, employeeId);
  const hours = items.reduce((sum, item) => sum.plus(item.hours ?? 0), new Prisma.Decimal(0));
  const verifiedHours = items.filter((i) => i.verification !== "Awaiting verification" && i.verification !== "Rejected").reduce((sum, item) => sum.plus(item.hours ?? 0), new Prisma.Decimal(0));
  return (
    <section className="mt-5 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Training</h2>
          <p className="text-sm text-[color:var(--muted)]">{items.length} record{items.length === 1 ? "" : "s"} · {hours.toFixed(2)} h total · {verifiedHours.toFixed(2)} h verified or staff-recorded</p>
        </div>
        {canSubmitRecordFor(user, employeeId) ? <Link className="text-sm font-semibold text-[color:var(--accent)]" href={`/training/records/new?employee=${employeeId}`}>Submit external training</Link> : null}
      </div>
      {items.length === 0 ? <p className="text-sm text-[color:var(--muted)]">No training recorded.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-[color:var(--border)] text-xs uppercase text-[color:var(--muted)]"><th className="p-2">Course</th><th className="p-2">Provider</th><th className="p-2">Completed</th><th className="p-2 text-right">Hours</th><th className="p-2">Verification</th><th className="p-2">Related qualification</th><th className="p-2">Documents</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr className="border-b border-[color:var(--border)] last:border-0" key={item.key}>
                  <td className="p-2"><Link className="font-semibold text-[color:var(--accent)]" href={item.href}>{item.course}</Link></td>
                  <td className="p-2">{item.provider ?? "—"}</td>
                  <td className="p-2 whitespace-nowrap">{formatDayKey(dateKeyUtc(item.completionDate), { month: "short", day: "numeric", year: "numeric" })}</td>
                  <td className="p-2 text-right tabular-nums">{item.hours ? item.hours.toFixed(2) : "—"}</td>
                  <td className="p-2">{item.kind === "External" ? <StatusBadge status={item.verification === "Verified" ? "verified" : item.verification === "Rejected" ? "rejected" : "pending"} /> : "Recorded by staff"}</td>
                  <td className="p-2">{item.qualification ?? "—"}</td>
                  <td className="p-2">{item.documents || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
