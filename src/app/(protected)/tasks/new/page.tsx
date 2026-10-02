import { PageHeader } from "@/components/page-header";
import { Notice } from "@/components/ui";
import { createTask } from "@/modules/tasks/actions";
import { getTaskOptions } from "@/modules/tasks/data";
import { TaskForm } from "@/modules/tasks/task-form";

export const dynamic = "force-dynamic";
export default async function NewTaskPage({ searchParams }: { searchParams: Promise<{ projectId?: string; parentId?: string; error?: string }> }) {
  const params = await searchParams; const options = await getTaskOptions();
  return <><PageHeader title={params.parentId ? "Add subtask" : "New task"} description="Create standalone operational work or connect it to a project." /><Notice message={params.error} tone="error" /><section className="max-w-4xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5"><TaskForm action={createTask} defaultProjectId={params.projectId} options={options} parentId={params.parentId} submitLabel="Create task" /></section></>;
}
