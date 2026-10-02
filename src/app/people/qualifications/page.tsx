import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { inputClass } from "@/components/ui";
import { getCurrentOrganization } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import {
  getQualificationTypes,
  getQualificationsOverview,
} from "@/modules/qualifications/data";
import { statusLabel } from "@/modules/qualifications/status";

export const dynamic = "force-dynamic";

export default async function QualificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const filters = await searchParams;
  const organization = await getCurrentOrganization();
  const [data, types, departments, positions] = await Promise.all([
    getQualificationsOverview(filters),
    getQualificationTypes(),
    prisma.department.findMany({
      where: { organizationId: organization.id, active: true },
      orderBy: { name: "asc" },
    }),
    prisma.position.findMany({
      where: { organizationId: organization.id, active: true },
      orderBy: { title: "asc" },
    }),
  ]);
  const expired = data.credentials.filter((item) => item.status === "EXPIRED").length;
  const expiring = data.credentials.filter(
    (item) => item.status === "EXPIRING_SOON",
  ).length;
  const unverified = data.credentials.filter(
    (item) => item.qualification.verificationStatus === "UNVERIFIED",
  ).length;
  const missing = data.requirements.filter(
    (item) => item.requirement.status === "MISSING",
  ).length;
  const requirementIssues = data.requirements.filter(
    (item) => !["CURRENT", "NO_EXPIRATION"].includes(item.requirement.status),
  );

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "People", href: "/people" },
          { label: "Qualifications" },
        ]}
        description="Credential issues requiring operational attention."
        title="Qualifications"
      />
      <section className="mb-5 grid gap-3 sm:grid-cols-4">
        <Metric label="Expired" value={expired} />
        <Metric label="Expiring soon" value={expiring} />
        <Metric label="Missing required" value={missing} />
        <Metric label="Awaiting verification" value={unverified} />
      </section>
      <form className="mb-5 grid gap-3 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4 md:grid-cols-3 xl:grid-cols-6">
        <input
          className={inputClass}
          defaultValue={filters.employee}
          name="employee"
          placeholder="Employee name"
        />
        <FilterSelect defaultValue={filters.qualification} name="qualification">
          <option value="">All qualifications</option>
          {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
        </FilterSelect>
        <FilterSelect defaultValue={filters.department} name="department">
          <option value="">All departments</option>
          {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
        </FilterSelect>
        <FilterSelect defaultValue={filters.position} name="position">
          <option value="">All positions</option>
          {positions.map((position) => <option key={position.id} value={position.id}>{position.title}</option>)}
        </FilterSelect>
        <FilterSelect defaultValue={filters.status} name="status">
          <option value="">All expiration states</option>
          <option value="CURRENT">Current</option>
          <option value="EXPIRING_SOON">Expiring soon</option>
          <option value="EXPIRED">Expired</option>
          <option value="NO_EXPIRATION">No expiration</option>
        </FilterSelect>
        <FilterSelect defaultValue={filters.verification} name="verification">
          <option value="">All verification states</option>
          <option value="UNVERIFIED">Unverified</option>
          <option value="VERIFIED">Verified</option>
          <option value="REJECTED">Rejected</option>
        </FilterSelect>
        <button className="rounded-sm bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white md:col-span-3 xl:col-span-6">
          Apply filters
        </button>
      </form>
      <section className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)]">
        <h2 className="border-b border-[color:var(--border)] p-4 font-semibold">Credential records</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="text-xs uppercase text-[color:var(--muted)]"><th className="p-3">Employee</th><th className="p-3">Qualification</th><th className="p-3">Department / Position</th><th className="p-3">Expiration</th><th className="p-3">Verification</th></tr></thead>
            <tbody>{data.credentials.map(({ employee, qualification, status }) => (
              <tr className="border-t border-[color:var(--border)]" key={qualification.id}>
                <td className="p-3"><Link className="font-medium text-[color:var(--accent)] underline" href={`/people/${employee.id}`}>{employee.firstName} {employee.lastName}</Link></td>
                <td className="p-3">{qualification.qualificationType.name}</td>
                <td className="p-3">{employee.department?.name || "—"} / {employee.position?.title || "—"}</td>
                <td className="p-3">● {statusLabel[status]}</td>
                <td className="p-3">{qualification.verificationStatus}</td>
              </tr>
            ))}</tbody>
          </table>
          {!data.credentials.length && <p className="p-5 text-sm text-[color:var(--muted)]">No matching credential records.</p>}
        </div>
      </section>
      <section className="mt-5 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)]">
        <h2 className="border-b border-[color:var(--border)] p-4 font-semibold">Required qualification issues</h2>
        <ul>{requirementIssues.map(({ employee, requirement }) => (
          <li className="flex justify-between border-b border-[color:var(--border)] p-3 text-sm last:border-0" key={`${employee.id}-${requirement.qualificationTypeId}`}>
            <span>{employee.firstName} {employee.lastName} — {requirement.qualificationType.name}</span>
            <strong>● {statusLabel[requirement.status]}</strong>
          </li>
        ))}</ul>
        {!requirementIssues.length && <p className="p-5 text-sm text-[color:var(--muted)]">No matching required qualification issues.</p>}
      </section>
    </>
  );
}

function FilterSelect({ children, defaultValue, name }: { children: React.ReactNode; defaultValue?: string; name: string }) {
  return <select className={inputClass} defaultValue={defaultValue} name={name}>{children}</select>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4"><p className="text-xs font-semibold uppercase text-[color:var(--muted)]">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>;
}
