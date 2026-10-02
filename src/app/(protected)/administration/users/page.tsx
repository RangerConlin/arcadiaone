import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ButtonLink, Notice, StatusBadge } from "@/components/ui";
import { formatDate, formatName } from "@/lib/format";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function UsersPage({ searchParams }: { searchParams?: Promise<Record<string,string|undefined>> }) {
 const admin=await requireRole("ADMIN"); const query=(await searchParams)??{};
 const users=await prisma.user.findMany({where:{organizationId:admin.organizationId},include:{employee:true},orderBy:{email:"asc"}});
 return <><PageHeader actions={<ButtonLink href="/administration/users/new">Create user</ButtonLink>} breadcrumbs={[{label:"Dashboard",href:"/"},{label:"Administration",href:"/administration"},{label:"Users"}]} description="Manage account access, roles, and password resets." title="Users"/><Notice message={query.success} tone="success"/>
 <div className="overflow-x-auto rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)]"><table className="w-full min-w-[800px] text-left text-sm"><thead className="border-b border-[color:var(--border)] text-xs uppercase text-[color:var(--muted)]"><tr><th className="p-4">Email</th><th>Employee</th><th>Role</th><th>Status</th><th>Last login</th><th>Actions</th></tr></thead><tbody>{users.map(user=><tr className="border-b border-[color:var(--border)] last:border-0" key={user.id}><td className="p-4 font-semibold">{user.email}</td><td>{user.employee?formatName(user.employee):"Not linked"}</td><td>{user.role}</td><td><StatusBadge status={user.active?"ACTIVE":"INACTIVE"}/></td><td>{formatDate(user.lastLoginAt)}</td><td><Link className="text-[color:var(--accent)] hover:underline" href={`/administration/users/${user.id}`}>Manage</Link></td></tr>)}</tbody></table></div></>;
}
