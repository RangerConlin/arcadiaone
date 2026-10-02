import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export default async function ProjectsPage() {
  const actor = await requireAuthenticatedUser();
  const projects = await prisma.project.findMany({ where: { organizationId: actor.organizationId, ...(actor.role === "ADMIN" ? {} : { OR: [{ managerUserId: actor.id }, { members: { some: { employeeId: actor.employeeId ?? "__none__" } } }] }) }, include: { _count: { select: { tasks: true, members: true } } }, orderBy: { name: "asc" } });
  return <><PageHeader description="Projects connect teams, milestones, and operational tasks." title="Projects" /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{projects.map((project) => <Link className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5 hover:border-[color:var(--accent)]" href={`/projects/${project.id}`} key={project.id}><div className="flex justify-between"><h2 className="font-semibold">{project.name}</h2><span className="text-xs">{project.status.replaceAll("_", " ")}</span></div><p className="mt-2 line-clamp-2 text-sm text-[color:var(--muted)]">{project.description || "No description"}</p><p className="mt-4 text-xs text-[color:var(--muted)]">{project._count.tasks} tasks · {project._count.members} members</p></Link>)}{!projects.length && <p className="text-sm text-[color:var(--muted)]">No projects have been created yet. Standalone tasks remain available in Tasks.</p>}</div></>;
}
