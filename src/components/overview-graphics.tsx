"use client";
// Presentation-only graphics for the Overview. Everything here reads values the
// engine already produced; nothing is computed into scores or decisions.
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Recommendation } from "@/lib/shared/types";
import { cx } from "./ui";

export const REC_COLOR: Record<Recommendation | "none", string> = {
  take_call: "#34d3b4",
  request_info: "#f2c14e",
  pass_for_consideration: "#fb7185",
  none: "#7b8ba6",
};
export const REC_SHORT: Record<Recommendation | "none", string> = {
  take_call: "Take a call",
  request_info: "Request info",
  pass_for_consideration: "Pass — for consideration",
  none: "Not evaluated",
};

/* ------------------------------------------------------------------ count-up */

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function CountUp({ value, decimals = 0, duration = 900 }: { value: number; decimals?: number; duration?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const reduce = prefersReducedMotion();
    const tick = (t: number) => {
      const p = reduce ? 1 : Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(value * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="num">{shown.toFixed(decimals)}</span>;
}

/* ------------------------------------------------------------------ India map */

// Approximate national outline (lon, lat). Decorative dot-matrix only — not a survey map.
const INDIA: [number, number][] = [
  [68.4, 23.6], [69.2, 22.8], [69.0, 22.3], [69.6, 21.6], [70.4, 20.9], [71.0, 20.7], [72.2, 21.6], [72.6, 22.2], [72.8, 21.2],
  [72.8, 20.4], [72.8, 19.0], [73.3, 17.0], [73.8, 15.4], [74.1, 14.8], [74.8, 12.9], [75.8, 11.2], [76.2, 9.9], [76.9, 8.5],
  [77.5, 8.1], [78.1, 8.8], [79.3, 9.3], [79.9, 10.3], [79.9, 11.5], [80.3, 13.1], [80.1, 14.4], [81.2, 16.2], [82.3, 16.9],
  [83.3, 17.7], [84.9, 19.3], [85.8, 19.8], [86.7, 20.3], [87.0, 21.5], [88.0, 21.6], [88.9, 21.7], [88.9, 22.6], [88.6, 23.6],
  [88.1, 24.5], [88.4, 25.2], [88.6, 26.2], [89.8, 25.9], [90.6, 25.2], [92.0, 25.1], [92.4, 24.2], [91.4, 24.1], [91.2, 23.2],
  [91.8, 22.9], [92.3, 21.6], [92.7, 21.9], [93.3, 22.6], [94.2, 23.8], [94.7, 25.2], [95.3, 26.6], [96.2, 27.3], [97.3, 28.2],
  [96.6, 29.0], [95.4, 29.0], [94.0, 28.8], [92.5, 27.9], [92.0, 26.9], [90.0, 26.8], [89.1, 26.8], [88.8, 27.3], [88.9, 28.0],
  [88.1, 27.9], [88.0, 27.1], [87.9, 26.5], [87.0, 26.4], [85.0, 26.7], [83.3, 27.4], [81.3, 28.4], [80.1, 28.8], [80.3, 29.8],
  [81.0, 30.2], [79.3, 31.2], [78.4, 32.5], [79.5, 32.7], [79.3, 34.0], [78.2, 35.5], [76.8, 35.6], [75.0, 35.2], [73.8, 34.4],
  [74.2, 33.2], [74.6, 32.5], [75.3, 32.2], [74.6, 31.0], [73.9, 30.0], [72.9, 29.0], [71.0, 27.8], [70.0, 27.0], [70.6, 25.7],
  [69.6, 24.3],
];

// City centroids for applicant-reported HQs. Unknown cities are listed as "unmapped".
export const CITY_COORDS: Record<string, [number, number]> = {
  hyderabad: [78.49, 17.39], secunderabad: [78.5, 17.44], ahmedabad: [72.57, 23.02], gandhinagar: [72.64, 23.22], surat: [72.83, 21.17],
  vadodara: [73.18, 22.31], gurugram: [77.03, 28.46], gurgaon: [77.03, 28.46], delhi: [77.21, 28.61], "new delhi": [77.21, 28.61],
  noida: [77.39, 28.54], faridabad: [77.31, 28.41], bengaluru: [77.59, 12.97], bangalore: [77.59, 12.97], pune: [73.86, 18.52],
  mumbai: [72.88, 19.08], "navi mumbai": [73.03, 19.03], thane: [72.98, 19.22], chennai: [80.27, 13.08], jaipur: [75.79, 26.91],
  kolkata: [88.36, 22.57], kochi: [76.27, 9.93], cochin: [76.27, 9.93], thiruvananthapuram: [76.94, 8.52], coimbatore: [76.96, 11.02],
  mysuru: [76.64, 12.3], mysore: [76.64, 12.3], mangaluru: [74.86, 12.91], goa: [73.83, 15.49], panaji: [73.83, 15.49],
  indore: [75.86, 22.72], bhopal: [77.41, 23.26], nagpur: [79.09, 21.15], lucknow: [80.95, 26.85], kanpur: [80.33, 26.45],
  chandigarh: [76.78, 30.73], mohali: [76.72, 30.7], ludhiana: [75.86, 30.9], dehradun: [78.03, 30.32], patna: [85.14, 25.59],
  bhubaneswar: [85.82, 20.3], guwahati: [91.74, 26.14], visakhapatnam: [83.22, 17.69], vijayawada: [80.65, 16.51],
  madurai: [78.12, 9.93], nashik: [73.79, 19.99], aurangabad: [75.34, 19.88], raipur: [81.63, 21.25], ranchi: [85.31, 23.34],
  varanasi: [82.97, 25.32], agra: [78.01, 27.18], udaipur: [73.71, 24.58], jodhpur: [73.02, 26.24], srinagar: [74.8, 34.08],
};

export function cityKey(location: string | null | undefined): string | null {
  if (!location) return null;
  const first = location.split(/[,|(]/)[0].trim().toLowerCase();
  return first || null;
}

const LON0 = 67.5, LON1 = 98, LAT0 = 7.2, LAT1 = 36.4;
const K = 17;
const COSLAT = Math.cos((22 * Math.PI) / 180);
export const MAP_W = Math.round((LON1 - LON0) * K * COSLAT);
export const MAP_H = Math.round((LAT1 - LAT0) * K);
export function project(lon: number, lat: number): [number, number] {
  return [(lon - LON0) * K * COSLAT, (LAT1 - lat) * K];
}

function inPoly(x: number, y: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const DOTS: [number, number][] = (() => {
  const out: [number, number][] = [];
  const step = 0.52;
  let row = 0;
  for (let lat = LAT1; lat > LAT0; lat -= step, row++) {
    const lonStep = step / COSLAT;
    for (let lon = LON0 + (row % 2 ? lonStep / 2 : 0); lon < LON1; lon += lonStep) {
      if (inPoly(lon, lat, INDIA)) out.push(project(lon, lat));
    }
  }
  return out;
})();

export interface MapPin {
  key: string;
  label: string;
  lon: number;
  lat: number;
  apps: { id: string; name: string; rec: Recommendation | "none"; score: number | null }[];
}

export function IndiaPipelineMap({ pins, selected, onSelect }: { pins: MapPin[]; selected: string | null; onSelect: (k: string | null) => void }) {
  const projected = useMemo(() => {
    const pts = pins.map((p) => ({ ...p, xy: project(p.lon, p.lat) }));
    // Greedy label placement: first candidate box that clears every pin and every placed label.
    type Box = [number, number, number, number];
    const hit = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
    const pinBoxes: Box[] = pts.map(({ xy: [x, y] }) => [x - 8, y - 8, x + 8, y + 8]);
    const placed: Box[] = [];
    const order = [...pts].sort((a, b) => b.apps.length - a.apps.length);
    const layout = new Map<string, { dx: number; dy: number; anchor: "start" | "end" }>();
    for (const p of order) {
      const [x, y] = p.xy;
      const w = Math.max(p.label.length * 7.6, 74);
      const h = 28;
      const cands: { dx: number; dy: number; anchor: "start" | "end" }[] = [
        { dx: 11, dy: -2, anchor: "start" },
        { dx: -11, dy: -2, anchor: "end" },
        { dx: 11, dy: -20, anchor: "start" },
        { dx: -11, dy: -20, anchor: "end" },
        { dx: 11, dy: 16, anchor: "start" },
        { dx: -11, dy: 16, anchor: "end" },
      ];
      const boxOf = (c: (typeof cands)[number]): Box => {
        const x0 = c.anchor === "start" ? x + c.dx : x + c.dx - w;
        return [x0, y + c.dy - 12, x0 + w, y + c.dy - 12 + h];
      };
      const others = pinBoxes.filter((_, i) => pts[i].key !== p.key);
      const pick = cands.find((c) => {
        const b = boxOf(c);
        return b[0] > -55 && b[2] < MAP_W + 55 && !others.some((o) => hit(b, o)) && !placed.some((o) => hit(b, o));
      }) ?? cands[0];
      placed.push(boxOf(pick));
      layout.set(p.key, pick);
    }
    return pts.map((p) => ({ ...p, lab: layout.get(p.key)! }));
  }, [pins]);
  // Decorative network: connect each pin to its nearest neighbour to the east.
  const arcs = useMemo(() => {
    const byX = [...projected].sort((a, b) => a.xy[0] - b.xy[0]);
    return byX.slice(1).map((p, i) => {
      const a = byX[i].xy;
      const b = p.xy;
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const bend = Math.max(22, len * 0.32);
      const cx = mx + ((b[1] - a[1]) / len) * bend;
      const cy = my - ((b[0] - a[0]) / len) * bend;
      return { id: `${byX[i].key}-${p.key}`, d: `M${a[0]},${a[1]} Q${cx},${cy} ${b[0]},${b[1]}` };
    });
  }, [projected]);

  return (
    <svg viewBox={`-60 -10 ${MAP_W + 120} ${MAP_H + 20}`} className="h-full w-full" role="img" aria-label="Dot map of India showing applicant-reported head-office cities">
      <defs>
        <radialGradient id="ov-glow" cx="50%" cy="55%" r="55%">
          <stop offset="0%" stopColor="#1fb5a0" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#1fb5a0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ov-arc" x1="0" x2="1">
          <stop offset="0%" stopColor="#34d3b4" stopOpacity="0.15" />
          <stop offset="50%" stopColor="#34d3b4" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#34d3b4" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <ellipse cx={MAP_W / 2} cy={MAP_H * 0.55} rx={MAP_W * 0.6} ry={MAP_H * 0.55} fill="url(#ov-glow)" />
      <g fill="#5eead4">
        {DOTS.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={2.1} opacity={0.3 + ((i * 37) % 11) / 45} />
        ))}
      </g>
      <g fill="none" stroke="url(#ov-arc)" strokeWidth={1.3}>
        {arcs.map((a, i) => (
          <path key={a.id} d={a.d} className="ov-arc" style={{ animationDelay: `${0.4 + i * 0.12}s` }} pathLength={1} />
        ))}
      </g>
      {projected.map((p) => {
        const [x, y] = p.xy;
        const active = selected === p.key;
        const best = p.apps.find((a) => a.rec === "take_call") ? "take_call" : p.apps.find((a) => a.rec === "request_info") ? "request_info" : p.apps[0]?.rec ?? "none";
        const color = REC_COLOR[best];
        return (
          <g key={p.key} className="cursor-pointer" onClick={() => onSelect(active ? null : p.key)} onMouseEnter={() => onSelect(p.key)}>
            <title>{`${p.label}: ${p.apps.map((a) => a.name).join(", ")}`}</title>
            <circle cx={x} cy={y} r={14} fill={color} className="ov-pulse" style={{ transformOrigin: `${x}px ${y}px` }} />
            <circle cx={x} cy={y} r={active ? 7 : 5} fill="#07101f" stroke={color} strokeWidth={2} />
            <circle cx={x} cy={y} r={active ? 3.2 : 2.4} fill={color} />
            <g transform={`translate(${x + p.lab.dx}, ${y + p.lab.dy})`} textAnchor={p.lab.anchor} style={{ paintOrder: "stroke" }} stroke="#07101f" strokeWidth={3} strokeLinejoin="round">
              <text className="fill-white" fontSize={active ? 14 : 12.5} fontWeight={600}>
                {p.label}
              </text>
              <text y={14} fontSize={10.5} fill="#9fb3d1">
                {p.apps.length} application{p.apps.length === 1 ? "" : "s"}
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
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[2, 3, 4].map((g) => (
        <line key={g} x1={0} x2={width} y1={y(g)} y2={y(g)} stroke="#ffffff" strokeOpacity={0.05} vectorEffect="non-scaling-stroke" />
      ))}
      {area && <path d={area} fill={`url(#${gid})`} className="ov-fade" />}
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" pathLength={1} className="ov-draw" />
      ))}
      {values.map((v, i) =>
        v === null ? (
          <circle key={i} cx={x(i)} cy={height - pad} r={2} fill="none" stroke="#7b8ba6" strokeDasharray="1.5 1.5" vectorEffect="non-scaling-stroke">
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

export function Donut({ parts, size = 132, stroke = 14, center }: { parts: { key: string; value: number; color: string; label: string }[]; size?: number; stroke?: number; center: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const gap = parts.filter((p) => p.value > 0).length > 1 ? 4 : 0;
  const starts = parts.map((_, i) => parts.slice(0, i).reduce((s, p) => s + (p.value / total) * c, 0));
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ffffff" strokeOpacity={0.06} strokeWidth={stroke} />
        {parts.map((p, i) => {
          const len = (p.value / total) * c;
          return (
            <circle
              key={p.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={p.color}
              strokeWidth={stroke}
              strokeLinecap="butt"
              strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
              strokeDashoffset={-starts[i]}
              className="ov-fade"
            >
              <title>{`${p.label}: ${p.value}`}</title>
            </circle>
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ cards */

export function GlassCard({ children, className, delay = 0, as = "section" }: { children: ReactNode; className?: string; delay?: number; as?: "section" | "div" }) {
  const Tag = as;
  return (
    <Tag className={cx("ov-card ov-rise min-w-0 rounded-xl", className)} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}

export function KpiTile({ icon, iconBg, label, value, decimals, sub, fraction, barColor, delay, href }: { icon: ReactNode; iconBg: string; label: string; value: number; decimals?: number; sub: ReactNode; fraction?: number; barColor?: string; delay?: number; href?: string }) {
  const body = (
    <div className="flex items-start gap-3.5 p-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-[0_0_24px_-4px_currentColor]" style={{ background: iconBg, color: iconBg }}>
        <span className="text-white">{icon}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-[#9fb3d1]">{label}</div>
        <div className="mt-0.5 text-[28px] font-semibold leading-none tracking-tight text-white">
          <CountUp value={value} decimals={decimals} />
        </div>
        <div className="mt-1.5 text-[11.5px] text-[#8193b0]">{sub}</div>
        {fraction !== undefined && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
            <div className="ov-bar h-full rounded-full" style={{ width: `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`, background: barColor }} />
          </div>
        )}
      </div>
    </div>
  );
  return (
    <GlassCard delay={delay} className={cx(href && "ov-hover")}>
      {href ? <Link href={href} className="block">{body}</Link> : body}
    </GlassCard>
  );
}

export function StatusChip({ rec }: { rec: Recommendation | "none" }) {
  const color = REC_COLOR[rec];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium" style={{ borderColor: `${color}55`, color, background: `${color}14` }}>
      <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      {REC_SHORT[rec]}
    </span>
  );
}

export function MeterRow({ label, value, display, color = "#34d3b4", note }: { label: string; value: number | null; display: string; color?: string; note?: string }) {
  return (
    <div className="py-1.5" title={note}>
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-[#9fb3d1]">{label}</span>
        <span className="num font-semibold text-white">{display}</span>
      </div>
      {value !== null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
          <div className="ov-bar h-full rounded-full" style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`, background: color }} />
        </div>
      )}
    </div>
  );
}
