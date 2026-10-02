"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavIcon = "home" | "people" | "projects" | "clients" | "rentals" | "tasks" | "calendar" | "reports" | "documents" | "admin";
export type NavSub = { label: string; href: string };
export type NavModule = { id: string; label: string; railLabel?: string; icon: NavIcon; href: string; prefix: string; subs: NavSub[] };

const icons: Record<NavIcon, string> = {
  home: "M3 11 12 3l9 8v10h-6v-6H9v6H3z",
  people: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M17 4.5a3 3 0 0 1 0 5.5M21 19v-1a4 4 0 0 0-3-3.8",
  projects: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  clients: "M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18",
  rentals: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  tasks: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9",
  calendar: "M7 3v4M17 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  reports: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  documents: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6",
  admin: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4",
};

function Icon({ name }: { name: NavIcon }) {
  return (
    <svg aria-hidden="true" className="rail-icon" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d={icons[name]} />
    </svg>
  );
}

const matches = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

function resolve(pathname: string, modules: NavModule[]) {
  let found: NavModule | undefined;
  let sub: NavSub | undefined;
  let best = -1;
  for (const candidate of modules) {
    for (const item of candidate.subs) {
      if (matches(pathname, item.href) && item.href.length > best) {
        best = item.href.length;
        found = candidate;
        sub = item;
      }
    }
  }
  if (!found) {
    for (const candidate of modules) {
      if (matches(pathname, candidate.prefix) && candidate.prefix.length > best) {
        best = candidate.prefix.length;
        found = candidate;
      }
    }
  }
  return { module: found, sub };
}

export function RailNav({ modules }: { modules: NavModule[] }) {
  const pathname = usePathname();
  const { module: active } = resolve(pathname, modules);
  return (
    <nav aria-label="Modules" className="app-rail">
      <Link aria-label="ArcadiaOne home" className="rail-logo" href="/">
        <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" viewBox="0 0 24 24">
          <path d="M5 20 12 4l7 16M8.5 14.5h7" />
        </svg>
      </Link>
      {modules.map((item) => (
        <Link aria-current={active?.id === item.id ? "page" : undefined} className="rail-link" data-module={item.id} href={item.href} key={item.id}>
          <Icon name={item.icon} />
          <span>{item.railLabel ?? item.label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function PanelNav({ modules }: { modules: NavModule[] }) {
  const pathname = usePathname();
  const { module: active, sub } = resolve(pathname, modules);
  const current = active ?? modules[0];
  if (!current || current.subs.length < 2) return null;
  return (
    <aside aria-label={`${current.label} sections`} className="app-panel">
      <h2 className="panel-title">{current.label}</h2>
      <nav className="panel-links">
        {current.subs.map((item) => (
          <Link aria-current={sub?.href === item.href ? "page" : undefined} className="panel-link" href={item.href} key={item.href}>
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
