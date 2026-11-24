// Slot proposal and .ics export. Nothing here talks to a calendar: confirmed = confirmed manually.
import type { AvailabilityRule, MeetingSlot, Role } from "@/lib/shared/types";
import { ROLE_INFO } from "./permissions";

const IST_OFFSET_MIN = 330;
export const CALL_MINUTES = 30;

export const DEFAULT_AVAILABILITY: AvailabilityRule[] = [
  { id: "av-k-tue", person: "kushal", weekday: 2, start: "14:00", end: "18:00", active: true },
  { id: "av-k-thu", person: "kushal", weekday: 4, start: "14:00", end: "18:00", active: true },
  { id: "av-a-tue", person: "aditya", weekday: 2, start: "15:00", end: "18:00", active: true },
  { id: "av-a-thu", person: "aditya", weekday: 4, start: "14:00", end: "17:00", active: true },
  { id: "av-r-tue", person: "riya", weekday: 2, start: "14:00", end: "18:00", active: true },
  { id: "av-r-thu", person: "riya", weekday: 4, start: "14:00", end: "18:00", active: true },
];

/** Attendees per Meeting 3/5: Aditya joins deeptech calls only. */
/** Aditya joins only when Kushal has explicitly shared the application with him (P-C), never from tags. */
export function attendeesFor(includeAditya: boolean): Role[] {
  return includeAditya ? ["kushal", "aditya", "riya"] : ["kushal", "riya"];
}

function istParts(d: Date) {
  const ist = new Date(d.getTime() + IST_OFFSET_MIN * 60000);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth(), d: ist.getUTCDate(), wd: ist.getUTCDay() };
}

function istToUtc(y: number, m: number, d: number, hhmm: string): Date {
  const [h, mi] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(y, m, d, h, mi) - IST_OFFSET_MIN * 60000);
}

export function proposeSlots(opts: {
  now: Date;
  attendees: Role[];
  rules: AvailabilityRule[];
  existing: MeetingSlot[];
  count?: number;
  horizonDays?: number;
}): { start: string; end: string }[] {
  const count = opts.count ?? 3;
  const out: { start: string; end: string }[] = [];
  const busy = opts.existing.filter((s) => s.status !== "cancelled");
  for (let day = 1; day <= (opts.horizonDays ?? 28) && out.length < count; day++) {
    const date = new Date(opts.now.getTime() + day * 86400000);
    const { y, m, d, wd } = istParts(date);
    const windows = opts.attendees.map((p) => opts.rules.filter((r) => r.active && r.person === p && r.weekday === wd));
    if (windows.some((w) => !w.length)) continue; // someone unavailable that day
    const start = windows.map((w) => w[0].start).sort().pop()!;
    const end = windows.map((w) => w[0].end).sort()[0];
    for (let t = istToUtc(y, m, d, start).getTime(); t + CALL_MINUTES * 60000 <= istToUtc(y, m, d, end).getTime() && out.length < count; t += CALL_MINUTES * 60000) {
      const s = t;
      const e = t + CALL_MINUTES * 60000;
      const clash = busy.some((b) => b.attendees.some((a) => opts.attendees.includes(a)) && Date.parse(b.start) < e && Date.parse(b.end) > s);
      if (!clash && !out.some((o) => Date.parse(o.start) === s)) {
        out.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString() });
        break; // one slot per day keeps options spread out
      }
    }
  }
  return out;
}

export function formatIst(iso: string): string {
  const d = new Date(Date.parse(iso) + IST_OFFSET_MIN * 60000);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} IST`;
}

const icsDate = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

export function buildIcs(slot: MeetingSlot, companyName: string, nowIso: string): string {
  const who = slot.attendees.map((a) => ROLE_INFO[a].name).join(", ");
  const status = slot.status === "confirmed_manual" ? "CONFIRMED" : slot.status === "cancelled" ? "CANCELLED" : "TENTATIVE";
  const desc = `All In Capital intro call with ${companyName}. Attendees: ${who}. Status in platform: ${slot.status === "confirmed_manual" ? "confirmed manually by the team" : "proposed"}. This event was NOT created in or confirmed by any connected calendar. Approving a call is not approving an investment.${slot.notes ? `\nNotes: ${slot.notes}` : ""}`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//All In Capital//Investment Intelligence//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${slot.id}@all-in-capital.local`,
    `DTSTAMP:${icsDate(nowIso)}`,
    `DTSTART:${icsDate(slot.start)}`,
    `DTEND:${icsDate(slot.end)}`,
    `SUMMARY:${icsEscape(`Intro call — ${companyName} (All In Capital)`)}`,
    `DESCRIPTION:${icsEscape(desc)}`,
    `STATUS:${status}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
