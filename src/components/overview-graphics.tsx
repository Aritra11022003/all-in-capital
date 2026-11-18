"use client";
// Presentation-only graphics for the Overview. Everything here reads values the
// engine already produced; nothing is computed into scores or decisions.
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import india from "@svg-maps/india";
import type { Recommendation } from "@/lib/shared/types";
import { cx } from "./ui";

type RecKey = Recommendation | "none";

/** Recommendation colours on light surfaces (match the jade / brass / terracotta tokens). */
export const REC_COLOR: Record<RecKey, string> = {
  take_call: "#138a73",
  request_info: "#b3832b",
  pass_for_consideration: "#c0573f",
  none: "#8a938d",
};
/** Brighter variants for the dark evergreen map panel. */
export const REC_GLOW: Record<RecKey, string> = {
  take_call: "#4fd1a8",
  request_info: "#eab54e",
  pass_for_consideration: "#f2876a",
  none: "#9fb5aa",
};
export const REC_SHORT: Record<RecKey, string> = {
  take_call: "Take a call",
  request_info: "Request info",
  pass_for_consideration: "Pass — for consideration",
  none: "Not evaluated",
};

/* ------------------------------------------------------------------ count-up */

export function CountUp({ value, decimals = 0, duration = 900 }: { value: number; decimals?: number; duration?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const tick = (t: number) => {
      const p = reduce ? 1 : Math.min(1, (t - start) / duration);
      setShown(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="num">{shown.toFixed(decimals)}</span>;
}

/* ------------------------------------------------------------------ India map */

// Map geometry: @svg-maps/india (CC BY 4.0, Victor Cazanave). Mercator, viewBox 0 0 612 696.
// Calibrated against Kutch (68.18°E), Arunachal (97.41°E), Delhi, Goa and Kanyakumari.
const MAP = india as { viewBox: string; locations: { id: string; name: string; path: string }[] };
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
export function project(lon: number, lat: number): [number, number] {
  return [(lon - 68.18) * 20.94, 210.4 + (mercY(28.62) - mercY(lat)) * 1205];
}

// Applicant-reported HQ cities: [lon, lat, state id in the map].
export const CITY_COORDS: Record<string, [number, number, string]> = {
  hyderabad: [78.49, 17.39, "tg"], secunderabad: [78.5, 17.44, "tg"], ahmedabad: [72.57, 23.02, "gj"], gandhinagar: [72.64, 23.22, "gj"],
  surat: [72.83, 21.17, "gj"], vadodara: [73.18, 22.31, "gj"], gurugram: [77.03, 28.46, "hr"], gurgaon: [77.03, 28.46, "hr"],
  faridabad: [77.31, 28.41, "hr"], delhi: [77.21, 28.61, "dl"], "new delhi": [77.21, 28.61, "dl"], noida: [77.39, 28.54, "up"],
  lucknow: [80.95, 26.85, "up"], kanpur: [80.33, 26.45, "up"], varanasi: [82.97, 25.32, "up"], agra: [78.01, 27.18, "up"],
  bengaluru: [77.59, 12.97, "ka"], bangalore: [77.59, 12.97, "ka"], mysuru: [76.64, 12.3, "ka"], mysore: [76.64, 12.3, "ka"],
  mangaluru: [74.86, 12.91, "ka"], pune: [73.86, 18.52, "mh"], mumbai: [72.88, 19.08, "mh"], "navi mumbai": [73.03, 19.03, "mh"],
  thane: [72.98, 19.22, "mh"], nagpur: [79.09, 21.15, "mh"], nashik: [73.79, 19.99, "mh"], aurangabad: [75.34, 19.88, "mh"],
  chennai: [80.27, 13.08, "tn"], coimbatore: [76.96, 11.02, "tn"], madurai: [78.12, 9.93, "tn"], jaipur: [75.79, 26.91, "rj"],
  udaipur: [73.71, 24.58, "rj"], jodhpur: [73.02, 26.24, "rj"], kolkata: [88.36, 22.57, "wb"], kochi: [76.27, 9.93, "kl"],
  cochin: [76.27, 9.93, "kl"], thiruvananthapuram: [76.94, 8.52, "kl"], goa: [73.83, 15.49, "ga"], panaji: [73.83, 15.49, "ga"],
  indore: [75.86, 22.72, "mp"], bhopal: [77.41, 23.26, "mp"], chandigarh: [76.78, 30.73, "ch"], mohali: [76.72, 30.7, "pb"],
  ludhiana: [75.86, 30.9, "pb"], dehradun: [78.03, 30.32, "ut"], patna: [85.14, 25.59, "br"], bhubaneswar: [85.82, 20.3, "or"],
  guwahati: [91.74, 26.14, "as"], visakhapatnam: [83.22, 17.69, "ap"], vijayawada: [80.65, 16.51, "ap"], raipur: [81.63, 21.25, "ct"],
  ranchi: [85.31, 23.34, "jh"], srinagar: [74.8, 34.08, "jk"], shillong: [91.89, 25.58, "ml"],
};

export function cityKey(location: string | null | undefined): string | null {
  if (!location) return null;
  const first = location.split(/[,|(]/)[0].trim().toLowerCase();
  return first || null;
}

export interface MapPin {
  key: string;
  label: string;
  lon: number;
  lat: number;
  state: string;
  apps: { id: string; name: string; rec: RecKey; score: number | null }[];
}

type Side = { dx: number; dy: number; anchor: "start" | "end" };
type Box = [number, number, number, number];

function bestRec(apps: MapPin["apps"]): RecKey {
  if (apps.some((a) => a.rec === "take_call")) return "take_call";
  if (apps.some((a) => a.rec === "request_info")) return "request_info";
  return apps[0]?.rec ?? "none";
}

export function IndiaPipelineMap({ pins, selected, onSelect }: { pins: MapPin[]; selected: string | null; onSelect: (k: string | null) => void }) {
  const placed = useMemo(() => {
    const pts = pins.map((p) => ({ ...p, xy: project(p.lon, p.lat) }));
    const hit = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
    const pinBoxes = pts.map(({ key, xy: [x, y] }) => ({ key, b: [x - 9, y - 9, x + 9, y + 9] as Box }));
    const taken: Box[] = [];
    const layout = new Map<string, Side & { w: number }>();
    for (const p of [...pts].sort((a, b) => b.apps.length - a.apps.length)) {
      const [x, y] = p.xy;
      const w = Math.round(p.label.length * 7.3 + 52);
      const cands: Side[] = [
        { dx: 14, dy: 0, anchor: "start" },
        { dx: -14, dy: 0, anchor: "end" },
        { dx: 14, dy: -24, anchor: "start" },
        { dx: -14, dy: -24, anchor: "end" },
        { dx: 14, dy: 24, anchor: "start" },
        { dx: -14, dy: 24, anchor: "end" },
        { dx: 30, dy: -44, anchor: "start" },
        { dx: -30, dy: 44, anchor: "end" },
      ];
      const boxOf = (c: Side): Box => {
        const x0 = c.anchor === "start" ? x + c.dx : x + c.dx - w;
        return [x0, y + c.dy - 11, x0 + w, y + c.dy + 11];
      };
      const pick =
        cands.find((c) => {
          const b = boxOf(c);
          return b[0] > -40 && b[2] < 652 && !pinBoxes.some((o) => o.key !== p.key && hit(b, o.b)) && !taken.some((o) => hit(b, o));
        }) ?? cands[0];
      taken.push(boxOf(pick));
      layout.set(p.key, { ...pick, w });
    }
    return pts.map((p) => ({ ...p, lab: layout.get(p.key)!, rec: bestRec(p.apps) }));
  }, [pins]);

  const activeStates = useMemo(() => new Map(placed.map((p) => [p.state, p.key])), [placed]);
  const selectedState = placed.find((p) => p.key === selected)?.state;

  // Gentle arcs linking the cities west → east (decorative network).
  const arcs = useMemo(() => {
    const byX = [...placed].sort((a, b) => a.xy[0] - b.xy[0]);
    return byX.slice(1).map((p, i) => {
      const [ax, ay] = byX[i].xy;
      const [bx, by] = p.xy;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const bend = Math.min(70, Math.max(24, len * 0.35));
      const cx = (ax + bx) / 2 + ((by - ay) / len) * bend;
      const cy = (ay + by) / 2 - ((bx - ax) / len) * bend;
      return { id: `${byX[i].key}-${p.key}`, d: `M${ax},${ay} Q${cx},${cy} ${bx},${by}` };
    });
  }, [placed]);

  return (
    <svg viewBox="-40 -14 692 724" className="h-full w-full select-none" role="img" aria-label="Map of India showing applicant-reported head-office cities">
      <defs>
        <clipPath id="ov-india">
          {MAP.locations.map((l) => (
            <path key={l.id} d={l.path} />
          ))}
        </clipPath>
        <pattern id="ov-dots" width="7" height="7" patternUnits="userSpaceOnUse">
          <circle cx="3.5" cy="3.5" r="1.05" fill="#8fe3c6" />
        </pattern>
        <linearGradient id="ov-land" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#1d5745" />
          <stop offset="100%" stopColor="#123d31" />
        </linearGradient>
        <radialGradient id="ov-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2bb38c" stopOpacity="0.35" />
          <stop offset="70%" stopColor="#2bb38c" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#2bb38c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ov-arc" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="612" y2="0">
          <stop offset="0%" stopColor="#8fe3c6" stopOpacity="0.45" />
          <stop offset="50%" stopColor="#eab54e" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#8fe3c6" stopOpacity="0.45" />
        </linearGradient>
      </defs>

      {/* soft glow beneath the landmass */}
      <ellipse cx={300} cy={360} rx={360} ry={380} fill="url(#ov-halo)" pointerEvents="none" />

      {/* states */}
      <g>
        {MAP.locations.map((l) => {
          const hasApps = activeStates.has(l.id);
          const isSel = selectedState === l.id;
          return (
            <path
              key={l.id}
              d={l.path}
              className="ov-state"
              fill={isSel ? "#2f8a6c" : hasApps ? "#246e57" : "url(#ov-land)"}
              stroke={isSel ? "#bff3e0" : "#6fbfa3"}
              strokeOpacity={isSel ? 0.9 : 0.32}
              strokeWidth={isSel ? 1.2 : 0.6}
              strokeLinejoin="round"
              onMouseEnter={hasApps ? () => onSelect(activeStates.get(l.id)!) : undefined}
            >
              <title>{l.name}</title>
            </path>
          );
        })}
      </g>

      {/* dot texture clipped to the country */}
      <rect x="0" y="0" width="612" height="696" fill="url(#ov-dots)" clipPath="url(#ov-india)" opacity={0.28} pointerEvents="none" />

      {/* network arcs */}
      <g fill="none" pointerEvents="none">
        {arcs.map((a, i) => (
          <path key={a.id} d={a.d} stroke="url(#ov-arc)" strokeWidth={1.2} strokeLinecap="round" pathLength={1} className="ov-draw" style={{ animationDelay: `${0.5 + i * 0.12}s` }} />
        ))}
      </g>

      {/* pins + callouts */}
      {placed.map((p, i) => {
        const [x, y] = p.xy;
        const c = REC_GLOW[p.rec];
        const active = selected === p.key;
        const { dx, dy, anchor, w } = p.lab;
        const bx = anchor === "start" ? x + dx : x + dx - w;
        const by = y + dy - 11;
        return (
          <g key={p.key} className="cursor-pointer" onMouseEnter={() => onSelect(p.key)} onClick={() => onSelect(active ? null : p.key)}>
            <title>{`${p.label}: ${p.apps.map((a) => a.name).join(", ")}`}</title>
            {(dx !== 14 && dx !== -14) || dy !== 0 ? <line x1={x} y1={y} x2={anchor === "start" ? bx : bx + w} y2={by + 11} stroke="#cfe9df" strokeOpacity={0.35} strokeWidth={0.8} /> : null}
            <circle cx={x} cy={y} r={11} fill={c} className="ov-pulse" style={{ animationDelay: `${i * 0.3}s` }} />
            <circle cx={x} cy={y} r={active ? 8 : 6.5} fill="#0b2a21" stroke={c} strokeWidth={2.2} className="ov-pop" style={{ animationDelay: `${300 + i * 70}ms` }} />
            <circle cx={x} cy={y} r={active ? 3.6 : 2.8} fill={c} />
            <g className="ov-pop" style={{ animationDelay: `${450 + i * 70}ms` }}>
              <rect x={bx} y={by} width={w} height={22} rx={11} fill={active ? "#f6f4ee" : "#0a241c"} fillOpacity={active ? 1 : 0.88} stroke={active ? c : "#ffffff"} strokeOpacity={active ? 1 : 0.14} />
              <circle cx={bx + 12} cy={by + 11} r={3.4} fill={c} />
              <text x={bx + 21} y={by + 15} fontSize={11.5} fontWeight={600} fill={active ? "#17211c" : "#f2f7f4"}>
                {p.label}
              </text>
              <text x={bx + w - 10} y={by + 15} fontSize={11} fontWeight={600} textAnchor="end" fill={active ? "#87611c" : "#eab54e"}>
                {p.apps.length}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ sparkline */

export function Sparkline({ values, color, labels, height = 54, width = 240 }: { values: (number | null)[]; color: string; labels?: string[]; height?: number; width?: number }) {
  const pad = 5;
  const n = values.length;
  const x = (i: number) => pad + (i * (width - pad * 2)) / Math.max(1, n - 1);
  const y = (v: number) => pad + ((5 - v) / 4) * (height - pad * 2);
  const segments: string[] = [];
  let cur = "";
  values.forEach((v, i) => {
    if (v === null) {
      if (cur) segments.push(cur);
      cur = "";
    } else cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (cur) segments.push(cur);
  const scored = values.map((v, i) => (v === null ? null : ([x(i), y(v)] as const))).filter(Boolean) as (readonly [number, number])[];
  const area = scored.length > 1 ? `M${scored[0][0]},${height} ${scored.map(([a, b]) => `L${a},${b}`).join(" ")} L${scored[scored.length - 1][0]},${height} Z` : "";
  const gid = `sg-${color.slice(1)}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[54px] w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[2, 3, 4].map((g) => (
        <line key={g} x1={0} x2={width} y1={y(g)} y2={y(g)} stroke="#17211c" strokeOpacity={0.06} vectorEffect="non-scaling-stroke" />
      ))}
      {area && <path d={area} fill={`url(#${gid})`} className="ov-fade" />}
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" pathLength={1} className="ov-draw" />
      ))}
      {values.map((v, i) =>
        v === null ? (
          <circle key={i} cx={x(i)} cy={height - pad} r={2} fill="#fff" stroke="#8a938d" strokeDasharray="1.5 1.5" vectorEffect="non-scaling-stroke">
            <title>{`${labels?.[i] ?? `Criterion ${i + 1}`}: insufficient evidence`}</title>
          </circle>
        ) : (
          <circle key={i} cx={x(i)} cy={y(v)} r={2.2} fill={color} className="ov-fade">
            <title>{`${labels?.[i] ?? `Criterion ${i + 1}`}: ${v}`}</title>
          </circle>
        ),
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ donut */

export function Donut({ parts, size = 132, stroke = 14, center, track = "rgba(23,33,28,0.07)" }: { parts: { key: string; value: number; color: string; label: string }[]; size?: number; stroke?: number; center: ReactNode; track?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const gap = parts.filter((p) => p.value > 0).length > 1 ? 3 : 0;
  const starts = parts.map((_, i) => parts.slice(0, i).reduce((s, p) => s + (p.value / total) * c, 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        {parts.map((p, i) => (
          <circle
            key={p.key}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={p.color}
            strokeWidth={stroke}
            strokeDasharray={`${Math.max(0, (p.value / total) * c - gap)} ${c}`}
            strokeDashoffset={-starts[i]}
            className="ov-fade"
          >
            <title>{`${p.label}: ${p.value}`}</title>
          </circle>
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ cards */

export function Card({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <section className={cx("ov-card ov-rise min-w-0 rounded-xl", className)} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </section>
  );
}

export type KpiTone = "jade" | "brass" | "terracotta" | "evergreen" | "plum" | "slate";
const KPI_TONES: Record<KpiTone, { bg: string; fg: string; bar: string }> = {
  jade: { bg: "#e3f4ee", fg: "#0e6e5c", bar: "#138a73" },
  brass: { bg: "#f8eed8", fg: "#87611c", bar: "#b3832b" },
  terracotta: { bg: "#f9e7e1", fg: "#a8432e", bar: "#c0573f" },
  evergreen: { bg: "#e2ece7", fg: "#143a2e", bar: "#2a6150" },
  plum: { bg: "#efe7f1", fg: "#6b3f73", bar: "#86558f" },
  slate: { bg: "#ecefed", fg: "#59645e", bar: "#8a938d" },
};

export function KpiTile({ icon, tone, label, value, sub, fraction, delay, href }: { icon: ReactNode; tone: KpiTone; label: string; value: number; sub: ReactNode; fraction?: number; delay?: number; href?: string }) {
  const t = KPI_TONES[tone];
  const body = (
    <div className="flex items-start gap-3.5 p-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: t.bg, color: t.fg }}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-muted">{label}</div>
        <div className="mt-0.5 text-[28px] font-semibold leading-none tracking-tight text-navy-900">
          <CountUp value={value} />
        </div>
        <div className="mt-1.5 text-[11.5px] text-faint">{sub}</div>
        {fraction !== undefined && (
          <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: t.bg }}>
            <div className="ov-bar h-full rounded-full" style={{ width: `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`, background: t.bar }} />
          </div>
        )}
      </div>
    </div>
  );
  return (
    <Card delay={delay} className={cx(href && "ov-hover")}>
      {href ? (
        <Link href={href} className="block">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

export function StatusChip({ rec }: { rec: RecKey }) {
  const color = REC_COLOR[rec];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium" style={{ borderColor: `${color}40`, color, background: `${color}10` }}>
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {REC_SHORT[rec]}
    </span>
  );
}

export function MeterRow({ label, value, display, color = "#138a73", note }: { label: string; value: number | null; display: string; color?: string; note?: string }) {
  return (
    <div className="py-1.5" title={note}>
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-muted">{label}</span>
        <span className="num font-semibold text-navy-900">{display}</span>
      </div>
      {value !== null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#efece4]">
          <div className="ov-bar h-full rounded-full" style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`, background: color }} />
        </div>
      )}
    </div>
  );
}
