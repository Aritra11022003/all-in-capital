"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import {
  BookOpenCheck,
  Briefcase,
  CalendarClock,
  FileText,
  FlaskConical,
  Gavel,
  History,
  Inbox,
  LayoutDashboard,
  Search,
  Settings,
  SlidersHorizontal,
  Loader2,
  CheckCircle2,
  XCircle,
  Info,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { ROLE_INFO } from "@/lib/domain/permissions";
import type { Role } from "@/lib/shared/types";
import { cx } from "./ui";

export const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/applications", label: "Applications", icon: Inbox },
  { href: "/research", label: "Research", icon: Search },
  { href: "/thesis", label: "Thesis & Scoring", icon: SlidersHorizontal },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/reports", label: "Investment Reports", icon: FileText },
  { href: "/learning", label: "Learning & Feedback", icon: BookOpenCheck },
  { href: "/decisions", label: "Partner Decisions", icon: Gavel },
  { href: "/scheduling", label: "Scheduling", icon: CalendarClock },
  { href: "/backtesting", label: "Backtesting", icon: History },
  { href: "/admin", label: "Administration", icon: Settings },
];

export function useHydrated() {
  return useSyncExternalStore(
    (cb) => useStore.persist.onFinishHydration(cb),
    () => useStore.persist.hasHydrated(),
    () => false,
  );
}

function RoleSwitcher() {
  const role = useStore((s) => s.role);
  const setRole = useStore((s) => s.setRole);
  return (
    <label className="flex items-center gap-2 text-[12px] text-navy-100">
      <span className="hidden sm:inline">Viewing as</span>
      <select
        aria-label="Switch user role"
        value={role}
        onChange={(e) => setRole(e.target.value as Role)}
        className="rounded-md border border-navy-600 bg-navy-800 px-2 py-1 text-[12px] font-medium text-white focus:outline-none"
      >
        {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
          <option key={r} value={r}>
            {ROLE_INFO[r].name} — {ROLE_INFO[r].title}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="no-print fixed bottom-4 right-4 z-[60] flex w-[360px] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={cx(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-left text-[12.5px] shadow-lg",
            t.kind === "error" ? "border-risk-700/30 bg-risk-50 text-risk-700" : t.kind === "success" ? "border-ok-700/20 bg-ok-50 text-ok-700" : "border-navy-200 bg-navy-50 text-navy-800",
          )}
        >
          {t.kind === "error" ? <XCircle size={15} className="mt-0.5 shrink-0" /> : t.kind === "success" ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <Info size={15} className="mt-0.5 shrink-0" />}
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}

function QueueIndicator() {
  const jobs = useStore((s) => s.data.jobs);
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running").length;
  if (!active) return null;
  return (
    <Link href="/admin#jobs" className="flex items-center gap-1.5 rounded-md bg-navy-800 px-2 py-1 text-[12px] text-gold-100">
      <Loader2 size={13} className="animate-spin" /> Processing {active}
    </Link>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const ensureSeed = useStore((s) => s.ensureSeed);
  const role = useStore((s) => s.role);
  const pending = useStore((s) => s.data.applications.filter((a) => a.decisionStatus === "awaiting_partner_review").length);
  useEffect(() => {
    if (hydrated) void ensureSeed();
  }, [hydrated, ensureSeed]);

  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 hidden h-screen w-[214px] shrink-0 flex-col bg-navy-900 text-navy-100 md:flex">
        <Link href="/" className="flex items-center gap-2.5 border-b border-navy-800 px-4 py-3.5">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-gold-600 text-[13px] font-bold text-navy-950">AIC</div>
          <div>
            <div className="text-[13px] font-semibold leading-tight text-white">All In Capital</div>
            <div className="text-[10.5px] uppercase tracking-wider text-navy-200">Investment Intelligence</div>
          </div>
        </Link>
        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cx("mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px]", active ? "bg-navy-800 font-medium text-white shadow-[inset_2px_0_0_var(--color-gold-600)]" : "text-navy-200 hover:bg-navy-800/60 hover:text-white")}
              >
                <Icon size={15} />
                <span className="flex-1">{n.label}</span>
                {n.href === "/decisions" && pending > 0 && <span className="num rounded bg-gold-600 px-1.5 text-[10.5px] font-semibold text-navy-950">{pending}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-navy-800 px-4 py-3 text-[11px] leading-snug text-navy-200">
          <div className="flex items-center gap-1.5 text-gold-100">
            <FlaskConical size={12} /> Demo mode · MockAIProvider
          </div>
          <div className="mt-1">Data stored in this browser only. No AI keys, no external research.</div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-40 flex h-12 items-center justify-between gap-3 border-b border-navy-800 bg-navy-900 px-4">
          <div className="flex items-center gap-2 md:hidden">
            <select aria-label="Navigate" value={NAV.find((n) => (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)))?.href ?? "/"} onChange={(e) => (window.location.href = e.target.value)} className="rounded border border-navy-600 bg-navy-800 px-2 py-1 text-[12px] text-white">
              {NAV.map((n) => (
                <option key={n.href} value={n.href}>
                  {n.label}
                </option>
              ))}
            </select>
          </div>
          <div className="hidden items-center gap-2 text-[12px] text-navy-200 md:flex">
            <span className="rounded bg-navy-800 px-2 py-0.5 text-gold-100">Fund II · Batch review</span>
            <span>Decision support only — every outcome is recorded by Kushal.</span>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <QueueIndicator />
            <RoleSwitcher />
            <div title={ROLE_INFO[role].summary} className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold-600 text-[11px] font-bold text-navy-950 sm:flex">
              {ROLE_INFO[role].initials}
            </div>
          </div>
        </header>
        <main className="print-full mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 md:px-6">
          {hydrated ? (
            children
          ) : (
            <div className="flex items-center gap-2 py-20 text-muted">
              <Loader2 className="animate-spin" size={16} /> Loading workspace…
            </div>
          )}
        </main>
      </div>
      <Toasts />
    </div>
  );
}
