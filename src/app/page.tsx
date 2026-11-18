"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Gavel, FlaskConical, Layers, PhoneCall, ArrowLeftRight, AlertTriangle, Hourglass, Search, MapPin, ShieldAlert, Clock } from "lucide-react";
import { useData, useRole, useStore } from "@/lib/store";
import { effectiveAssessment, effectiveOverall, latestEvaluation, latestOverlap, qualityIndicators } from "@/lib/domain/workspace";
import { PROVIDERS } from "@/lib/engine/evaluation/provider";
import { ROLE_INFO } from "@/lib/domain/permissions";
import { CRITERION_SHORT, SECTOR_LABEL } from "@/lib/shared/labels";
import type { CriterionId, Recommendation } from "@/lib/shared/types";
import { ApplicationsTable, sortByScore } from "@/components/app-table";
import { cx } from "@/components/ui";
import { CITY_COORDS, cityKey, CountUp, Donut, GlassCard, IndiaPipelineMap, KpiTile, MeterRow, REC_COLOR, REC_SHORT, Sparkline, StatusChip, type MapPin as Pin } from "@/components/overview-graphics";

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const REC_ORDER: (Recommendation | "none")[] = ["take_call", "request_info", "pass_for_consideration", "none"];
const SECTOR_COLORS = ["#34d3b4", "#60a5fa", "#a78bfa", "#f2c14e", "#fb7185", "#94a3b8", "#22d3ee", "#7b8ba6"];

export default function Overview() {
  const d = useData();
  const role = useRole();
  const draining = useStore((s) => s.draining);
  const [city, setCity] = useState<string | null>(null);
  const apps = d.applications;
  const q = qualityIndicators(d);

  const rows = useMemo(
    () =>
      sortByScore(d, apps).map((a) => {
        const ev = latestEvaluation(d, a.id);
        const company = d.companies.find((c) => c.id === a.companyId);
        const overall = ev ? effectiveOverall(d, ev) : null;
        const profile = ev ? ev.assessments.map((x) => effectiveAssessment(d, ev, x.criterion).score) : [];
        const labels = ev ? ev.assessments.map((x) => CRITERION_SHORT[x.criterion as CriterionId]) : [];
        const ov = latestOverlap(d, a.id);
        return {
          a,
          ev,
          rec: (ev?.recommendation ?? "none") as Recommendation | "none",
          overall,
          profile,
          labels,
          location: company?.location ?? null,
          conflicts: d.conflicts.filter((c) => c.applicationId === a.id && c.status === "open").length,
          overlap: !!ov && ov.results.length > 0,
        };
      }),
    [d, apps],
  );

  const awaiting = apps.filter((a) => a.decisionStatus === "awaiting_partner_review").length;
  const ready = apps.filter((a) => a.processingStatus === "ready_for_review").length;
  const calls = rows.filter((r) => r.rec === "take_call").length;
  const problems = apps.filter((a) => a.processingStatus === "failed" || a.processingStatus === "needs_attention").length;
  const openResearch = d.research.filter((r) => r.status !== "answered").length;
  const evaluated = rows.filter((r) => r.ev).length;

  const { pins, unmapped } = useMemo(() => {
    const m = new Map<string, Pin>();
    const un: string[] = [];
    for (const r of rows) {
      const k = cityKey(r.location);
      const c = k ? CITY_COORDS[k] : undefined;
      if (!k || !c) {
        un.push(r.a.name);
        continue;
      }
      const pin = m.get(k) ?? { key: k, label: titleCase(k), lon: c[0], lat: c[1], apps: [] };
      pin.apps.push({ id: r.a.id, name: r.a.name, rec: r.rec, score: r.overall });
      m.set(k, pin);
    }
    return { pins: [...m.values()].sort((x, y) => y.apps.length - x.apps.length || x.label.localeCompare(y.label)), unmapped: un };
  }, [rows]);

  const recParts = REC_ORDER.map((k) => ({ key: k, label: REC_SHORT[k], color: REC_COLOR[k], value: rows.filter((r) => r.rec === k).length })).filter((p) => p.value > 0 || p.key !== "none");
  const sectors = useMemo(() => {
    const m = new Map<string, number>();
    apps.forEach((a) => m.set(SECTOR_LABEL[a.sectorKey], (m.get(SECTOR_LABEL[a.sectorKey]) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, n], i) => ({ label, n, color: SECTOR_COLORS[i % SECTOR_COLORS.length] }));
  }, [apps]);

  return (
    <div className="ov">
      {/* header */}
      <div className="ov-rise mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#f2c14e]">
            {ROLE_INFO[role].name} · {ROLE_INFO[role].title}
          </div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-white">Deal-flow Intelligence</h1>
          <p className="mt-1 max-w-3xl text-[13.5px] text-[#9fb3d1]">
            This week&apos;s applications, scored criterion by criterion against the proposed thesis, with the source behind each claim and the gaps named. Recommendations are simulated and never final.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-[34px] items-center gap-2 rounded-[9px] border border-[#34d3b4]/25 bg-[#34d3b4]/[0.07] px-3 text-[12.5px] text-[#c9f5ec]" title="Scores come from the rule-based MockAIProvider; nothing is externally verified.">
            <span className={cx("h-2 w-2 rounded-full bg-[#34d3b4] shadow-[0_0_10px_#34d3b4]", draining && "ov-live")} />
            {draining ? "Processing intake…" : "Batch scored · simulated"}
          </span>
          <Link href="/decisions" className="ov-btn ov-btn-ghost">
            <Gavel size={14} /> Decision room
            {awaiting > 0 && <span className="num rounded bg-[#f2c14e] px-1.5 text-[10.5px] font-semibold text-[#1a1405]">{awaiting}</span>}
          </Link>
          <Link href="/applications/new" className="ov-btn ov-btn-primary">
            <Plus size={14} /> New intake
          </Link>
        </div>
      </div>

      {/* map + mix */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <GlassCard className="relative overflow-hidden p-4" delay={60}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="ov-section-title">Where this batch comes from</h2>
              <p className="text-[12px] text-[#8193b0]">Applicant-reported head offices · unverified · hover a city</p>
            </div>
            <div className="hidden gap-3 text-[11px] text-[#9fb3d1] sm:flex">
              {(["take_call", "request_info", "pass_for_consideration"] as const).map((k) => (
                <span key={k} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: REC_COLOR[k] }} />
                  {REC_SHORT[k].split(" —")[0]}
                </span>
              ))}
            </div>
          </div>
          <div className="mx-auto mt-1 aspect-[6/5] w-full max-w-[640px]">
            <IndiaPipelineMap pins={pins} selected={city} onSelect={setCity} />
          </div>
          {pins.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="rounded-lg bg-[#07101f]/80 px-4 py-3 text-center text-[12.5px] text-[#9fb3d1]">
                No locations yet. <Link href="/applications/new" className="text-[#5eead4] underline">Start an intake</Link>.
              </div>
            </div>
          )}
          {unmapped.length > 0 && (
            <p className="text-[11px] text-[#6f819e]">
              <MapPin size={11} className="mr-1 inline" />
              Location not stated or not on map: {unmapped.join(", ")}
            </p>
          )}
        </GlassCard>

        <div className="flex min-w-0 flex-col gap-4">
          <GlassCard className="p-4" delay={120}>
            <h2 className="ov-section-title">Recommendation mix</h2>
            <p className="text-[12px] text-[#8193b0]">Simulated first read. Kushal records every decision.</p>
            <div className="mt-3 flex flex-wrap items-center gap-5">
              <Donut
                parts={recParts}
                center={
                  <>
                    <div className="text-[26px] font-semibold leading-none text-white">
                      <CountUp value={rows.length} />
                    </div>
                    <div className="mt-1 text-[10.5px] uppercase tracking-wider text-[#8193b0]">applications</div>
                  </>
                }
              />
              <ul className="min-w-[180px] flex-1 space-y-2">
                {recParts.map((p) => (
                  <li key={p.key} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <span className="flex items-center gap-2 text-[#d5deeb]">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color, boxShadow: `0 0 8px ${p.color}88` }} />
                      {p.label}
                    </span>
                    <span className="num font-semibold text-white">{p.value}</span>
                  </li>
                ))}
              </ul>
            </div>
            {sectors.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-[#8193b0]">Sector mix</div>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
                  {sectors.map((s) => (
                    <div key={s.label} className="ov-bar h-full" style={{ width: `${(s.n / apps.length) * 100}%`, background: s.color }} title={`${s.label}: ${s.n}`} />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-[#9fb3d1]">
                  {sectors.map((s) => (
                    <span key={s.label} className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                      {s.label} <span className="num text-white">{s.n}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </GlassCard>

          <GlassCard className="flex min-h-0 flex-1 flex-col p-4" delay={180}>
            <h2 className="ov-section-title">Pipeline by city</h2>
            <ul className="mt-2 grid max-h-[300px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {pins.map((p) => (
                <li key={p.key}>
                  <button
                    onMouseEnter={() => setCity(p.key)}
                    onFocus={() => setCity(p.key)}
                    onClick={() => setCity(city === p.key ? null : p.key)}
                    className={cx(
                      "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                      city === p.key ? "border-[#34d3b4]/50 bg-[#34d3b4]/[0.08]" : "border-white/[0.07] bg-white/[0.02] hover:border-white/20",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-white">{p.label}</span>
                      <span className="num text-[11px] text-[#8193b0]">{p.apps.length}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11.5px]">
                      {p.apps.map((a) => (
                        <span key={a.id} className="flex items-center gap-1 text-[#c3cfe1]">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: REC_COLOR[a.rec] }} />
                          {a.name}
                        </span>
                      ))}
                    </div>
                  </button>
                </li>
              ))}
              {pins.length === 0 && <li className="text-[12px] text-[#6f819e]">No applications yet.</li>}
            </ul>
          </GlassCard>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <KpiTile delay={220} href="/applications" icon={<Layers size={20} />} iconBg="#1fae96" label="Applications" value={apps.length} sub={`${ready} ready for review · ${new Set(apps.map((a) => a.batchId)).size} batch(es)`} fraction={apps.length ? ready / apps.length : 0} barColor="#34d3b4" />
        <KpiTile delay={260} href="/decisions" icon={<PhoneCall size={19} />} iconBg="#c79a2c" label="Suggested calls" value={calls} sub={`of ${evaluated} evaluated · simulated`} fraction={evaluated ? calls / evaluated : 0} barColor="#f2c14e" />
        <KpiTile delay={300} href="/decisions" icon={<Hourglass size={19} />} iconBg="#6d5bd0" label="Awaiting partner" value={awaiting} sub="sent to Kushal for a decision" />
        <KpiTile delay={340} icon={<ArrowLeftRight size={19} />} iconBg="#d9485f" label="Open conflicts" value={q.conflictsOpen} sub={`${q.conflictsDetected} deck-vs-form conflicts detected`} fraction={q.conflictsDetected ? q.conflictsOpen / q.conflictsDetected : 0} barColor="#fb7185" />
        <KpiTile delay={380} href="/research" icon={<Search size={19} />} iconBg="#2f6fd6" label="Research open" value={openResearch} sub="no research provider configured" />
        <KpiTile delay={420} href="/admin#jobs" icon={<AlertTriangle size={19} />} iconBg={problems ? "#d97706" : "#3c4c68"} label="Failed / attention" value={problems} sub={problems ? "open the application to see why" : "every file processed"} />
      </div>

      {/* signal cards */}
      <div className="ov-rise mb-3 flex flex-wrap items-end justify-between gap-3" style={{ animationDelay: "380ms" }}>
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-white">Application signals</h2>
          <p className="text-[12px] text-[#8193b0]">Each line is the 9-criterion score profile (1–5). A hollow dot on the floor means insufficient evidence, which is unknown, not zero.</p>
        </div>
        <div className="flex flex-wrap gap-3 text-[12px] text-[#c3cfe1]">
          {(["take_call", "request_info", "pass_for_consideration"] as const).map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: REC_COLOR[k], boxShadow: `0 0 8px ${REC_COLOR[k]}` }} />
              {REC_SHORT[k]}
            </span>
          ))}
        </div>
      </div>
      {rows.length ? (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {rows.map((r, i) => {
            const color = REC_COLOR[r.rec];
            const dim = city !== null && cityKey(r.location) !== city;
            return (
              <Link key={r.a.id} href={`/applications/${r.a.id}`} className={cx("ov-card ov-rise ov-hover block rounded-xl p-4 transition-opacity", dim && "opacity-35")} style={{ animationDelay: `${420 + i * 45}ms` }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold text-white">{r.a.name}</div>
                    <div className="truncate text-[12px] text-[#8193b0]">
                      {SECTOR_LABEL[r.a.sectorKey]}
                      {r.a.stage ? ` · ${r.a.stage}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="num text-[20px] font-semibold leading-none" style={{ color: r.overall === null ? "#7b8ba6" : "#fff" }}>
                      {r.overall === null ? "n/a" : r.overall.toFixed(2)}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-[#6f819e]">overall</div>
                  </div>
                </div>
                <div className="my-3">{r.profile.length ? <Sparkline values={r.profile} labels={r.labels} color={color} /> : <div className="flex h-[54px] items-center text-[12px] text-[#6f819e]">{r.a.processingStatus === "failed" ? "Processing failed — see application" : "Not evaluated yet"}</div>}</div>
                <div className="flex items-center justify-between gap-2">
                  <StatusChip rec={r.rec} />
                  <span className="flex items-center gap-2 text-[11.5px] text-[#9fb3d1]">
                    {r.conflicts > 0 && (
                      <span className="flex items-center gap-1 text-[#fda4af]" title="Open deck-vs-form conflicts">
                        <ArrowLeftRight size={12} />
                        {r.conflicts}
                      </span>
                    )}
                    {r.overlap && (
                      <span className="flex items-center text-[#fda4af]" title="Possible portfolio overlap">
                        <ShieldAlert size={12} />
                      </span>
                    )}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <GlassCard className="mb-6 p-6 text-center text-[13px] text-[#9fb3d1]">
          No applications yet. Upload this week&apos;s decks and forms from{" "}
          <Link className="text-[#5eead4] underline" href="/applications/new">
            New intake
          </Link>
          . The case batch can be restored from Administration.
        </GlassCard>
      )}

      {/* table + side panels */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <GlassCard className="overflow-hidden" delay={500}>
          <header className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
            <h2 className="ov-section-title">Batch triage — ranked by overall score</h2>
            {draining && <span className="ov-live text-[12px] text-[#5eead4]">processing…</span>}
          </header>
          <div className="ov-table">{apps.length ? <ApplicationsTable apps={sortByScore(d, apps)} compact /> : <p className="p-4 text-[12.5px] text-[#9fb3d1]">Nothing to rank yet.</p>}</div>
        </GlassCard>

        <div className="min-w-0 space-y-4">
          <GlassCard className="p-4" delay={540}>
            <h2 className="ov-section-title mb-1">Quality indicators</h2>
            <MeterRow label="Extraction coverage (core fields)" value={q.extractionCoverage} display={pct(q.extractionCoverage)} />
            <MeterRow label="Evidence traceability (signals cited)" value={q.evidenceTraceability} display={pct(q.evidenceTraceability)} color="#60a5fa" />
            <MeterRow label="Source verification rate" value={q.sourceVerificationRate} display={pct(q.sourceVerificationRate)} color="#f2c14e" note="0% until a reviewer logs independent evidence" />
            <MeterRow label="Human correction rate" value={q.humanCorrectionRate} display={pct(q.humanCorrectionRate)} color="#a78bfa" />
            <MeterRow label="Failure rate" value={q.failureRate} display={pct(q.failureRate)} color="#fb7185" />
            <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
              {[
                ["Conflicts open", `${q.conflictsOpen} / ${q.conflictsDetected}`],
                ["Critical unknowns", String(q.criticalUnknowns)],
                ["Agreement", q.decisionsRecorded ? `${pct(q.recommendationAgreement)} (n=${q.decisionsRecorded})` : "no decisions yet"],
                ["Avg processing", q.avgProcessingMs === null ? "—" : `${Math.round(q.avgProcessingMs)} ms`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                  <div className="text-[10.5px] uppercase tracking-wider text-[#6f819e]">{k}</div>
                  <div className="num mt-0.5 font-semibold text-white">{v}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-[#6f819e]">Source verification is 0% until a reviewer logs independent evidence. Nothing is auto-verified.</p>
          </GlassCard>

          <GlassCard className="p-4" delay={580}>
            <h2 className="ov-section-title mb-2">AI providers</h2>
            <ul className="space-y-2.5">
              {PROVIDERS.map((p) => {
                const s = p.status();
                const on = s.state === "active";
                return (
                  <li key={s.id} className="text-[12.5px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-medium text-white">
                        {s.simulated && <FlaskConical size={12} className="text-[#f2c14e]" />}
                        {s.label}
                      </span>
                      <span className={cx("rounded-full px-2 py-0.5 text-[10.5px] font-medium", on ? "bg-[#34d3b4]/15 text-[#5eead4]" : "bg-white/[0.06] text-[#8193b0]")}>{s.state.replace("_", " ")}</span>
                    </div>
                    <div className="text-[11.5px] text-[#8193b0]">{s.detail}</div>
                  </li>
                );
              })}
            </ul>
          </GlassCard>

          <GlassCard className="border-[#f2c14e]/20 p-4" delay={620}>
            <h2 className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-[#f2c14e]">
              <Clock size={14} /> Associate time
            </h2>
            <p className="text-[12.5px] text-[#c3cfe1]">
              First-pass triage takes Riya ~30 minutes per application (case brief). This batch of {apps.length} ≈ {((apps.length * 30) / 60).toFixed(1)} hours manually. The platform does the first read; Riya&apos;s time goes to research and verification.
            </p>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
