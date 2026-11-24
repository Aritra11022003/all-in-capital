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
import { Badge, cx } from "@/components/ui";
import { Card, CITY_COORDS, cityKey, CountUp, Donut, IndiaPipelineMap, KpiTile, MeterRow, REC_COLOR, REC_GLOW, REC_SHORT, Sparkline, StatusChip, type MapPin as Pin } from "@/components/overview-graphics";

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
type RecKey = Recommendation | "none";
const REC_ORDER: RecKey[] = ["take_call", "request_info", "pass_for_consideration", "none"];
const SECTOR_COLORS = ["#143a2e", "#138a73", "#b3832b", "#c0573f", "#6b3f73", "#4b7f6d", "#d9b56a", "#8a938d"];

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
        const ov = latestOverlap(d, a.id);
        return {
          a,
          ev,
          rec: (ev?.recommendation ?? "none") as RecKey,
          overall: ev ? effectiveOverall(d, ev) : null,
          profile: ev ? ev.assessments.map((x) => effectiveAssessment(d, ev, x.criterion).score) : [],
          labels: ev ? ev.assessments.map((x) => CRITERION_SHORT[x.criterion as CriterionId]) : [],
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
      const pin = m.get(k) ?? { key: k, label: titleCase(k), lon: c[0], lat: c[1], state: c[2], apps: [] };
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
  const maxSector = Math.max(1, ...sectors.map((s) => s.n));

  return (
    <div>
      {/* header */}
      <div className="ov-rise mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-700">
            {ROLE_INFO[role].name} · {ROLE_INFO[role].title}
          </div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-navy-900">Deal-flow Intelligence</h1>
          <p className="mt-1 max-w-3xl text-[13.5px] text-muted">
            This week&apos;s applications, scored criterion by criterion against the proposed thesis, with the source behind each claim and the gaps named. Recommendations are simulated and never final.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-8 items-center gap-2 rounded-full border border-teal-100 bg-teal-50 px-3 text-[12px] font-medium text-teal-700" title="Scores come from the rule-based MockAIProvider; nothing is externally verified.">
            <span className={cx("h-2 w-2 rounded-full bg-teal-600", draining && "ov-live")} />
            {draining ? "Processing intake…" : "Batch scored · simulated"}
          </span>
          <Link href="/decisions" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink transition-colors hover:bg-navy-50">
            <Gavel size={14} /> Decision room {awaiting > 0 && <Badge tone="gold">{awaiting}</Badge>}
          </Link>
          <Link href="/applications/new" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-navy-800 px-3 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-navy-700">
            <Plus size={14} /> New intake
          </Link>
        </div>
      </div>

      {/* hero: map + city pipeline */}
      <section className="ov-hero ov-rise mb-5 overflow-hidden rounded-2xl" style={{ animationDelay: "60ms" }}>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="relative px-3 pt-4 sm:px-6">
            <div className="mx-auto aspect-[692/724] w-full max-w-[560px]">
              <IndiaPipelineMap pins={pins} selected={city} onSelect={setCity} />
            </div>
            {pins.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="rounded-lg bg-navy-950/80 px-4 py-3 text-center text-[12.5px] text-navy-100">
                  No locations yet. <Link href="/applications/new" className="text-[#8fe3c6] underline">Start an intake</Link>.
                </div>
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col border-t border-white/10 p-5 sm:p-6 lg:border-l lg:border-t-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#eab54e]">Batch geography</div>
            <h2 className="mt-1 text-[22px] font-semibold leading-tight tracking-tight text-white">Where this batch comes from</h2>
            <p className="mt-1 text-[12.5px] text-[#a9c2b7]">Head-office cities as the applicants reported them (unverified). Hover a city to trace its companies.</p>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                ["Cities", pins.length],
                ["States", new Set(pins.map((p) => p.state)).size],
                ["Mapped", rows.length - unmapped.length],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                  <div className="text-[22px] font-semibold leading-none text-white">
                    <CountUp value={v as number} />
                  </div>
                  <div className="mt-1 text-[10.5px] uppercase tracking-wider text-[#8fb0a2]">{k}</div>
                </div>
              ))}
            </div>

            <ul className="mt-4 grid max-h-[340px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {pins.map((p) => {
                const on = city === p.key;
                return (
                  <li key={p.key}>
                    <button
                      onMouseEnter={() => setCity(p.key)}
                      onFocus={() => setCity(p.key)}
                      onClick={() => setCity(on ? null : p.key)}
                      className={cx("w-full rounded-xl border px-3 py-2.5 text-left transition-all", on ? "border-[#8fe3c6]/60 bg-white/[0.10]" : "border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]")}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[13.5px] font-semibold text-white">{p.label}</span>
                        <span className="num rounded-full bg-[#eab54e]/15 px-2 text-[11px] font-semibold text-[#eab54e]">{p.apps.length}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11.5px]">
                        {p.apps.map((a) => (
                          <span key={a.id} className="flex items-center gap-1 text-[#c9dbd3]">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: REC_GLOW[a.rec] }} />
                            {a.name}
                          </span>
                        ))}
                      </div>
                    </button>
                  </li>
                );
              })}
              {pins.length === 0 && <li className="text-[12px] text-[#8fb0a2]">No applications yet.</li>}
            </ul>

            <div className="mt-auto pt-4">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-[#c9dbd3]">
                {(["take_call", "request_info", "pass_for_consideration"] as const).map((k) => (
                  <span key={k} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: REC_GLOW[k], boxShadow: `0 0 8px ${REC_GLOW[k]}` }} />
                    {REC_SHORT[k]}
                  </span>
                ))}
              </div>
              {unmapped.length > 0 && (
                <p className="mt-2 text-[11px] text-[#8fb0a2]">
                  <MapPin size={11} className="mr-1 inline" />
                  Location not stated or not recognised: {unmapped.join(", ")}
                </p>
              )}
              <p className="mt-1 text-[10px] text-[#6f8f82]">Map geometry: svg-maps (CC BY 4.0).</p>
            </div>
          </div>
        </div>
      </section>

      {/* KPI tiles */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <KpiTile delay={160} href="/applications" tone="evergreen" icon={<Layers size={20} />} label="Applications" value={apps.length} sub={`${ready} ready for review · ${new Set(apps.map((a) => a.batchId)).size} batch(es)`} fraction={apps.length ? ready / apps.length : 0} />
        <KpiTile delay={200} href="/decisions" tone="jade" icon={<PhoneCall size={19} />} label="Suggested calls" value={calls} sub={`of ${evaluated} evaluated · simulated`} fraction={evaluated ? calls / evaluated : 0} />
        <KpiTile delay={240} href="/decisions" tone="plum" icon={<Hourglass size={19} />} label="Awaiting partner" value={awaiting} sub="sent to Kushal for a decision" />
        <KpiTile delay={280} tone="terracotta" icon={<ArrowLeftRight size={19} />} label="Open conflicts" value={q.conflictsOpen} sub={`${q.conflictsDetected} conflicts detected across documents`} fraction={q.conflictsDetected ? q.conflictsOpen / q.conflictsDetected : 0} />
        <KpiTile delay={320} href="/research" tone="brass" icon={<Search size={19} />} label="Research open" value={openResearch} sub="no research provider configured" />
        <KpiTile delay={360} href="/admin#jobs" tone={problems ? "terracotta" : "slate"} icon={<AlertTriangle size={19} />} label="Failed / attention" value={problems} sub={problems ? "open the application to see why" : "every file processed"} />
      </div>

      {/* mix */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5" delay={380}>
          <h2 className="ov-title">Recommendation mix</h2>
          <p className="text-[12px] text-faint">Simulated first read. Kushal records every decision.</p>
          <div className="mt-4 flex flex-wrap items-center gap-6">
            <Donut
              parts={recParts}
              center={
                <>
                  <div className="text-[26px] font-semibold leading-none text-navy-900">
                    <CountUp value={rows.length} />
                  </div>
                  <div className="mt-1 text-[10.5px] uppercase tracking-wider text-faint">applications</div>
                </>
              }
            />
            <ul className="min-w-[200px] flex-1 space-y-2.5">
              {recParts.map((p) => (
                <li key={p.key}>
                  <div className="flex items-center justify-between gap-3 text-[12.5px]">
                    <span className="flex items-center gap-2 text-ink">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
                      {p.label}
                    </span>
                    <span className="num font-semibold text-navy-900">{p.value}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#efece4]">
                    <div className="ov-bar h-full rounded-full" style={{ width: `${rows.length ? (p.value / rows.length) * 100 : 0}%`, background: p.color }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Card>
        <Card className="p-5" delay={420}>
          <h2 className="ov-title">Sector mix</h2>
          <p className="text-[12px] text-faint">Sector as classified from the documents (the applicant&apos;s own selection is kept on each record).</p>
          <ul className="mt-4 space-y-2.5">
            {sectors.map((s) => (
              <li key={s.label} className="grid grid-cols-[120px_minmax(0,1fr)_28px] items-center gap-3 text-[12.5px]">
                <span className="truncate text-ink">{s.label}</span>
                <div className="h-2.5 overflow-hidden rounded-full bg-[#efece4]">
                  <div className="ov-bar h-full rounded-full" style={{ width: `${(s.n / maxSector) * 100}%`, background: s.color }} />
                </div>
                <span className="num text-right font-semibold text-navy-900">{s.n}</span>
              </li>
            ))}
            {sectors.length === 0 && <li className="text-[12px] text-faint">No applications yet.</li>}
          </ul>
        </Card>
      </div>

      {/* signal cards */}
      <div className="ov-rise mb-3 flex flex-wrap items-end justify-between gap-3" style={{ animationDelay: "440ms" }}>
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-navy-900">Application signals</h2>
          <p className="text-[12px] text-faint">Each line is the 9-criterion score profile (1–5). A hollow dot on the floor means insufficient evidence, which is unknown, not zero.</p>
        </div>
        <div className="flex flex-wrap gap-3 text-[12px] text-muted">
          {(["take_call", "request_info", "pass_for_consideration"] as const).map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: REC_COLOR[k] }} />
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
              <Link
                key={r.a.id}
                href={`/applications/${r.a.id}`}
                className={cx("ov-card ov-rise ov-hover relative block overflow-hidden rounded-xl p-4 transition-opacity", dim && "opacity-40")}
                style={{ animationDelay: `${460 + i * 40}ms` }}
              >
                <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: color }} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold text-navy-900">{r.a.name}</div>
                    <div className="truncate text-[12px] text-faint">
                      {SECTOR_LABEL[r.a.sectorKey]}
                      {r.a.stage ? ` · ${r.a.stage}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={cx("num text-[20px] font-semibold leading-none", r.overall === null ? "text-faint" : "text-navy-900")}>{r.overall === null ? "n/a" : r.overall.toFixed(2)}</div>
                    <div className="text-[10px] uppercase tracking-wider text-faint">overall</div>
                  </div>
                </div>
                <div className="my-3">
                  {r.profile.length ? (
                    <Sparkline values={r.profile} labels={r.labels} color={color} />
                  ) : (
                    <div className="flex h-[54px] items-center text-[12px] text-faint">{r.a.processingStatus === "failed" ? "Processing failed — see application" : "Not evaluated yet"}</div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <StatusChip rec={r.rec} />
                  <span className="flex items-center gap-2 text-[11.5px]">
                    {r.conflicts > 0 && (
                      <span className="flex items-center gap-1 text-risk-700" title="Open conflicts between documents">
                        <ArrowLeftRight size={12} />
                        {r.conflicts}
                      </span>
                    )}
                    {r.overlap && (
                      <span className="flex items-center text-risk-700" title="Possible portfolio overlap">
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
        <Card className="mb-6 p-6 text-center text-[13px] text-muted">
          No applications yet. Upload this week&apos;s decks and forms from{" "}
          <Link className="text-teal-700 underline" href="/applications/new">
            New intake
          </Link>
          . The case batch can be restored from Administration.
        </Card>
      )}

      {/* table + side panels */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <Card className="overflow-hidden" delay={500}>
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="ov-title">Batch triage — ranked by overall score</h2>
            {draining && <Badge tone="navy">processing…</Badge>}
          </header>
          {apps.length ? <ApplicationsTable apps={sortByScore(d, apps)} compact /> : <p className="p-4 text-[12.5px] text-muted">Nothing to rank yet.</p>}
        </Card>

        <div className="min-w-0 space-y-4">
          <Card className="p-4" delay={540}>
            <h2 className="ov-title mb-1">Quality indicators</h2>
            <MeterRow label="Extraction coverage (core fields)" value={q.extractionCoverage} display={pct(q.extractionCoverage)} color="#143a2e" />
            <MeterRow label="Evidence traceability (signals cited)" value={q.evidenceTraceability} display={pct(q.evidenceTraceability)} color="#138a73" />
            <MeterRow label="Source verification rate" value={q.sourceVerificationRate} display={pct(q.sourceVerificationRate)} color="#b3832b" note="0% until a reviewer logs independent evidence" />
            <MeterRow label="Human correction rate" value={q.humanCorrectionRate} display={pct(q.humanCorrectionRate)} color="#6b3f73" />
            <MeterRow label="Failure rate" value={q.failureRate} display={pct(q.failureRate)} color="#c0573f" />
            <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
              {[
                ["Conflicts open", `${q.conflictsOpen} / ${q.conflictsDetected}`],
                ["Critical unknowns", String(q.criticalUnknowns)],
                ["Agreement", q.decisionsRecorded ? `${pct(q.recommendationAgreement)} (n=${q.decisionsRecorded})` : "no decisions yet"],
                ["Avg processing", q.avgProcessingMs === null ? "—" : `${Math.round(q.avgProcessingMs)} ms`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-line bg-paper px-2.5 py-2">
                  <div className="text-[10.5px] uppercase tracking-wider text-faint">{k}</div>
                  <div className="num mt-0.5 font-semibold text-navy-900">{v}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-faint">Source verification is 0% until a reviewer logs independent evidence. Nothing is auto-verified.</p>
          </Card>

          <Card className="p-4" delay={580}>
            <h2 className="ov-title mb-2">AI providers</h2>
            <ul className="space-y-2.5">
              {PROVIDERS.map((p) => {
                const s = p.status();
                return (
                  <li key={s.id} className="text-[12.5px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-medium text-ink">
                        {s.simulated && <FlaskConical size={12} className="text-gold-600" />}
                        {s.label}
                      </span>
                      <Badge tone={s.state === "active" ? "teal" : "neutral"}>{s.state.replace("_", " ")}</Badge>
                    </div>
                    <div className="text-[11.5px] text-muted">{s.detail}</div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="border-gold-100 bg-gold-50 p-4" delay={620}>
            <h2 className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-gold-700">
              <Clock size={14} /> Associate time
            </h2>
            <p className="text-[12.5px] text-ink">
              First-pass triage takes Riya ~30 minutes per application (case brief). This batch of {apps.length} ≈ {((apps.length * 30) / 60).toFixed(1)} hours manually. The platform does the first read; Riya&apos;s time goes to research and verification.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
