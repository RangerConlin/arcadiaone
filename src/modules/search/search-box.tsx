"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

type Hit = { id: string; title: string; subtitle: string; href: string };
type Group = { entity: string; label: string; hits: Hit[] };

/** Header search: Ctrl/Cmd+K focuses it, results are debounced, small and grouped; Enter opens the full page. */
export function GlobalSearchBox() {
  const router = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [fetched, setGroups] = useState<Group[]>([]);
  const groups = query.trim().length >= 2 ? fetched : [];
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const flat = groups.flatMap((group) => group.hits);
  const position = new Map(flat.map((hit, i) => [hit.id, i]));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    const onClick = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onClick); };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/search/suggest?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        if (!response.ok) return;
        setGroups((await response.json()).groups as Group[]);
        setActive(-1);
      } catch { /* aborted or offline: keep the previous results */ }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  const go = (href: string) => { setOpen(false); router.push(href); };
  const submit = () => {
    const trimmed = query.trim();
    if (active >= 0 && flat[active]) return go(flat[active].href);
    if (trimmed) go(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="app-search" ref={root} role="search">
      <input
        aria-controls={listId}
        aria-expanded={open && groups.length > 0}
        aria-label="Search ArcadiaOne"
        autoComplete="off"
        className="w-full rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-sm"
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => Math.min(flat.length - 1, i + 1)); }
          else if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => Math.max(-1, i - 1)); }
          else if (event.key === "Enter") { event.preventDefault(); submit(); }
          else if (event.key === "Escape") { setOpen(false); input.current?.blur(); }
        }}
        placeholder="Search…  (Ctrl/⌘ K)"
        ref={input}
        role="combobox"
        type="search"
        value={query}
      />
      {open && query.trim().length >= 2 && groups.length > 0 ? (
        <div className="app-search-panel" id={listId} role="listbox">
          {groups.map((group) => (
            <section key={group.entity}>
              <h3>{group.label}</h3>
              {group.hits.map((hit) => (
                <a aria-selected={position.get(hit.id) === active} href={hit.href} key={hit.id} onClick={(event) => { event.preventDefault(); go(hit.href); }} role="option">
                  <span className="font-semibold">{hit.title}</span>
                  {hit.subtitle ? <span className="block text-xs text-[color:var(--muted)]">{hit.subtitle}</span> : null}
                </a>
              ))}
            </section>
          ))}
          <a href={`/search?q=${encodeURIComponent(query.trim())}`} onClick={(event) => { event.preventDefault(); go(`/search?q=${encodeURIComponent(query.trim())}`); }} aria-selected={false} role="option">See all results for “{query.trim()}”</a>
        </div>
      ) : null}
    </div>
  );
}
