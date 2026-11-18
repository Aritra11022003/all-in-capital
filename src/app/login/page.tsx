"use client";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { ROLE_INFO } from "@/lib/domain/permissions";
import type { Role } from "@/lib/shared/types";

export default function LoginPage() {
  const router = useRouter();
  const setRole = useStore((s) => s.setRole);
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-900 px-4">
      <div className="w-full max-w-md rounded-lg border border-navy-700 bg-surface p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded bg-gold-600 text-[13px] font-bold text-navy-950">AIC</div>
          <div>
            <div className="font-semibold text-navy-900">All In Capital</div>
            <div className="text-[11px] uppercase tracking-wider text-muted">Investment Intelligence · private</div>
          </div>
        </div>
        <h1 className="mb-1 text-lg font-semibold text-navy-900">Sign in</h1>
        <p className="mb-4 text-[12.5px] text-muted">Demo workspace: choose a team member. In production this screen is replaced by invite-only Supabase Auth (email magic link); there is no self-sign-up.</p>
        <div className="space-y-2">
          {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
            <button
              key={r}
              onClick={() => {
                setRole(r);
                router.push("/");
              }}
              className="flex w-full items-center gap-3 rounded-md border border-line-strong px-3 py-2.5 text-left hover:border-teal-600 hover:bg-teal-50"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-800 text-[11px] font-bold text-gold-100">{ROLE_INFO[r].initials}</span>
              <span className="flex-1">
                <span className="block font-medium text-navy-900">{ROLE_INFO[r].name} <span className="font-normal text-muted">· {ROLE_INFO[r].title}</span></span>
                <span className="block text-[12px] text-muted">{ROLE_INFO[r].summary}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
