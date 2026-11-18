"use client";
// shadcn-style primitives (Tailwind + clsx, no Radix). See D-05.
import clsx from "clsx";
import { X } from "lucide-react";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export const cx = clsx;

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "gold";
export function Button({ variant = "secondary", size = "md", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
        variant === "primary" && "bg-navy-800 text-white hover:bg-navy-700",
        variant === "secondary" && "border border-line-strong bg-surface text-ink hover:bg-navy-50",
        variant === "ghost" && "text-navy-700 hover:bg-navy-50",
        variant === "danger" && "bg-risk-700 text-white hover:bg-risk-700/90",
        variant === "gold" && "bg-gold-600 text-white hover:bg-gold-700",
        className,
      )}
    />
  );
}

export type Tone = "neutral" | "navy" | "teal" | "gold" | "risk" | "warn" | "ok";
const TONES: Record<Tone, string> = {
  neutral: "bg-[#f1efe9] text-muted ring-line",
  navy: "bg-navy-50 text-navy-700 ring-navy-200",
  teal: "bg-teal-50 text-teal-700 ring-teal-100",
  gold: "bg-gold-50 text-gold-700 ring-gold-100",
  risk: "bg-risk-50 text-risk-700 ring-risk-700/20",
  warn: "bg-warn-50 text-warn-700 ring-warn-700/20",
  ok: "bg-ok-50 text-ok-700 ring-ok-700/20",
};
export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function Panel({ title, actions, children, className, dense, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; dense?: boolean; id?: string }) {
  return (
    <section id={id} className={cx("min-w-0 rounded-lg border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-navy-700">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={dense ? "" : "p-3.5"}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, kicker }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; kicker?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {kicker && <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-gold-700">{kicker}</div>}
        <h1 className="text-xl font-semibold text-navy-900">{title}</h1>
        {subtitle && <p className="mt-0.5 max-w-3xl text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "risk" | "warn" | "ok" | "gold" }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3.5 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={cx("num mt-0.5 text-xl font-semibold", tone === "risk" ? "text-risk-700" : tone === "warn" ? "text-warn-700" : tone === "ok" ? "text-ok-700" : tone === "gold" ? "text-gold-700" : "text-navy-900")}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-faint">{hint}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="mb-3 flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx("-mb-px border-b-2 px-3 py-1.5 text-[13px] font-medium", value === t.id ? "border-gold-600 text-navy-900" : "border-transparent text-muted hover:text-navy-700")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    ref.current?.querySelector<HTMLElement>("input,textarea,select,button")?.focus();
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/40 p-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal className={cx("w-full rounded-lg border border-line bg-surface shadow-xl", wide ? "max-w-3xl" : "max-w-lg")}>
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h3 className="font-semibold text-navy-900">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:bg-navy-50">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-3">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-2.5">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, required }: { label: string; children: ReactNode; hint?: ReactNode; required?: boolean }) {
  return (
    <label className="mb-2.5 block">
      <span className="mb-1 block text-[12px] font-medium text-navy-700">
        {label}
        {required && <span className="text-risk-700"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

export const inputCls = "w-full rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-faint focus:border-teal-600 focus:outline-none";

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
      {icon && <div className="mb-2 text-navy-500">{icon}</div>}
      <div className="font-medium text-navy-900">{title}</div>
      {children && <div className="mt-1 max-w-md text-muted">{children}</div>}
    </div>
  );
}

export function Callout({ tone = "navy", children, title }: { tone?: "navy" | "gold" | "risk" | "warn" | "teal"; children: ReactNode; title?: ReactNode }) {
  const t = { navy: "border-navy-200 bg-navy-50 text-navy-800", gold: "border-gold-100 bg-gold-50 text-gold-700", risk: "border-risk-700/20 bg-risk-50 text-risk-700", warn: "border-warn-700/20 bg-warn-50 text-warn-700", teal: "border-teal-100 bg-teal-50 text-teal-700" }[tone];
  return (
    <div className={cx("rounded-md border px-3 py-2 text-[12.5px]", t)}>
      {title && <div className="mb-0.5 font-semibold">{title}</div>}
      {children}
    </div>
  );
}

export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,170px)_1fr] gap-x-3 gap-y-1.5">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-[12px] text-muted">{k}</dt>
          <dd className="text-[13px]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function download(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
