import { PageHeader } from "@/components/page-header";
import { ButtonLink, SecondaryLink } from "@/components/ui";
import { getDashboardStats } from "@/modules/people/data";
import { getQualificationsOverview } from "@/modules/qualifications/data";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [stats, qualifications] = await Promise.all([getDashboardStats(), getQualificationsOverview()]);
  const expired = qualifications.credentials.filter((item) => item.status === "EXPIRED").length;
  const expiring = qualifications.credentials.filter((item) => item.status === "EXPIRING_SOON").length;
  const missing = qualifications.requirements.filter((item) => item.requirement.status === "MISSING").length;
  const unverified = qualifications.credentials.filter((item) => item.qualification.verificationStatus === "UNVERIFIED").length;

  return (
    <>
      <PageHeader
        actions={<ButtonLink href="/people/new">Add employee</ButtonLink>}
        description="A focused operational view of the ArcadiaOne foundation."
        title="Dashboard"
      />
      <section className="grid gap-4 md:grid-cols-3">
        <Metric label="Active employees" value={stats.activeEmployees} />
        <Metric label="Active departments" value={stats.departments} />
        <Metric label="Active positions" value={stats.positions} />
      </section>
      <section className="mt-6 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">Qualifications attention</h2><p className="mt-1 text-sm text-[color:var(--muted)]">Current organization credential issues.</p></div><SecondaryLink href="/people/qualifications">Open qualifications</SecondaryLink></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Expired" value={expired}/><Metric label="Expiring soon" value={expiring}/><Metric label="Missing required" value={missing}/><Metric label="Awaiting verification" value={unverified}/></div></section>
      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
          <h2 className="text-base font-semibold">People module</h2>
          <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
            Manage employee records, reporting relationships, departments,
            positions, and contact information.
          </p>
          <div className="mt-4">
            <SecondaryLink href="/people">Open people directory</SecondaryLink>
          </div>
        </div>
        <div className="rounded-sm border border-dashed border-[color:var(--border)] bg-[color:var(--panel)] p-5">
          <h2 className="text-base font-semibold">Upcoming modules</h2>
          <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
            Certifications, training, projects, scheduling, documents, and
            reporting will be added in later focused passes.
          </p>
        </div>
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
      <p className="text-sm font-medium text-[color:var(--muted)]">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
    </div>
  );
}
