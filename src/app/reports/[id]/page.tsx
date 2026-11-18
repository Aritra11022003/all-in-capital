"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Download, Printer, FlaskConical } from "lucide-react";
import { useData } from "@/lib/store";
import { buildReport, reportToMarkdown } from "@/lib/engine/reports/report";
import { latestEvaluation } from "@/lib/domain/workspace";
import { Button, Empty, download } from "@/components/ui";

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const d = useData();
  const app = d.applications.find((a) => a.id === id);
  if (!app) return <Empty title="Application not found" />;
  if (!latestEvaluation(d, id)) return <Empty title="Not evaluated yet">This application has no evaluation, so no report can be generated.</Empty>;
  const r = buildReport(d, id);
  return (
    <div className="mx-auto max-w-[960px]">
      <div className="no-print mb-3 flex items-center justify-between">
        <Link href={`/applications/${id}`} className="text-[12px] text-muted hover:underline">← Back to application</Link>
        <div className="flex gap-2">
          <Button onClick={() => window.print()}><Printer size={14} /> Print / PDF</Button>
          <Button variant="primary" onClick={() => download(`${app.name.replace(/\W+/g, "_")}_assessment.md`, reportToMarkdown(r), "text/markdown")}><Download size={14} /> Markdown</Button>
        </div>
      </div>
      <article className="rounded-lg border border-line bg-surface px-8 py-7">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gold-700">All In Capital · Investment assessment · Confidential</div>
        <h1 className="text-2xl font-semibold text-navy-900">{app.name}</h1>
        {r.subtitle && <p className="text-muted">{r.subtitle}</p>}
        <div className="mt-3 flex items-start gap-2 rounded-md border border-gold-100 bg-gold-50 px-3 py-2 text-[12px] text-gold-700">
          <FlaskConical size={14} className="mt-0.5 shrink-0" /> {r.simulatedBanner}
        </div>
        {r.sections.map((s) => (
          <section key={s.id} className="mt-6 break-inside-avoid-page">
            <h2 className="mb-2 border-b border-line pb-1 text-[15px] font-semibold text-navy-800">{s.title}</h2>
            {s.paragraphs.map((p, i) => <p key={i} className="mb-1.5 text-[13px]">{p}</p>)}
            {s.table && s.table.rows.length > 0 && (
              <table className="dt mb-2">
                <thead><tr>{s.table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{s.table.rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j} className="text-[12.5px]">{c}</td>)}</tr>)}</tbody>
              </table>
            )}
            {s.bullets && s.bullets.length > 0 && (
              <ul className="space-y-0.5 pl-4 text-[12.5px]">
                {s.bullets.map((b, i) => (
                  <li key={i} className={b.startsWith("(−)") ? "text-risk-700" : b.startsWith("(+)") ? "text-teal-700" : b.startsWith("(unknown)") || b.startsWith("Critical") ? "text-warn-700" : ""}>{b}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
        <footer className="mt-8 border-t border-line pt-2 text-[11px] text-faint">Generated {r.generatedAt.slice(0, 19).replace("T", " ")} UTC. Recommendations are suggestions for partner consideration; final outcomes are recorded only by Kushal.</footer>
      </article>
    </div>
  );
}
