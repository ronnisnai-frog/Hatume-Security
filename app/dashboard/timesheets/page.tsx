"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import * as XLSX from "xlsx";

function mostRecentFriday(): string {
  const d = new Date();
  const day = d.getDay(); // 0=Sun..5=Fri..6=Sat
  const diff = (day - 5 + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

export default function TimesheetsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [startDate, setStartDate] = useState(mostRecentFriday());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.push("/login");
        return;
      }
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      const { data: entries, error: entryErr } = await supabase
        .from("time_entries")
        .select("clock_in, clock_out, rounded_minutes, is_late, late_minutes, is_early_leave, early_minutes, is_override, guards(full_name), sites(name)")
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

      // Absences: scheduled shifts with no matching time entry that day for that guard
      const entryKeys = new Set(
        (entries || []).map((e: any) => `${e.guards?.full_name}__${new Date(e.clock_in).toISOString().slice(0, 10)}`)
      );
      const absences = (shifts || []).filter((s: any) => !entryKeys.has(`${s.guards?.full_name}__${s.shift_date}`));

      // ---- Summary sheet: totals per guard ----
      const byGuard: Record<string, { hours: number; late: number; early: number; overrides: number; absences: number }> = {};
      for (const e of entries || []) {
        const name = (e as any).guards?.full_name ?? "Unknown";
        if (!byGuard[name]) byGuard[name] = { hours: 0, late: 0, early: 0, overrides: 0, absences: 0 };
        byGuard[name].hours += (e.rounded_minutes || 0) / 60;
        if (e.is_late) byGuard[name].late += 1;
        if (e.is_early_leave) byGuard[name].early += 1;
        if (e.is_override) byGuard[name].overrides += 1;
      }
      for (const a of absences) {
        const name = (a as any).guards?.full_name ?? "Unknown";
        if (!byGuard[name]) byGuard[name] = { hours: 0, late: 0, early: 0, overrides: 0, absences: 0 };
        byGuard[name].absences += 1;
      }

      const summaryRows = Object.entries(byGuard).map(([name, v]) => ({
        Guard: name,
        "Total Hours": Math.round(v.hours * 100) / 100,
        "Late Arrivals": v.late,
        "Early Leaves": v.early,
        Absences: v.absences,
        Overrides: v.overrides,
      }));

      // ---- Detail sheet: every entry ----
      const detailRows = (entries || []).map((e: any) => ({
        Guard: e.guards?.full_name ?? "Unknown",
        Site: e.sites?.name ?? "Unknown",
        Date: new Date(e.clock_in).toISOString().slice(0, 10),
        "Clock In": new Date(e.clock_in).toLocaleTimeString(),
        "Clock Out": e.clock_out ? new Date(e.clock_out).toLocaleTimeString() : "—",
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

      XLSX.writeFile(wb, `Hatume-Security-Timesheet-${startDate}-to-${rangeEndDate}.xlsx`);
    } catch (e: any) {
      setError(e.message || "Failed to generate report");
    }
    setGenerating(false);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-bg flex items-center justify-center">
        <p className="font-mono text-text-secondary text-sm">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg px-8 py-6">
      <h1 className="text-lg font-semibold text-text-primary mb-1">Fortnight Timesheet Export</h1>
      <p className="text-sm text-text-secondary mb-6">
        Generates a payroll-ready Excel file: totals per guard, a full clock in/out detail sheet, and any absences.
      </p>

      <div className="bg-surface border border-border rounded-lg p-6 max-w-md">
        <label className="block text-sm text-text-secondary mb-1">Fortnight start (Friday)</label>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-full mb-1 bg-bg border border-border rounded-md px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <p className="text-xs text-text-muted mb-5">
          Covers {startDate} through {endDate(startDate)}
        </p>

        {error && <p className="text-danger text-sm mb-4">{error}</p>}

        <button
          onClick={downloadFortnight}
          disabled={generating}
          className="w-full bg-accent text-bg font-medium rounded-md py-2 hover:opacity-90 transition disabled:opacity-50"
        >
          {generating ? "Generating…" : "Download Excel (.xlsx)"}
        </button>
      </div>
    </main>
  );
}
