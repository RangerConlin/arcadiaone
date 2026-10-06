import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { isSearchEntity, MIN_QUERY_LENGTH, normalizeQuery, searchEntity, searchLabel, searchOverview, SEARCH_ENTITIES } from "@/modules/search/service";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; entity?: string; page?: string }> }) {
  const [user, params] = await Promise.all([requireAuthenticatedUser(), searchParams]);
  const q = normalizeQuery(params.q);
  const entity = isSearchEntity(params.entity) ? params.entity : undefined;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const tooShort = q.length < MIN_QUERY_LENGTH;
  const overview = !tooShort && !entity ? await searchOverview(user, q, 8) : [];
  const single = !tooShort && entity ? await searchEntity(user, entity, q, page, PAGE_SIZE) : null;
  const totals = new Map(overview.map((group) => [group.entity, group.total]));
  const href = (extra: Record<string, string | undefined>) => {
    const query = new URLSearchParams({ q, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v)) as Record<string, string> });
    return `/search?${query.toString()}`;
  };

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Search" }]} description="Results only include records you are allowed to open." title={q ? `Search: ${q}` : "Search"} />
      <form action="/search" className="mb-4 flex flex-wrap gap-2" role="search">
        <input aria-label="Search term" className="min-w-64 flex-1 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-2 text-sm" defaultValue={q} name="q" placeholder="Name, number, title…" type="search" />
        <select aria-label="Record type" className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-2 text-sm" defaultValue={entity ?? ""} name="entity">
          <option value="">All record types</option>
          {SEARCH_ENTITIES.map((key) => <option key={key} value={key}>{searchLabel(key)}</option>)}
        </select>
        <button className="rounded-sm bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white" type="submit">Search</button>
      </form>
      {tooShort ? <p className="text-sm text-[color:var(--muted)]">Enter at least {MIN_QUERY_LENGTH} characters.</p> : null}

      {!tooShort && !entity ? (
        overview.length ? (
          <div className="grid gap-5">
            {overview.map((group) => (
              <section className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4" key={group.entity}>
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-base font-semibold">{group.label} <span className="text-sm font-normal text-[color:var(--muted)]">({totals.get(group.entity)})</span></h2>
                  {group.total > group.hits.length ? <Link className="text-sm underline" href={href({ entity: group.entity })}>View all {group.total}</Link> : null}
                </div>
                <ul className="mt-2 divide-y divide-[color:var(--border)]">{group.hits.map((hit) => <HitRow hit={hit} key={hit.id} />)}</ul>
              </section>
            ))}
          </div>
        ) : <p className="text-sm">No results for “{q}”.</p>
      ) : null}

      {single ? (
        <section className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4">
          <h2 className="text-base font-semibold">{single.label} <span className="text-sm font-normal text-[color:var(--muted)]">({single.total})</span></h2>
          {single.hits.length ? <ul className="mt-2 divide-y divide-[color:var(--border)]">{single.hits.map((hit) => <HitRow hit={hit} key={hit.id} />)}</ul> : <p className="mt-2 text-sm">No results for “{q}”.</p>}
          {single.total > PAGE_SIZE ? (
            <div className="mt-3 flex items-center justify-between text-sm">
              {page > 1 ? <Link className="underline" href={href({ entity, page: String(page - 1) })}>← Previous</Link> : <span />}
              <span>Page {page} of {Math.ceil(single.total / PAGE_SIZE)}</span>
              {page * PAGE_SIZE < single.total ? <Link className="underline" href={href({ entity, page: String(page + 1) })}>Next →</Link> : <span />}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function HitRow({ hit }: { hit: { title: string; subtitle: string; href: string; exact: boolean } }) {
  return (
    <li className="py-2">
      <Link className="font-semibold text-[color:var(--accent)] underline" href={hit.href}>{hit.title}</Link>
      {hit.exact ? <span className="ml-2 text-xs uppercase text-[color:var(--muted)]">exact match</span> : null}
      {hit.subtitle ? <p className="text-sm text-[color:var(--muted)]">{hit.subtitle}</p> : null}
    </li>
  );
}
