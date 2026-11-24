"use client";
// Browser store (demo mode). Wraps the framework-free workspace functions, persists to localStorage,
// and runs the processing queue. See docs/ASSUMPTIONS_AND_DECISIONS.md D-02.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Role } from "@/lib/shared/types";
import type { DocInput } from "@/lib/engine/pipeline";
import { normaliseText } from "@/lib/engine/extraction/text";
import { emptyWorkspace, restoreScreenedSpan, revokeScreenedSpanRestoration, WORKSPACE_VERSION, type WorkspaceData } from "@/lib/domain/workspace";
import { drain, enqueueGroups, reevaluate, runJob } from "@/lib/domain/runner";
import type { IntakeGroup } from "@/lib/domain/intake";
import seed from "@/data/seed/applications.json";

const pending = new Map<string, DocInput[]>();

export interface Toast {
  id: number;
  kind: "error" | "success" | "info";
  text: string;
}

interface StoreState {
  data: WorkspaceData;
  role: Role;
  seeded: boolean;
  draining: boolean;
  toasts: Toast[];
  setRole: (r: Role) => void;
  /** Run a workspace mutation as the current user. Returns an error message instead of throwing. */
  act: (fn: (d: WorkspaceData, role: Role) => void, success?: string) => string | null;
  submitGroups: (groups: IntakeGroup[]) => Promise<string[]>;
  reevaluate: (appId: string) => Promise<string | null>;
  /** P2 C8: explicit reviewer action (audited), then re-evaluation with identical screening. */
  setScreenedSpan: (appId: string, spanId: string, restore: boolean, note: string) => Promise<string | null>;
  ensureSeed: () => Promise<void>;
  failureDrill: () => Promise<string | null>;
  resetWorkspace: (withSeed: boolean) => Promise<void>;
  importWorkspace: (json: string) => string | null;
  toast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

export const useStore = create<StoreState>()(
  persist(
    (set, get) => {
      const mutate = (fn: (d: WorkspaceData) => void) => {
        const d = structuredClone(get().data);
        fn(d);
        set({ data: d });
      };
      const read = () => get().data;
      const kick = async () => {
        if (get().draining) return;
        set({ draining: true });
        try {
          await drain(mutate, read, pending, get().role);
        } finally {
          set({ draining: false });
        }
      };
      return {
        data: emptyWorkspace(),
        role: "kushal",
        seeded: false,
        draining: false,
        toasts: [],
        setRole: (r) => set({ role: r }),
        toast: (kind, text) => {
          const id = ++toastSeq;
          set({ toasts: [...get().toasts, { id, kind, text }] });
          setTimeout(() => get().dismissToast(id), kind === "error" ? 7000 : 4000);
        },
        dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
        act: (fn, success) => {
          try {
            const d = structuredClone(get().data);
            fn(d, get().role);
            set({ data: d });
            if (success) get().toast("success", success);
            return null;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            get().toast("error", msg);
            return msg;
          }
        },
        submitGroups: async (groups) => {
          try {
            const ids = enqueueGroups(mutate, get().role, groups, `batch_${Date.now().toString(36)}`, pending);
            void kick();
            return ids;
          } catch (e) {
            get().toast("error", e instanceof Error ? e.message : String(e));
            return [];
          }
        },
        reevaluate: async (appId) => {
          try {
            await reevaluate(mutate, read, appId, get().role);
            get().toast("success", "Re-evaluated. Previous evaluation retained in history.");
            return null;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            get().toast("error", msg);
            return msg;
          }
        },
        setScreenedSpan: async (appId, spanId, restore, note) => {
          const err = get().act((d, role) => (restore ? restoreScreenedSpan : revokeScreenedSpanRestoration)(d, role, { applicationId: appId, spanId, note }));
          if (err) return err;
          try {
            await reevaluate(mutate, read, appId, get().role);
            get().toast("success", restore ? "Passage restored and re-evaluated. It counts as an unverified founder claim." : "Passage set aside again and re-evaluated.");
            return null;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            get().toast("error", msg);
            return msg;
          }
        },
        ensureSeed: async () => {
          if (get().seeded || process.env.NEXT_PUBLIC_LOAD_CASE_SEED === "false") return;
          set({ seeded: true });
          const groups: IntakeGroup[] = (seed as { key: string; files: { filename: string; size: number; sha256: string; pages: { index: number; text: string }[] }[] }[]).map((s) => ({
            key: s.key.toLowerCase(),
            label: s.key,
            failures: [],
            duplicates: [],
            docs: s.files.map((f) => ({ filename: f.filename, size: f.size, sha256: f.sha256, method: "pdf-text" as const, pages: f.pages.map((p) => ({ index: p.index, text: normaliseText(p.text) })) })),
          }));
          const prevRole = get().role;
          set({ role: "riya" });
          enqueueGroups(mutate, "riya", groups, "batch_case_week", pending, true);
          await kick();
          set({ role: prevRole });
        },
        failureDrill: async () => {
          // Creates a test application and forces the provider to fail mid-job, to show that a technical
          // failure lands as "Failed" processing with the decision status untouched.
          const docs: DocInput[] = [{ filename: "FailureDrill_Form.txt", kind: "form", method: "txt", sha256: `drill-${Date.now()}`, size: 120, pages: [{ index: 1, text: "Company name Failure Drill (Test Pvt. Ltd.)\nSector (as selected) Fintech\nStage (as selected) Pre-seed" }] }];
          const tmp = new Map<string, DocInput[]>();
          const ids = enqueueGroups(mutate, get().role, [{ key: "drill", label: "Failure drill (test)", docs, failures: [], duplicates: [] }], `drill_${Date.now().toString(36)}`, tmp);
          const job = get().data.jobs.find((j) => j.applicationId === ids[0]);
          if (job) await runJob(mutate, read, job.id, docs, get().role, { simulateFailure: true });
          get().toast("info", "Failure drill complete: processing Failed, decision still Not reviewed.");
          return ids[0] ?? null;
        },
        resetWorkspace: async (withSeed) => {
          pending.clear();
          set({ data: emptyWorkspace(), seeded: false });
          if (withSeed) await get().ensureSeed();
          else set({ seeded: true });
        },
        importWorkspace: (json) => {
          try {
            const parsed = JSON.parse(json) as WorkspaceData;
            if (!parsed || parsed.version !== WORKSPACE_VERSION || !Array.isArray(parsed.applications)) throw new Error(`Not a valid export for workspace version ${WORKSPACE_VERSION}.`);
            set({ data: parsed, seeded: true });
            get().toast("success", "Workspace imported.");
            return null;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            get().toast("error", msg);
            return msg;
          }
        },
      };
    },
    {
      name: "aic-workspace",
      version: WORKSPACE_VERSION,
      storage: createJSONStorage(() => {
        try {
          const k = "__aic_probe";
          localStorage.setItem(k, "1");
          localStorage.removeItem(k);
          return localStorage;
        } catch {
          const mem = new Map<string, string>();
          return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
        }
      }),
      partialize: (s) => ({ data: s.data, role: s.role, seeded: s.seeded }),
      migrate: () => ({ data: emptyWorkspace(), role: "kushal" as Role, seeded: false }),
      onRehydrateStorage: () => (state) => {
        // Jobs that were mid-flight when the page closed cannot resume (documents were in memory).
        if (!state) return;
        const stuck = state.data.jobs.filter((j) => j.status === "queued" || j.status === "running");
        if (stuck.length) {
          const d = structuredClone(state.data);
          for (const j of d.jobs.filter((x) => x.status === "queued" || x.status === "running")) {
            j.status = "failed";
            j.error = "Interrupted by page reload. Re-upload the documents to retry.";
            const app = d.applications.find((a) => a.id === j.applicationId);
            if (app) {
              app.processingStatus = "failed";
              app.errors.push(j.error);
            }
          }
          useStore.setState({ data: d });
        }
      },
    },
  ),
);

export const useData = () => useStore((s) => s.data);
export const useRole = () => useStore((s) => s.role);
