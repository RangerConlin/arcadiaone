import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ButtonLink, Notice, SecondaryLink, StatusBadge } from "@/components/ui";
import { formatDate, formatFullName, formatName } from "@/lib/format";
import { getEmployee } from "@/modules/people/data";
import { archiveEmployeeQualification, reviewQualification } from "@/modules/qualifications/actions";
import { getEmployeeQualifications } from "@/modules/qualifications/data";
import { statusLabel } from "@/modules/qualifications/status";
import { canEditEmployee, requireAuthenticatedUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function EmployeeProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const employee = await getEmployee(id);
  const user = await requireAuthenticatedUser();

  if (!employee) {
    notFound();
  }

  const canEdit = await canEditEmployee(user, employee.id);
  const qualificationData = await getEmployeeQualifications(employee.id);

  return (
    <>
      <PageHeader
        actions={
          <>
            {user.role !== "EMPLOYEE" ? <SecondaryLink href="/people">Back to directory</SecondaryLink> : null}
            {canEdit ? <ButtonLink href={`/people/${employee.id}/edit`}>Edit employee</ButtonLink> : null}
          </>
        }
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "People", href: "/people" },
          { label: formatName(employee) },
        ]}
        description="Employee profile and foundational employment details."
        title={formatName(employee)}
      />
      <Notice message={query.success} tone="success" />
      <section className="grid gap-5 xl:grid-cols-[2fr_1fr]">
        <div className="grid gap-5">
          <Panel title="Overview">
            <Description label="Legal name" value={formatFullName(employee)} />
            <Description label="Employee #" value={employee.employeeNumber || "Not set"} />
            <Description label="Status" value={<StatusBadge status={employee.employmentStatus} />} />
            <Description label="Position" value={employee.position?.title || "Not assigned"} />
            <Description label="Department" value={employee.department?.name || "Not assigned"} />
          </Panel>
          <Panel title="Employment">
            <Description label="Supervisor" value={employee.supervisor ? formatName(employee.supervisor) : "None"} />
            <Description label="Hire date" value={formatDate(employee.hireDate)} />
            <Description label="Separation date" value={formatDate(employee.separationDate)} />
            <Description label="Direct reports" value={`${employee.directReports.length}`} />
          </Panel>
          <Panel title="Contact">
            <Description label="Work email" value={employee.workEmail || "Not set"} />
            <Description label="Personal email" value={employee.personalEmail || "Not set"} />
            <Description label="Work phone" value={employee.workPhone || "Not set"} />
            <Description label="Mobile phone" value={employee.mobilePhone || "Not set"} />
          </Panel>
          <Panel title="Notes">
            <p className="whitespace-pre-wrap text-sm leading-6 text-[color:var(--muted)]">
              {employee.notes || "No notes recorded."}
            </p>
          </Panel>
          <section className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
            <div className="mb-4 flex items-center justify-between"><div><h2 className="text-base font-semibold">Qualifications</h2><p className="text-sm text-[color:var(--muted)]">Credentials held and position requirements.</p></div>{canEdit ? <ButtonLink href={`/people/${employee.id}/qualifications/new`}>Add qualification</ButtonLink> : null}</div>
            <div className="grid gap-3">
              {qualificationData?.qualifications.map((item) => <article className="rounded-sm border border-[color:var(--border)] p-4" key={item.id}>
                <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">{item.qualificationType.name}</h3><p className="text-xs text-[color:var(--muted)]">{item.qualificationType.category} · {item.credentialNumber || "No credential number"}</p></div><div className="flex gap-2"><QualificationBadge text={statusLabel[item.status]} /><QualificationBadge text={item.verificationStatus[0]+item.verificationStatus.slice(1).toLowerCase()} /></div></div>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><Description label="Issuer" value={item.issuingOrganization || item.qualificationType.issuingOrganization || "Not set"}/><Description label="Issued" value={formatDate(item.issueDate)}/><Description label="Expires" value={item.expirationDate ? formatDate(item.expirationDate) : "Does not expire"}/></dl>
                <p className="mt-2 text-xs text-[color:var(--muted)]">Documents: {item.documents.length}{item.verificationNote ? ` · Review note: ${item.verificationNote}` : ""}</p>
                {canEdit ? <div className="mt-3 flex flex-wrap gap-2"><SecondaryLink href={`/people/${employee.id}/qualifications/${item.id}/edit`}>Edit</SecondaryLink><form action={reviewQualification}><input name="id" type="hidden" value={item.id}/><input name="employeeId" type="hidden" value={employee.id}/><button className="rounded-sm border border-[color:var(--border)] px-3 py-2 text-sm" name="status" value="VERIFIED">Verify</button><button className="ml-2 rounded-sm border border-[color:var(--border)] px-3 py-2 text-sm" name="status" value="REJECTED">Reject</button></form><form action={archiveEmployeeQualification}><input name="id" type="hidden" value={item.id}/><input name="employeeId" type="hidden" value={employee.id}/><button className="rounded-sm border border-[color:var(--border)] px-3 py-2 text-sm">Archive</button></form></div> : null}
              </article>)}
              {!qualificationData?.qualifications.length && <p className="rounded-sm border border-dashed border-[color:var(--border)] p-5 text-sm text-[color:var(--muted)]">No qualifications recorded.</p>}
            </div>
            {!!qualificationData?.requirements.length && <div className="mt-5"><h3 className="mb-2 text-sm font-semibold">Position requirements</h3><ul className="grid gap-2">{qualificationData.requirements.map((item)=><li className="flex justify-between rounded-sm bg-[color:var(--background)] p-3 text-sm" key={item.qualificationTypeId}><span>{String((item as { qualificationType?: { name: string } }).qualificationType?.name ?? item.qualificationTypeId)} {!item.required && "(Preferred)"}</span><QualificationBadge text={statusLabel[item.status]}/></li>)}</ul></div>}
          </section>
        </div>
        <aside className="rounded-sm border border-dashed border-[color:var(--border)] bg-[color:var(--panel)] p-5">
          <h2 className="text-base font-semibold">Future profile areas</h2>
          <div className="mt-4 grid gap-2 text-sm text-[color:var(--muted)]">
            <span>Training</span>
            <span>Projects</span>
            <span>Documents</span>
          </div>
        </aside>
      </section>
    </>
  );
}

function QualificationBadge({text}:{text:string}) { return <span className="inline-flex rounded-full border border-[color:var(--border)] bg-[color:var(--background)] px-2 py-1 text-xs font-semibold">● {text}</span>; }

function Panel({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      <dl className="grid gap-3 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function Description({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-[color:var(--muted)]">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}
