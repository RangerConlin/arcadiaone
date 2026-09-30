import Link from "next/link";

export function ButtonLink({
  children,
  href,
}: {
  children: React.ReactNode;
  href: string;
}) {
  return (
    <Link
      className="inline-flex items-center justify-center rounded-sm bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus:outline-2 focus:outline-offset-2"
      href={href}
    >
      {children}
    </Link>
  );
}

export function SecondaryLink({
  children,
  href,
}: {
  children: React.ReactNode;
  href: string;
}) {
  return (
    <Link
      className="inline-flex items-center justify-center rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-2 text-sm font-semibold hover:border-[color:var(--accent)]"
      href={href}
    >
      {children}
    </Link>
  );
}

export function SubmitButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      className="inline-flex items-center justify-center rounded-sm bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus:outline-2 focus:outline-offset-2"
      type="submit"
    >
      {children}
    </button>
  );
}

export function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-2 text-sm text-[color:var(--foreground)] shadow-sm focus:border-[color:var(--accent)] focus:outline-2 focus:outline-offset-1";

export function StatusBadge({ status }: { status: string }) {
  const label = status.toLowerCase().replace("_", " ");
  return (
    <span className="inline-flex rounded-sm border border-[color:var(--border)] px-2 py-1 text-xs font-semibold capitalize">
      {label}
    </span>
  );
}

export function Notice({
  message,
  tone = "info",
}: {
  message?: string;
  tone?: "info" | "error" | "success";
}) {
  if (!message) {
    return null;
  }

  const color =
    tone === "error"
      ? "text-[color:var(--danger)]"
      : tone === "success"
        ? "text-[color:var(--success)]"
        : "text-[color:var(--muted)]";

  return (
    <div className={`mb-4 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3 text-sm ${color}`}>
      {message}
    </div>
  );
}
