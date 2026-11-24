"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Download, RotateCcw, Upload, Zap } from "lucide-react";
import { useData, useRole, useStore } from "@/lib/store";
import { can, MATRIX, ROLE_INFO, type Action } from "@/lib/domain/permissions";
import { PROVIDERS } from "@/lib/engine/evaluation/provider";
import type { Role } from "@/lib/shared/types";
import { AppLink } from "@/components/domain";
import { Badge, Button, Callout, Modal, PageHeader, Panel, download } from "@/components/ui";

export default function AdminPage() {
  const d = useData();
  const role = useRole();
  const reset = useStore((s) => s.resetWorkspace);
  const importWs = useStore((s) => s.importWorkspace);
  const drill = useStore((s) => s.failureDrill);
  const [confirm, setConfirm] = useState<null | "seed" | "empty">(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const appName = (id?: string) => (id ? d.applications.find((a) => a.id === id)?.name ?? id : "");
  return (
    <div>
      <PageHeader title="Administration" subtitle="Users and roles, AI provider status, the processing queue, the audit log, and backup / restore for the demo workspace." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Users and roles">
          <table className="w-full text-[12.5px]">
            <tbody>
              {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
                <tr key={r} className="border-b border-line last:border-0">
                  <td className="py-1.5 font-medium">{ROLE_INFO[r].name}</td>
                  <td><Badge tone="navy">{ROLE_INFO[r].title}</Badge></td>
                  <td className="text-muted">{ROLE_INFO[r].summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2">
            <Callout tone="navy">Demo mode: no login wall; switch roles in the top bar. Production mode uses invite-only Supabase Auth with roles in <span className="font-mono">profiles.role</span> and Row Level Security (see <span className="font-mono">supabase/migrations</span>).</Callout>
          </div>
        </Panel>
        <Panel title="AI providers">
          {PROVIDERS.map((p) => {
            const s = p.status();
            return (
              <div key={s.id} className="mb-2 text-[12.5px]">
                <div className="flex items-center justify-between"><b>{s.label}</b><Badge tone={s.state === "active" ? "teal" : "neutral"}>{s.state.replace("_", " ")}</Badge></div>
                <div className="text-muted">{s.detail}</div>
              </div>
            );
          })}
          <div className="mt-2 flex items-center gap-2">
            <Button onClick={() => drill()}><Zap size={13} /> Run AI-failure drill</Button>
            <span className="text-[11.5px] text-muted">Creates a test application whose evaluation fails, to show it ends up Failed, not passed.</span>
          </div>
        </Panel>
      </div>
      <div className="mt-4">
        <Panel dense title="Permission matrix (enforced on every action)">
          <div className="overflow-x-auto">
            <table className="dt">
              <thead><tr><th>Action</th>{(Object.keys(ROLE_INFO) as Role[]).map((r) => <th key={r}>{ROLE_INFO[r].name.split(" ")[0]}</th>)}</tr></thead>
              <tbody>
                {(Object.keys(MATRIX) as Action[]).map((a) => (
                  <tr key={a}>
                    <td className="font-mono text-[11.5px]">{a}</td>
                    {(Object.keys(ROLE_INFO) as Role[]).map((r) => <td key={r}>{MATRIX[a].includes(r) ? <Badge tone="ok">{a === "document.view" && r === "aditya" ? "if shared by Kushal" : "allowed"}</Badge> : <span className="text-faint">—</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <div className="mt-4" id="jobs">
        <Panel dense title={`Processing queue (${d.jobs.length} jobs, concurrency 1)`}>
          <div className="max-h-[320px] overflow-y-auto">
            <table className="dt">
              <thead><tr><th>Job</th><th>Application</th><th>Status</th><th>Step</th><th>Attempts</th><th>Duration</th><th>Error</th></tr></thead>
              <tbody>
                {[...d.jobs].reverse().map((j) => (
                  <tr key={j.id}>
                    <td className="font-mono text-[11px]">{j.id}</td>
                    <td><AppLink id={j.applicationId} name={appName(j.applicationId)} /></td>
                    <td><Badge tone={j.status === "succeeded" ? "ok" : j.status === "failed" ? "risk" : "navy"}>{j.status}</Badge></td>
                    <td className="text-[12px]">{j.step}</td>
                    <td className="num">{j.attempts}</td>
                    <td className="num">{j.durationMs !== undefined ? `${j.durationMs} ms` : "—"}</td>
                    <td className="max-w-[320px] text-[12px] text-risk-700">{j.error}{j.status === "failed" && <> · <Link href="/applications/new" className="underline">re-upload</Link></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel dense title={`Audit log (${d.audit.length} events)`}>
          <div className="max-h-[420px] overflow-y-auto">
            <table className="dt">
              <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Application</th><th>Detail</th></tr></thead>
              <tbody>
                {d.audit.slice(0, 300).map((e) => (
                  <tr key={e.id}>
                    <td className="num whitespace-nowrap text-[11.5px]">{e.at.slice(0, 19).replace("T", " ")}</td>
                    <td className="whitespace-nowrap text-[12px]">{e.actor === "system" ? "System" : ROLE_INFO[e.actor].name}</td>
                    <td className="font-mono text-[11px]">{e.action}</td>
                    <td className="whitespace-nowrap text-[12px]">{appName(e.applicationId)}</td>
                    <td className="text-[12px]">{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Backup, restore and reset">
          <p className="mb-2 text-[12.5px] text-muted">Demo data lives only in this browser. Export a JSON backup to keep it or move it to another machine.</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!can(role, "admin.export")} onClick={() => download(`aic-workspace-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(d, null, 1), "application/json")}><Download size={13} /> Export JSON</Button>
            <Button disabled={!can(role, "admin.reset")} onClick={() => fileRef.current?.click()}><Upload size={13} /> Import JSON</Button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) importWs(await f.text()); e.target.value = ""; }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
            <Button disabled={!can(role, "admin.reset")} onClick={() => setConfirm("seed")}><RotateCcw size={13} /> Reset to case batch</Button>
            <Button variant="danger" disabled={!can(role, "admin.reset")} onClick={() => setConfirm("empty")}>Reset to empty</Button>
          </div>
          {!can(role, "admin.reset") && <p className="mt-2 text-[11.5px] text-faint">Reset and import are Kushal-only.</p>}
        </Panel>
      </div>
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Reset workspace?"
        footer={<><Button onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" onClick={async () => { const m = confirm; setConfirm(null); await reset(m === "seed"); }}>Reset</Button></>}
      >
        <p className="text-[13px]">This permanently deletes all applications, decisions, corrections and audit history stored in this browser{confirm === "seed" ? ", then reloads the 10-application case batch" : ""}. Export a backup first if you need it. This cannot be undone.</p>
      </Modal>
    </div>
  );
}
