import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ButtonLink, StatusBadge, inputClass } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { TASK_PRIORITIES, TASK_STATUSES, isOverdue } from "@/modules/tasks/constants";
import { getTaskOptions, listTasks } from "@/modules/tasks/data";

export const dynamic = "force-dynamic";
const label = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/^./, (x) => x.toUpperCase());
export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams; const [{ tasks, total, page, pageSize }, options] = await Promise.all([listTasks(params), getTaskOptions()]);
  return <><PageHeader actions={<ButtonLink href="/tasks/new">New task</ButtonLink>} description="Operational work, whether it belongs to a project or stands on its own." title="Tasks" />
    <div className="mb-4 flex flex-wrap gap-2 text-sm"><Link className="rounded-sm border px-3 py-2" href="/tasks?scope=mine">Assigned to me</Link><Link className="rounded-sm border px-3 py-2" href="/tasks?due=soon">Due soon</Link><Link className="rounded-sm border px-3 py-2" href="/tasks?due=overdue">Overdue</Link><Link className="rounded-sm border px-3 py-2" href="/tasks?status=IN_PROGRESS">In progress</Link><Link className="rounded-sm border px-3 py-2" href="/tasks?status=COMPLETED">Completed</Link></div>
    <form className="mb-5 grid gap-3 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4 md:grid-cols-5">
      <input className={inputClass} defaultValue={typeof params.q === "string" ? params.q : ""} name="q" placeholder="Search tasks" />
      <select className={inputClass} defaultValue={params.status as string} name="status"><option value="">All statuses</option>{TASK_STATUSES.map((x) => <option key={x} value={x}>{label(x)}</option>)}</select>
      <select className={inputClass} defaultValue={params.priority as string} name="priority"><option value="">All priorities</option>{TASK_PRIORITIES.map((x) => <option key={x} value={x}>{label(x)}</option>)}</select>
      <select className={inputClass} defaultValue={params.project as string} name="project"><option value="">All projects</option>{options.projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <button className="rounded-sm bg-[color:var(--accent)] px-4 py-2 font-semibold text-white">Apply filters</button>
    </form>
    <div className="overflow-x-auto rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)]"><table className="w-full text-left text-sm"><thead className="border-b border-[color:var(--border)] text-[color:var(--muted)]"><tr>{["Task", "Status", "Priority", "Assignee", "Project", "Due date"].map((x) => <th className="px-4 py-3" key={x}>{x}</th>)}</tr></thead><tbody>{tasks.map((task) => <tr className="border-b border-[color:var(--border)] last:border-0" key={task.id}><td className="px-4 py-3"><Link className="font-semibold text-[color:var(--accent)]" href={`/tasks/${task.id}`}>{task.title}</Link></td><td className="px-4 py-3"><StatusBadge status={task.status} /></td><td className="px-4 py-3">{label(task.priority)}</td><td className="px-4 py-3">{task.assignedTo ? `${task.assignedTo.preferredName || task.assignedTo.firstName} ${task.assignedTo.lastName}` : "Unassigned"}</td><td className="px-4 py-3">{task.project?.name ?? "Standalone"}</td><td className={`px-4 py-3 ${isOverdue(task) ? "font-semibold text-[color:var(--danger)]" : ""}`}>{formatDate(task.dueDate)}{isOverdue(task) ? " · Overdue" : ""}</td></tr>)}</tbody></table>{!tasks.length && <p className="p-8 text-center text-sm text-[color:var(--muted)]">No tasks match these filters.</p>}</div>
    <p className="mt-3 text-sm text-[color:var(--muted)]">Showing {(page - 1) * pageSize + (tasks.length ? 1 : 0)}–{(page - 1) * pageSize + tasks.length} of {total}</p>
  </>;
}
