"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { FileUp, Loader2, Trash2, Upload, ClipboardPaste, CheckCircle2, AlertTriangle, Copy } from "lucide-react";
import { useData, useRole, useStore } from "@/lib/store";
import { can } from "@/lib/domain/permissions";
import { prepareIntake, prepareTextIntake, type IntakeGroup } from "@/lib/domain/intake";
import { MAX_FILE_BYTES, SUPPORTED_EXTENSIONS } from "@/lib/engine/extraction/files";
import { classifyDoc } from "@/lib/engine/pipeline";
import { AppLink, DecisionBadge, ProcessingBadge } from "@/components/domain";
import { Badge, Button, Callout, Field, PageHeader, Panel, Tabs, inputCls, cx } from "@/components/ui";

type Mode = "files" | "paste";

export default function IntakePage() {
  const role = useRole();
  const d = useData();
  const submitGroups = useStore((s) => s.submitGroups);
  const toast = useStore((s) => s.toast);
  const [mode, setMode] = useState<Mode>("files");
  const [files, setFiles] = useState<File[]>([]);
  const [single, setSingle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState<IntakeGroup[] | null>(null);
  const [created, setCreated] = useState<string[]>([]);
  const [paste, setPaste] = useState({ company: "", deck: "", form: "" });
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const allowed = can(role, "application.create");

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    setFiles(next);
    setGroups(null);
    setCreated([]);
  };

  const run = async () => {
    setBusy(true);
    setCreated([]);
    try {
      let gs: IntakeGroup[];
      if (mode === "files") {
        if (!files.length) throw new Error("Choose at least one file.");
        const raw = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
        gs = await prepareIntake(useStore.getState().data, raw, { singleApplication: single });
      } else {
        if (!paste.deck.trim() && !paste.form.trim()) throw new Error("Paste deck text, form text, or both.");
        gs = [await prepareTextIntake({ companyHint: paste.company, deckText: paste.deck, formText: paste.form })];
      }
      setGroups(gs);
      const ids = await submitGroups(gs);
      setCreated(ids);
      const dups = gs.flatMap((g) => g.duplicates);
      if (dups.length && !ids.length) toast("info", `All files were already received (${dups.map((x) => x.existingApp).join(", ")}). Nothing new created.`);
      else if (ids.length) toast("success", `${ids.length} application(s) received and queued for processing.`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createdApps = d.applications.filter((a) => created.includes(a.id));

  return (
    <div>
      <PageHeader
        kicker="Applications"
        title="Application intake"
        subtitle="Upload a week's pile at once. Files are read in this browser (nothing is sent to an AI service), checked for duplicates, grouped by company and processed one at a time."
      />
      {!allowed && (
        <div className="mb-3">
          <Callout tone="warn">Your role cannot create applications. Switch to Riya (Associate) or Kushal (Principal) in the top bar.</Callout>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <Tabs<Mode>
            value={mode}
            onChange={(m) => {
              setMode(m);
              setGroups(null);
            }}
            tabs={[
              { id: "files", label: <span className="flex items-center gap-1.5"><Upload size={13} /> Upload files</span> },
              { id: "paste", label: <span className="flex items-center gap-1.5"><ClipboardPaste size={13} /> Paste text</span> },
            ]}
          />
          {mode === "files" ? (
            <>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  addFiles(e.dataTransfer.files);
                }}
                onClick={() => inputRef.current?.click()}
                className={cx("flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center", drag ? "border-teal-600 bg-teal-50" : "border-line-strong bg-paper hover:border-navy-500")}
              >
                <FileUp className="mb-2 text-navy-500" size={26} />
                <div className="font-medium text-navy-900">Drop decks and forms here, or click to choose</div>
                <div className="mt-1 text-[12px] text-muted">
                  {SUPPORTED_EXTENSIONS.map((x) => x.toUpperCase()).join(" · ")} · up to {MAX_FILE_BYTES / 1048576} MB each
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  hidden
                  accept=".pdf,.pptx,.docx,.xlsx,.csv,.txt,.md,.ppt,.doc,.xls"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
              {files.length > 0 && (
                <div className="mt-3">
                  <table className="dt">
                    <thead>
                      <tr>
                        <th>File</th>
                        <th>Detected as</th>
                        <th className="text-right">Size</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {files.map((f, i) => (
                        <tr key={f.name + i}>
                          <td className="font-mono text-[12px]">{f.name}</td>
                          <td>
                            <Badge tone="navy">{classifyDoc({ filename: f.name, pages: [{ index: 1, text: "" }], method: "txt", sha256: "", size: 0 })} (by name)</Badge>
                          </td>
                          <td className="num text-right">{(f.size / 1024).toFixed(0)} KB</td>
                          <td className="text-right">
                            <button aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-muted hover:text-risk-700">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <label className="mt-2 flex items-center gap-2 text-[12.5px]">
                    <input type="checkbox" checked={single} onChange={(e) => setSingle(e.target.checked)} />
                    Treat all files as one application (otherwise grouped by the company name in each filename)
                  </label>
                </div>
              )}
            </>
          ) : (
            <div>
              <Field label="Company name (optional — read from the form if blank)">
                <input className={inputCls} value={paste.company} onChange={(e) => setPaste({ ...paste, company: e.target.value })} placeholder="e.g. StockSathi" />
              </Field>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Deck text" hint='Separate slides with a line "=== PAGE n ===" to keep slide-level provenance.'>
                  <textarea className={`${inputCls} h-56 font-mono text-[12px]`} value={paste.deck} onChange={(e) => setPaste({ ...paste, deck: e.target.value })} />
                </Field>
                <Field label="Application form text" hint='Use "Label value" lines, e.g. "Company name Acme (Acme Pvt. Ltd.)".'>
                  <textarea className={`${inputCls} h-56 font-mono text-[12px]`} value={paste.form} onChange={(e) => setPaste({ ...paste, form: e.target.value })} />
                </Field>
              </div>
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <Button variant="primary" disabled={!allowed || busy || (mode === "files" ? !files.length : !paste.deck.trim() && !paste.form.trim())} onClick={run}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {busy ? "Reading files…" : "Receive & process"}
            </Button>
            {mode === "files" && files.length > 0 && (
              <Button
                variant="ghost"
                onClick={() => {
                  setFiles([]);
                  setGroups(null);
                  setCreated([]);
                }}
              >
                Clear
              </Button>
            )}
          </div>

          {groups && (
            <div className="mt-4 space-y-3">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-navy-700">Intake result</h3>
              {groups.map((g) => (
                <div key={g.key} className="rounded-md border border-line">
                  <div className="flex items-center justify-between border-b border-line bg-navy-50 px-3 py-1.5">
                    <span className="font-medium">{g.label}</span>
                    <span className="text-[12px] text-muted">
                      {g.docs.length} readable · {g.failures.length} failed · {g.duplicates.length} duplicate
                    </span>
                  </div>
                  <ul className="space-y-1 px-3 py-2 text-[12.5px]">
                    {g.docs.map((x) => (
                      <li key={x.filename} className="flex items-center gap-2 text-ok-700">
                        <CheckCircle2 size={13} /> <span className="font-mono">{x.filename}</span> — {x.pages.length} page(s), {x.method}
                        {x.warnings?.map((w) => (
                          <span key={w} className="text-warn-700"> · {w}</span>
                        ))}
                      </li>
                    ))}
                    {g.failures.map((x) => (
                      <li key={x.filename} className="flex items-start gap-2 text-risk-700">
                        <AlertTriangle size={13} className="mt-0.5 shrink-0" /> <span><span className="font-mono">{x.filename}</span> — {x.error}</span>
                      </li>
                    ))}
                    {g.duplicates.map((x) => (
                      <li key={x.filename} className="flex items-center gap-2 text-warn-700">
                        <Copy size={13} /> <span className="font-mono">{x.filename}</span> — already received in <AppLink id={x.existingAppId} name={x.existingApp} />; skipped.
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {createdApps.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-navy-700">Created applications (live status)</h3>
              <table className="dt">
                <tbody>
                  {createdApps.map((a) => (
                    <tr key={a.id}>
                      <td><AppLink id={a.id} name={a.name} /></td>
                      <td><ProcessingBadge s={a.processingStatus} /></td>
                      <td><DecisionBadge s={a.decisionStatus} /></td>
                      <td className="text-right">
                        <Link className="text-[12px] font-medium text-teal-700 hover:underline" href={`/applications/${a.id}`}>Open →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <div className="space-y-4">
          <Panel title="Expected input">
            <ul className="list-disc space-y-1.5 pl-4 text-[12.5px]">
              <li><b>One pitch deck</b> (PDF or PPTX) and <b>one application form</b> (PDF, DOCX or TXT) per company.</li>
              <li>For a batch, name files <span className="font-mono">Company_Deck.pdf</span> and <span className="font-mono">Company_Form.pdf</span> so they group automatically.</li>
              <li>A deck alone or a form alone is accepted. The missing half is flagged and cross-checks are skipped.</li>
              <li>Scanned / image-only PDFs, password-protected files, empty files, legacy .ppt/.doc and unsupported types are rejected with a visible reason. The application is still recorded as <i>Failed</i> or <i>Needs attention</i>, never as passed.</li>
              <li>Re-uploading an identical file is detected by SHA-256 and skipped.</li>
            </ul>
          </Panel>
          <Callout tone="navy" title="What happens next">
            Received → Extracting → Research queued → Evaluation → Ready for review. Then Riya reviews extraction and evidence, corrects scores with reasons and sends the application to Kushal.
          </Callout>
        </div>
      </div>
    </div>
  );
}
