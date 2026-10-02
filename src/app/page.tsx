import { PageHeader } from "@/components/page-header";
import { ButtonLink, SecondaryLink } from "@/components/ui";
import { getDashboardStats } from "@/modules/people/data";
import { getTaskDashboardStats } from "@/modules/tasks/data";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [stats, taskStats] = await Promise.all([getDashboardStats(), getTaskDashboardStats()]);

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
      <section className="mt-4 grid gap-4 md:grid-cols-4">
        <Metric label="My open tasks" value={taskStats.open} />
        <Metric label="Due soon" value={taskStats.dueSoon} />
        <Metric label="Overdue" value={taskStats.overdue} />
        <Metric label="In progress" value={taskStats.inProgress} />
      </section>
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
          <h2 className="text-base font-semibold">Work management</h2>
          <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
            Track standalone and project work, assignments, due dates,
            subtasks, checklists, comments, and activity without added process.
          </p><div className="mt-4"><SecondaryLink href="/tasks">Open tasks</SecondaryLink></div>
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
