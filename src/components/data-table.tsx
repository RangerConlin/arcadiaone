import Link from "next/link";

const frame = "overflow-x-auto rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)]";

export function DataTable({ columns, children, empty }: { columns: Array<{ label: string; align?: "right" }>; children: React.ReactNode; empty?: string }) {
  return (
    <div className={frame}>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[color:var(--border)] text-xs uppercase text-[color:var(--muted)]">
            {columns.map((column) => <th className={`p-3 ${column.align === "right" ? "text-right" : ""}`} key={column.label} scope="col">{column.label}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty ? <p className="p-6 text-center text-sm text-[color:var(--muted)]">{empty}</p> : null}
    </div>
  );
}

export const rowClass = "border-b border-[color:var(--border)] last:border-0";

/** Previous/next pager that preserves every other query parameter. */
export function Pager({ page, pages, total, params, basePath, pageSize }: { page: number; pages: number; total: number; params: Record<string, string | undefined>; basePath: string; pageSize: number }) {
  const href = (target: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value && key !== "page") query.set(key, value);
    if (target > 1) query.set("page", String(target));
    const text = query.toString();
    return text ? `${basePath}?${text}` : basePath;
  };
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="cal-pager">
      {page > 1 ? <Link className="cal-btn" href={href(page - 1)}>Previous</Link> : <span />}
      <span>{first}–{last} of {total} · page {page} of {pages}</span>
      {page < pages ? <Link className="cal-btn" href={href(page + 1)}>Next</Link> : <span />}
    </nav>
  );
}
