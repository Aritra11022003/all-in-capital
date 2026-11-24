// Single source of truth for who may do what. Every store mutation calls assertCan().
// Production mode mirrors this matrix in Supabase RLS (supabase/migrations/0002_rls.sql).
import type { Application, Role } from "@/lib/shared/types";

export type Action =
  | "screening.restore"
  | "access.grant"
  | "application.view"
  | "application.create"
  | "document.upload"
  | "document.view"
  | "extraction.edit"
  | "research.update"
  | "evidence.add"
  | "conflict.resolve"
  | "score.correct"
  | "application.comment"
  | "application.submit_for_review"
  | "decision.record"
  | "application.reopen"
  | "learning.approve"
  | "criteria.propose"
  | "criteria.approve"
  | "portfolio.edit"
  | "overlap.review"
  | "schedule.propose"
  | "schedule.confirm"
  | "availability.edit"
  | "backtest.review"
  | "admin.export"
  | "admin.reset";

export const MATRIX: Record<Action, Role[]> = {
  "application.view": ["kushal", "aditya", "riya"],
  "application.create": ["riya", "kushal"],
  "document.upload": ["riya", "kushal"],
  "document.view": ["kushal", "riya", "aditya"], // Aditya: only applications Kushal has shared with him (P-C)
  "extraction.edit": ["riya", "kushal"],
  "research.update": ["riya", "kushal", "aditya"],
  "evidence.add": ["riya", "kushal", "aditya"],
  "conflict.resolve": ["riya", "kushal"],
  "score.correct": ["riya", "kushal", "aditya"],
  "application.comment": ["riya", "kushal", "aditya"],
  "application.submit_for_review": ["riya", "kushal"],
  "decision.record": ["kushal"],
  "application.reopen": ["kushal"],
  "learning.approve": ["kushal", "aditya"],
  "criteria.propose": ["kushal", "aditya", "riya"],
  "criteria.approve": ["kushal"],
  "portfolio.edit": ["kushal", "riya"],
  "overlap.review": ["kushal"],
  "schedule.propose": ["riya", "kushal"],
  "schedule.confirm": ["riya", "kushal"],
  "availability.edit": ["riya", "kushal"],
  "backtest.review": ["kushal", "aditya"],
  "admin.export": ["kushal", "riya"],
  "admin.reset": ["kushal"],
  "screening.restore": ["riya", "kushal"],
  "access.grant": ["kushal"],
};

export class PermissionError extends Error {
  constructor(role: Role, action: string) {
    super(`${ROLE_INFO[role].name} (${ROLE_INFO[role].title}) is not permitted to ${action.replace(".", ": ").replace(/_/g, " ")}.`);
    this.name = "PermissionError";
  }
}

export function can(role: Role, action: Action): boolean {
  return MATRIX[action].includes(role);
}

export function assertCan(role: Role, action: Action): void {
  if (!can(role, action)) throw new PermissionError(role, action);
}

/** P-C: an explicit, human-granted access entry for this application (never derived from founder text). */
export function hasDocumentGrant(app: Pick<Application, "accessGrants">, role: Role): boolean {
  return (app.accessGrants ?? []).some((g) => g.role === role);
}

/**
 * Document access is decided by the signed-in user's role and explicit per-application grants ONLY.
 * Sector, tags and anything else extracted from a founder's documents never widen access (P-C).
 * Kushal and Riya see every application's documents by role; Aditya sees an application's documents only
 * after Kushal shares it with him (audited).
 */
export function canViewDocuments(role: Role, app: Pick<Application, "accessGrants">): boolean {
  if (!can(role, "document.view")) return false;
  if (role !== "aditya") return true;
  return hasDocumentGrant(app, "aditya");
}

export const ROLE_INFO: Record<Role, { name: string; title: string; initials: string; summary: string }> = {
  kushal: { name: "Kushal Bhagia", title: "Principal", initials: "KB", summary: "Sees every application; records every final outcome." },
  aditya: { name: "Aditya Singh", title: "Partner", initials: "AS", summary: "Deeptech and technical review; approves learning rules." },
  riya: { name: "Riya", title: "Associate", initials: "R", summary: "Intake, extraction review, research, first assessment, scheduling." },
};
