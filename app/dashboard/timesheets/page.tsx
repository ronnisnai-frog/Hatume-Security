"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
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

function mostRecentFriday(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = (day - 5 + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
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

export default function TimesheetsPage() {
  const [generating, setGenerating] = useState(false);
  const [startDate, setStartDate] = useState(mostRecentFriday());
  const [error, setError] = useState<string | null>(null);

  function endDate(start: string) {
    const d = new Date(start);
    d.setDate(d.getDate() + 13);
    return d.toISOString().slice(0, 10);
  }

  async function downloadFortnight() {
    setGenerating(true);
    setError(null);
    try {
      const rangeStart = `${startDate}T00:00:00`;
      const rangeEndDate = endDate(startDate);
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
    setGenerating(false);
  }

  return (
    <div>
      <h1 className="text-[1.5rem] font-extrabold text-text-primary">Timesheets</h1>
      <p className="text-text-secondary text-sm mb-[18px]">
        Fixed fortnightly rates by tier (new guard K288, old guard K320, supervisor K340), ±K24 per extra
        shift covered or absence.
      </p>

      <div className="bg-surface border border-border rounded-[14px] p-5 max-w-md shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_18px_rgba(0,0,0,0.35)] animate-fade-up">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-9 h-9 rounded-full bg-accent/15 text-accent flex items-center justify-center flex-none">
            <FileSpreadsheet size={16} />
          </div>
          <div>
            <div className="font-bold text-sm text-text-primary">Fortnight export</div>
            <div className="text-text-secondary text-xs">Summary, Detail &amp; Absences sheets</div>
          </div>
        </div>

        <label className="block text-sm text-text-secondary mb-1">Fortnight start (Friday)</label>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-full mb-1 bg-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <p className="text-xs text-text-muted mb-5">
          Covers {startDate} through {endDate(startDate)}
        </p>

        {error && <p className="text-danger text-sm mb-4">{error}</p>}

        <button
          onClick={downloadFortnight}
          disabled={generating}
          className="w-full bg-accent text-bg font-bold rounded-lg py-2.5 hover:opacity-90 transition disabled:opacity-50"
        >
          {generating ? "Generating…" : "Download Excel (.xlsx)"}
        </button>
      </div>
    </div>
  );
}
