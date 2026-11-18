"use client";
import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useData } from "@/lib/store";
import { latestEvaluation } from "@/lib/domain/workspace";
import { DECISION_LABEL, PROCESSING_LABEL, RECOMMENDATION_LABEL, SECTOR_LABEL } from "@/lib/shared/labels";
import { ApplicationsTable, sortByScore } from "@/components/app-table";
import { Button, Empty, PageHeader, Panel, inputCls } from "@/components/ui";

export default function ApplicationsPage() {
  const d = useData();
  const [q, setQ] = useState("");
  const [proc, setProc] = useState("");
  const [dec, setDec] = useState("");
  const [rec, setRec] = useState("");
  const [sector, setSector] = useState("");
  const apps = sortByScore(
    d,
    d.applications.filter((a) => {
      const ev = latestEvaluation(d, a.id);
      return (
        (!q || `${a.name} ${a.oneLiner ?? ""}`.toLowerCase().includes(q.toLowerCase())) &&
        (!proc || a.processingStatus === proc) &&
        (!dec || a.decisionStatus === dec) &&
        (!rec || ev?.recommendation === rec) &&
        (!sector || a.sectorKey === sector)
      );
    }),
  );
  const sel = (v: string, set: (s: string) => void, opts: Record<string, string>, label: string) => (
    <select aria-label={label} value={v} onChange={(e) => set(e.target.value)} className={`${inputCls} w-auto`}>
      <option value="">{label}: all</option>
      {Object.entries(opts).map(([k, l]) => (
        <option key={k} value={k}>
          {l}
        </option>
      ))}
    </select>
  );
  return (
    <div>
      <PageHeader
        title="Applications"
        subtitle="Processing status (technical) and decision status (human) are tracked separately. A failed extraction never shows as a pass."
        actions={
          <Link href="/applications/new">
            <Button variant="primary">
              <Plus size={14} /> New intake
            </Button>
          </Link>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <input aria-label="Search" placeholder="Search company or description…" value={q} onChange={(e) => setQ(e.target.value)} className={`${inputCls} w-64`} />
        {sel(proc, setProc, PROCESSING_LABEL, "Processing")}
        {sel(dec, setDec, DECISION_LABEL, "Decision")}
        {sel(rec, setRec, RECOMMENDATION_LABEL, "Recommendation")}
        {sel(sector, setSector, SECTOR_LABEL, "Sector")}
      </div>
      <Panel dense title={`${apps.length} of ${d.applications.length} applications`}>
        {apps.length ? <ApplicationsTable apps={apps} /> : <div className="p-4"><Empty title="No applications match these filters" /></div>}
      </Panel>
    </div>
  );
}
