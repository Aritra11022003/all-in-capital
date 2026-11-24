"use client";
import { useState } from "react";
import { useData, useRole, useStore } from "@/lib/store";
import { can } from "@/lib/domain/permissions";
import { activePortfolio, addPortfolioCompany, latestOverlap, rerunOverlap, setPortfolioVerified } from "@/lib/domain/workspace";
import { profileFromStore } from "@/lib/domain/profile";
import { INCOMPLETE_PORTFOLIO_WARNING } from "@/config/portfolio";
import { RELATIONSHIP_LABEL } from "@/lib/shared/labels";
import { AppLink } from "@/components/domain";
import { Badge, Button, Callout, Field, PageHeader, Panel, inputCls } from "@/components/ui";

export default function PortfolioPage() {
  const d = useData();
  const role = useRole();
  const act = useStore((s) => s.act);
  const ds = activePortfolio(d);
  const [f, setF] = useState({ name: "", sector: "", description: "", cat: "", cust: "", chan: "", source: "" });
  const [att, setAtt] = useState("");
  const split = (s: string) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const rerunAll = () =>
    act((w, r) => {
      for (const a of w.applications.filter((x) => x.processingStatus !== "failed")) rerunOverlap(w, r, a.id, profileFromStore(w, a.id));
    }, `Overlap re-checked for all applications against ${ds.version}.`);
  return (
    <div>
      <PageHeader
        title="Portfolio"
        subtitle="Every application is checked against every company in the portfolio dataset, not memory (Meeting 4). The dataset holds only the 7 companies named in the case, so “no overlap” is not a clearance. False alarms are preferred to misses, but a possible conflict is never shown as confirmed until Kushal reviews it."
        actions={<Button onClick={rerunAll}>Re-run overlap for all applications</Button>}
      />
      {!ds.verified && <div className="mb-3"><Callout tone="warn" title={INCOMPLETE_PORTFOLIO_WARNING}>{ds.note}</Callout></div>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel dense title={`Portfolio dataset ${ds.version} — ${ds.companies.length} companies`} actions={<Badge tone={ds.verified ? "ok" : "warn"}>{ds.verified ? "verified complete" : "unverified / incomplete"}</Badge>}>
          <table className="dt">
            <thead><tr><th>Company</th><th>Sector</th><th>Description</th><th>Match terms</th><th>Source</th></tr></thead>
            <tbody>
              {ds.companies.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.name}</td>
                  <td className="whitespace-nowrap text-[12px]">{c.sector}</td>
                  <td className="max-w-[300px] text-[12.5px]">{c.description}</td>
                  <td className="max-w-[260px] text-[11px] text-muted">{[...c.categoryTerms, ...c.customerTerms].join(", ")}</td>
                  <td className="text-[11.5px] text-muted">{c.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <div className="space-y-4">
          {can(role, "portfolio.edit") && (
            <Panel title="Add portfolio company">
              <Field label="Name" required><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Sector"><input className={inputCls} value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })} /></Field>
              <Field label="Description"><input className={inputCls} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
              <Field label="Category terms (comma-separated)" required hint="What the company does — used to detect competitors"><input className={inputCls} value={f.cat} onChange={(e) => setF({ ...f, cat: e.target.value })} placeholder="e.g. expense management, corporate cards" /></Field>
              <Field label="Customer terms"><input className={inputCls} value={f.cust} onChange={(e) => setF({ ...f, cust: e.target.value })} /></Field>
              <Field label="Channel terms"><input className={inputCls} value={f.chan} onChange={(e) => setF({ ...f, chan: e.target.value })} /></Field>
              <Field label="Source"><input className={inputCls} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="e.g. fund portfolio register" /></Field>
              <Button variant="primary" onClick={() => !act((w, r) => { addPortfolioCompany(w, r, { name: f.name, sector: f.sector, description: f.description, categoryTerms: split(f.cat), customerTerms: split(f.cust), channelTerms: split(f.chan), source: f.source || "Added manually" }); }, "Added. New dataset version created; re-run overlap to apply.") && setF({ name: "", sector: "", description: "", cat: "", cust: "", chan: "", source: "" })}>Add (new dataset version)</Button>
            </Panel>
          )}
          {can(role, "overlap.review") && (
            <Panel title="Dataset verification">
              <p className="mb-2 text-[12.5px] text-muted">Only mark complete when the list has been checked against the fund&apos;s full portfolio register. Until then, every &quot;no match&quot; result carries the incomplete warning.</p>
              <Field label="Attestation"><input className={inputCls} value={att} onChange={(e) => setAtt(e.target.value)} placeholder="e.g. Checked against Fund I + II register, 18 Nov" /></Field>
              <Button onClick={() => act((w, r) => setPortfolioVerified(w, r, !ds.verified, att), ds.verified ? "Marked unverified." : "Marked verified complete.")}>{ds.verified ? "Mark as unverified" : "Mark complete & verified"}</Button>
            </Panel>
          )}
          <Panel title="Dataset versions">
            {[...d.portfolioDatasets].reverse().map((p) => <div key={p.version} className="mb-1 text-[12px]"><b>{p.version}</b> · {p.companies.length} companies · {p.verified ? "verified" : "unverified"} · {p.createdAt.slice(0, 10)}</div>)}
          </Panel>
        </div>
      </div>
      <div className="mt-4">
        <Panel dense title="Overlap review — latest check per application">
          <table className="dt">
            <thead><tr><th>Application</th><th>Dataset</th><th>Result</th><th>Possible overlaps</th><th>Reviewer</th></tr></thead>
            <tbody>
              {d.applications.map((a) => {
                const o = latestOverlap(d, a.id);
                return (
                  <tr key={a.id}>
                    <td><AppLink id={a.id} name={a.name} /></td>
                    <td className="font-mono text-[11px]">{o?.datasetVersion ?? "—"}</td>
                    <td className="max-w-[320px] text-[12px]">{o ? <Badge tone={o.results.length ? "risk" : o.status === "no_match_verified" ? "ok" : "warn"}>{o.status.replace(/_/g, " ")}</Badge> : "—"}</td>
                    <td className="text-[12.5px]">{o?.results.map((r) => <div key={r.portfolioId}><b>{r.portfolioName}</b> — {RELATIONSHIP_LABEL[r.relationship]} <span className="text-faint">({r.matchedTerms.slice(0, 4).join(", ")})</span></div>) ?? "—"}</td>
                    <td className="text-[12px]">{o ? o.reviewerDecision.replace(/_/g, " ") : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
