"use client";

import { useState } from "react";
import { FileSpreadsheet, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import * as XLSX from "xlsx";

const supabase = createClient();

const BASE_RATE: Record<string, number> = {
  new_guard: 288,
  old_guard: 320,
  supervisor: 340,
};
const EXTRA_SHIFT_BONUS = 24;
const ABSENCE_DEDUCTION = 24;

// Every real fortnight is a fixed 14-day block anchored to this known Friday start.
// Periods run backward and forward from here in exact 14-day steps — never overlapping,
// never a partial range.
const ANCHOR = new Date("2026-09-11T00:00:00");
const DAY_MS = 24 * 60 * 60 * 1000;

function periodIndexForDate(d: Date): number {
  return Math.floor((d.getTime() - ANCHOR.getTime()) / (14 * DAY_MS));
}

function periodStart(index: number): Date {
  return new Date(ANCHOR.getTime() + index * 14 * DAY_MS);
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}

function tierLabel(tier: string | null): string {
  if (tier === "old_guard") return "Guard (old)";
  if (tier === "new_guard") return "Guard (new)";
  if (tier === "supervisor") return "Supervisor";
  return "Guard";
}

function shiftPeriod(clockIn: string): "Day" | "Night" {
  const hour = new Date(clockIn).getHours();
  return hour >= 5 && hour < 14 ? "Day" : "Night";
}

const currentIndex = periodIndexForDate(new Date());
const PERIODS = [currentIndex - 2, currentIndex - 1, currentIndex, currentIndex + 1].map((idx) => {
  const start = periodStart(idx);
  const end = new Date(start.getTime() + 13 * DAY_MS);
  let status: "Past" | "Current" | "Upcoming" = "Past";
  if (idx === currentIndex) status = "Current";
  if (idx > currentIndex) status = "Upcoming";
  return { index: idx, start, end, status };
});

export default function TimesheetsPage() {
  const [generatingIndex, setGeneratingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function downloadFortnight(startDate: string, rangeEndDate: string) {
    setGeneratingIndex(PERIODS.findIndex((p) => toDateStr(p.start) === startDate));
    setError(null);
    try {
      const rangeStart = `${startDate}T00:00:00`;
      const rangeEnd = `${rangeEndDate}T23:59:59`;

      const { data: guards, error: guardErr } = await supabase
        .from("guards")
        .select("id, full_name, role, pay_tier")
        .eq("active", true);
      if (guardErr) throw guardErr;

      const { data: entries, error: entryErr } = await supabase
        .from("time_entries")
        .select(
          "guard_id, clock_in, clock_out, rounded_minutes, is_late, late_minutes, is_early_leave, early_minutes, is_override, guards(full_name), sites(name)"
        )
        .gte("clock_in", rangeStart)
        .lte("clock_in", rangeEnd)
        .order("clock_in", { ascending: true });
      if (entryErr) throw entryErr;

      const { data: shifts, error: shiftErr } = await supabase
        .from("shifts")
        .select("shift_date, guard_id, site_id, scheduled_start, guards(full_name), sites(name)")
        .gte("shift_date", startDate)
        .lte("shift_date", rangeEndDate);
      if (shiftErr) throw shiftErr;

      const scheduledDatesByGuard = new Map<string, Set<string>>();
      for (const s of shifts || []) {
        const gid = (s as any).guard_id;
        if (!scheduledDatesByGuard.has(gid)) scheduledDatesByGuard.set(gid, new Set());
        scheduledDatesByGuard.get(gid)!.add((s as any).shift_date);
      }

      const entryKeys = new Set(
        (entries || []).map((e: any) => `${e.guards?.full_name}__${new Date(e.clock_in).toISOString().slice(0, 10)}`)
      );
      const absences = (shifts || []).filter((s: any) => !entryKeys.has(`${s.guards?.full_name}__${s.shift_date}`));

      type Tally = { late: number; early: number; extraShifts: number; absences: number };
      const byGuardId: Record<string, Tally> = {};
      for (const g of guards || []) {
        byGuardId[g.id] = { late: 0, early: 0, extraShifts: 0, absences: 0 };
      }

      for (const e of entries || []) {
        const gid = (e as any).guard_id;
        const t = byGuardId[gid];
        if (!t) continue;
        if (e.is_late) t.late += 1;
        if (e.is_early_leave) t.early += 1;
        if (e.is_override) {
          const guard = (guards || []).find((g) => g.id === gid);
          const entryDate = new Date(e.clock_in).toISOString().slice(0, 10);
          if (guard?.role === "supervisor") {
            const scheduledToday = scheduledDatesByGuard.get(gid)?.has(entryDate);
            if (!scheduledToday) t.extraShifts += 1;
          } else {
            t.extraShifts += 1;
          }
        }
      }
      for (const a of absences) {
        const gid = (a as any).guard_id;
        if (byGuardId[gid]) byGuardId[gid].absences += 1;
      }

      const summaryRows = (guards || []).map((g) => {
        const t = byGuardId[g.id];
        const base = BASE_RATE[g.pay_tier || "new_guard"] ?? 0;
        const extraPay = t.extraShifts * EXTRA_SHIFT_BONUS;
        const deduction = t.absences * ABSENCE_DEDUCTION;
        const totalPay = base + extraPay - deduction;
        return {
          Guard: g.full_name,
          Tier: tierLabel(g.pay_tier),
          "Base Rate (K)": base,
          "Extra Shifts": t.extraShifts,
          "Extra Pay (K)": extraPay,
          Absences: t.absences,
          "Absence Deduction (K)": deduction,
          "Total Pay (K)": totalPay,
          "Late Arrivals": t.late,
          "Early Leaves": t.early,
        };
      });

      const detailRows = (entries || []).map((e: any) => ({
        Guard: e.guards?.full_name ?? "Unknown",
        Site: e.sites?.name ?? "Unknown",
        Date: new Date(e.clock_in).toISOString().slice(0, 10),
        "Clock In": new Date(e.clock_in).toLocaleTimeString(),
        "Clock Out": e.clock_out ? new Date(e.clock_out).toLocaleTimeString() : "—",
        Shift: shiftPeriod(e.clock_in),
        Hours: e.rounded_minutes ? Math.round((e.rounded_minutes / 60) * 100) / 100 : "",
        Late: e.is_late ? `${e.late_minutes}m` : "",
        "Early Leave": e.is_early_leave ? `${e.early_minutes}m` : "",
        Override: e.is_override ? "Yes" : "",
      }));

      const absenceRows = absences.map((a: any) => ({
        Guard: a.guards?.full_name ?? "Unknown",
        Site: a.sites?.name ?? "Unknown",
        Date: a.shift_date,
        "Scheduled Start": new Date(a.scheduled_start).toLocaleTimeString(),
      }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Summary");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), "Detail");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(absenceRows), "Absences");

      XLSX.writeFile(wb, `Hatume-Security-Payroll-${startDate}-to-${rangeEndDate}.xlsx`);
    } catch (e: any) {
      setError(e.message || "Failed to generate report");
    }
    setGeneratingIndex(null);
  }

  return (
    <div>
      <h1 className="text-[1.5rem] font-extrabold text-text-primary">Timesheets</h1>
      <p className="text-text-secondary text-sm mb-[18px]">
        Fixed fortnightly rates by tier (new guard K288, old guard K320, supervisor K340), ±K24 per extra
        shift covered or absence. Every download is locked to a real, non-overlapping fortnight — never more,
        never less.
      </p>

      {error && <p className="text-danger text-sm mb-4">{error}</p>}

      <div className="flex flex-col gap-3 max-w-lg">
        {PERIODS.map((p, i) => {
          const isGenerating = generatingIndex === i;
          const startStr = toDateStr(p.start);
          const endStr = toDateStr(p.end);
          return (
            <div
              key={p.index}
              className="bg-surface border border-border rounded-[14px] p-5 flex items-center justify-between shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_18px_rgba(0,0,0,0.35)] animate-fade-up"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-accent/15 text-accent flex items-center justify-center flex-none">
                  <FileSpreadsheet size={16} />
                </div>
                <div>
                  <div className="font-bold text-sm text-text-primary">{formatRange(p.start, p.end)}</div>
                  <StatusBadge status={p.status} />
                </div>
              </div>
              <button
                onClick={() => downloadFortnight(startStr, endStr)}
                disabled={generatingIndex !== null || p.status === "Upcoming"}
                className={`flex items-center gap-1.5 font-bold text-sm rounded-lg px-3.5 py-2 transition disabled:opacity-50 ${
                  p.status === "Upcoming"
                    ? "bg-surfaceRaised text-text-secondary cursor-not-allowed"
                    : "bg-accent text-bg hover:opacity-90"
                }`}
              >
                {p.status === "Upcoming" ? (
                  "Coming soon"
                ) : (
                  <>
                    <Download size={14} />
                    {isGenerating ? "Generating…" : "Download"}
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: "Past" | "Current" | "Upcoming" }) {
  const cls =
    status === "Current"
      ? "bg-success/15 text-success"
      : status === "Upcoming"
      ? "bg-warning/15 text-warning"
      : "bg-surfaceRaised text-text-secondary";
  return <span className={`inline-block mt-1 px-2 py-0.5 rounded-md text-[0.68rem] font-bold ${cls}`}>{status}</span>;
}
