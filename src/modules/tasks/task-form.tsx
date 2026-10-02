import { Field, SubmitButton, inputClass } from "@/components/ui";
import { TASK_PRIORITIES, TASK_STATUSES } from "./constants";

type OptionData = Awaited<ReturnType<typeof import("./data").getTaskOptions>>;
type TaskValue = { id?: string; title?: string; description?: string | null; status?: string; priority?: string; assignedToEmployeeId?: string | null; projectId?: string | null; milestoneId?: string | null; parentTaskId?: string | null; startDate?: Date | null; dueDate?: Date | null };
const dateValue = (date?: Date | null) => date?.toISOString().slice(0, 10) ?? "";
const label = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());

export function TaskForm({ action, options, task = {}, defaultProjectId, parentId, submitLabel }: { action: (data: FormData) => void | Promise<void>; options: OptionData; task?: TaskValue; defaultProjectId?: string; parentId?: string; submitLabel: string }) {
  const projectId = task.projectId ?? defaultProjectId ?? "";
  return <form action={action} className="space-y-5">
    {task.id && <input name="id" type="hidden" value={task.id} />}
    {parentId && <input name="parentTaskId" type="hidden" value={parentId} />}
    <Field label="Title"><input className={inputClass} defaultValue={task.title} maxLength={200} name="title" required /></Field>
    <Field label="Description"><textarea className={`${inputClass} min-h-24`} defaultValue={task.description ?? ""} maxLength={5000} name="description" /></Field>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Status"><select className={inputClass} defaultValue={task.status ?? "TODO"} name="status">{TASK_STATUSES.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></Field>
      <Field label="Priority"><select className={inputClass} defaultValue={task.priority ?? "NORMAL"} name="priority">{TASK_PRIORITIES.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></Field>
      <Field label="Assignee"><select className={inputClass} defaultValue={task.assignedToEmployeeId ?? ""} name="assignedToEmployeeId"><option value="">Unassigned</option>{options.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.preferredName || employee.firstName} {employee.lastName}</option>)}</select></Field>
      <Field label="Project"><select className={inputClass} defaultValue={projectId} name="projectId"><option value="">Standalone task</option>{options.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>
      <Field label="Milestone"><select className={inputClass} defaultValue={task.milestoneId ?? ""} name="milestoneId"><option value="">No milestone</option>{options.projects.flatMap((project) => project.milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{project.name} — {milestone.name}</option>))}</select></Field>
      <Field label="Start date"><input className={inputClass} defaultValue={dateValue(task.startDate)} name="startDate" type="date" /></Field>
      <Field label="Due date"><input className={inputClass} defaultValue={dateValue(task.dueDate)} name="dueDate" type="date" /></Field>
    </div>
    <SubmitButton>{submitLabel}</SubmitButton>
  </form>;
}
