"use client";
import { useState } from "react";
import { CalendarPlus, Download } from "lucide-react";
import { useData, useRole, useStore } from "@/lib/store";
import { can, ROLE_INFO } from "@/lib/domain/permissions";
import { cancelSlot, confirmSlot, proposeMoreSlots, setAvailability, setSlotNotes } from "@/lib/domain/workspace";
import { buildIcs, formatIst } from "@/lib/domain/scheduling";
import type { AvailabilityRule } from "@/lib/shared/types";
import { AppLink } from "@/components/domain";
import { Badge, Button, Callout, Empty, PageHeader, Panel, download, inputCls } from "@/components/ui";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function SchedulingPage() {
  const d = useData();
  const role = useRole();
  const act = useStore((s) => s.act);
  const [rules, setRules] = useState<AvailabilityRule[]>(d.availability);
  const approved = d.applications.filter((a) => a.decisionStatus === "call_approved");
  const appName = (id: string) => d.applications.find((a) => a.id === id)?.name ?? "—";
  return (
    <div>
      <PageHeader
        title="Scheduling"
        subtitle="30-minute calls on Tuesday and Thursday afternoons (IST). Aditya joins deeptech calls only. Slots are proposed from manually kept availability. No calendar is connected, so nothing is ever shown as booked in a calendar."
      />
      <div className="mb-3"><Callout tone="gold" title="No calendar connected">Confirmed means the team confirmed it by hand. Download the .ics to add it to a calendar. Google Calendar sync can be added later with explicit permission. Approving a call is not approving an investment.</Callout></div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-4">
          {!approved.length && <Empty title="No approved calls yet">When Kushal records &quot;Approve call&quot; in the decision room, three slots are proposed here automatically.</Empty>}
          {approved.map((a) => {
            const slots = d.slots.filter((s) => s.applicationId === a.id);
            return (
              <Panel key={a.id} title={<AppLink id={a.id} name={a.name} />} actions={can(role, "schedule.propose") && <Button size="sm" onClick={() => act((w, r) => proposeMoreSlots(w, r, a.id), "More slots proposed.")}><CalendarPlus size={12} /> Propose more</Button>} dense>
                <table className="dt">
                  <thead><tr><th>Slot (IST)</th><th>Attendees</th><th>Status</th><th>Calendar</th><th>Notes</th><th /></tr></thead>
                  <tbody>
                    {slots.map((s) => (
                      <tr key={s.id}>
                        <td className="num whitespace-nowrap">{formatIst(s.start)}</td>
                        <td className="text-[12px]">{s.attendees.map((x) => ROLE_INFO[x].name.split(" ")[0]).join(", ")}</td>
                        <td><Badge tone={s.status === "confirmed_manual" ? "ok" : s.status === "cancelled" ? "neutral" : "gold"}>{s.status === "confirmed_manual" ? "confirmed (manual)" : s.status}</Badge></td>
                        <td className="text-[11.5px] text-muted">not synced</td>
                        <td><input aria-label="Meeting notes" className={`${inputCls} h-7`} defaultValue={s.notes} onBlur={(e) => e.target.value !== s.notes && act((w, r) => setSlotNotes(w, r, s.id, e.target.value))} placeholder="Agenda / notes" /></td>
                        <td className="whitespace-nowrap">
                          <span className="flex gap-1.5">
                            {s.status === "proposed" && can(role, "schedule.confirm") && <Button size="sm" variant="primary" onClick={() => act((w, r) => confirmSlot(w, r, s.id), "Slot confirmed manually. Download the .ics to add it to calendars.")}>Confirm</Button>}
                            {s.status !== "cancelled" && <Button size="sm" onClick={() => download(`${a.name}_call.ics`, buildIcs(s, a.name, new Date().toISOString()), "text/calendar")}><Download size={12} /> .ics</Button>}
                            {s.status !== "cancelled" && can(role, "schedule.confirm") && <Button size="sm" variant="ghost" onClick={() => act((w, r) => cancelSlot(w, r, s.id))}>Cancel</Button>}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            );
          })}
          {d.slots.length > 0 && (
            <Panel dense title="All slots">
              <table className="dt"><tbody>{d.slots.map((s) => <tr key={s.id}><td>{appName(s.applicationId)}</td><td className="num">{formatIst(s.start)}</td><td>{s.status}</td></tr>)}</tbody></table>
            </Panel>
          )}
        </div>
        <Panel title="Availability (manually maintained, IST)">
          <table className="w-full text-[12.5px]">
            <tbody>
              {rules.map((r, i) => (
                <tr key={r.id} className="border-b border-line">
                  <td className="py-1 pr-3 font-medium">{ROLE_INFO[r.person].name.split(" ")[0]}</td>
                  <td className="pr-3 text-muted">{DAYS[r.weekday]}</td>
                  <td><input aria-label="Start" className={`${inputCls} h-7 w-20`} value={r.start} disabled={!can(role, "availability.edit")} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} /></td>
                  <td><input aria-label="End" className={`${inputCls} h-7 w-20`} value={r.end} disabled={!can(role, "availability.edit")} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} /></td>
                  <td><input aria-label="Active" type="checkbox" checked={r.active} disabled={!can(role, "availability.edit")} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {can(role, "availability.edit") && <Button className="mt-2" variant="primary" onClick={() => act((w, r) => setAvailability(w, r, rules), "Availability saved.")}>Save availability</Button>}
        </Panel>
      </div>
    </div>
  );
}
