import Link from "next/link";

export function PageHeader({
  actions,
  breadcrumbs,
  description,
  hero,
  title,
}: {
  actions?: React.ReactNode;
  breadcrumbs?: Array<{ href?: string; label: string }>;
  description?: string;
  hero?: boolean;
  title: string;
}) {
  return (
    <div className={["page-header flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between", hero ? "page-hero" : ""].join(" ")}>
      <div>
        {breadcrumbs ? (
          <nav className="mb-2 flex flex-wrap gap-2 text-sm text-[color:var(--muted)]">
            {breadcrumbs.map((item, index) => (
              <span className="flex items-center gap-2" key={item.label}>
                {index > 0 ? <span>/</span> : null}
                {item.href ? (
                  <Link className="hover:text-[color:var(--accent)]" href={item.href}>
                    {item.label}
                  </Link>
                ) : (
                  <span>{item.label}</span>
                )}
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="page-title">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--muted)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
