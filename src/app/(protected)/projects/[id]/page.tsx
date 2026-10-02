import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ButtonLink, StatusBadge, inputClass } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/modules/tasks/constants";
import { listTasks } from "@/modules/tasks/data";

export const dynamic = "force-dynamic";
export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params; const query = await searchParams; const actor = await requireAuthenticatedUser();
  const project = await prisma.project.findFirst({ where: { id, organizationId: actor.organizationId, ...(actor.role === "ADMIN" ? {} : { OR: [{ managerUserId: actor.id }, { members: { some: { employeeId: actor.employeeId ?? "__none__" } } }] }) }, include: { milestones: { include: { tasks: { select: { status: true } } }, orderBy: { sortOrder: "asc" } }, members: { include: { employee: true } } } }); if (!project) notFound();
  const { tasks } = await listTasks(query, id);
  return <><PageHeader actions={<ButtonLink href={`/tasks/new?projectId=${id}`}>Add project task</ButtonLink>} description={project.description ?? "Project workspace"} title={project.name} />
    <section className="mb-6 grid gap-3 md:grid-cols-3">{project.milestones.map((milestone) => { const done = milestone.tasks.filter((x) => x.status === "COMPLETED").length; const percent = milestone.tasks.length ? Math.round(done / milestone.tasks.length * 100) : 0; return <div className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4" key={milestone.id}><div className="flex justify-between"><h2 className="font-semibold">{milestone.name}</h2><span className="text-sm">{percent}%</span></div><p className="mt-2 text-xs text-[color:var(--muted)]">{done} of {milestone.tasks.length} linked tasks complete · due {formatDate(milestone.dueDate)}</p><div className="mt-3 h-1.5 bg-[color:var(--border)]"><div className="h-full bg-[color:var(--accent)]" style={{ width: `${percent}%` }} /></div></div>; })}</section>
    <div className="mb-3"><h2 className="text-lg font-semibold">Tasks</h2><p className="text-sm text-[color:var(--muted)]">Filter and open the day-to-day work for this project.</p></div>
    <form className="mb-4 grid gap-3 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4 md:grid-cols-4"><select className={inputClass} name="status" defaultValue={query.status as string}><option value="">All statuses</option>{TASK_STATUSES.map((x) => <option key={x}>{x.replaceAll("_", " ")}</option>)}</select><select className={inputClass} name="priority" defaultValue={query.priority as string}><option value="">All priorities</option>{TASK_PRIORITIES.map((x) => <option key={x}>{x}</option>)}</select><select className={inputClass} name="assignee" defaultValue={query.assignee as string}><option value="">All assignees</option>{project.members.map((x) => <option key={x.employeeId} value={x.employeeId}>{x.employee.firstName} {x.employee.lastName}</option>)}</select><button className="rounded-sm bg-[color:var(--accent)] px-4 py-2 font-semibold text-white">Filter tasks</button></form>
    <div className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)]">{tasks.map((task) => <Link className="grid gap-2 border-b border-[color:var(--border)] p-4 last:border-0 md:grid-cols-[1fr_auto_auto_auto] md:items-center" href={`/tasks/${task.id}`} key={task.id}><strong>{task.title}</strong><StatusBadge status={task.status} /><span className="text-sm">{task.assignedTo ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}` : "Unassigned"}</span><span className="text-sm">{formatDate(task.dueDate)}</span></Link>)}{!tasks.length && <p className="p-6 text-sm text-[color:var(--muted)]">No project tasks match these filters.</p>}</div>
  </>;
}
