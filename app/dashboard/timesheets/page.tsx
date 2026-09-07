"use client";

import { useEffect, useState } from "react";
import { FileSpreadsheet, Download, ChevronDown, ChevronUp } from "lucide-react";
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
const ANCHOR = new Date("2026-09-11T00:00:00");
const DAY_MS = 24 * 60 * 60 * 1000;
// Safety cap on how far back we look for undownloaded periods — 16 weeks is far
// more than this business will ever realistically need, but avoids an unbounded
// query if a period is somehow never downloaded.
const MAX_LOOKBACK_PERIODS = 8;

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

type Period = {
  index: number;
  start: Date;
  end: Date;
  status: "Past" | "Current" | "Upcoming";
  downloadCount: number;
  lastDownloadedAt: string | null;
};

export default function TimesheetsPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [generatingIndex, setGeneratingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPeriods();
  }, []);

  async function loadPeriods() {
    const currentIndex = periodIndexForDate(new Date());
    const earliestIndex = currentIndex - MAX_LOOKBACK_PERIODS;
    const earliestStart = toDateStr(periodStart(earliestIndex));

    const { data: downloads } = await supabase
      .from("payroll_downloads")
      .select("period_start, downloaded_at")
      .gte("period_start", earliestStart)
      .order("downloaded_at", { ascending: false });

    const downloadsByPeriod = new Map<string, string[]>();
    for (const d of downloads || []) {
      const key = d.period_start;
      if (!downloadsByPeriod.has(key)) downloadsByPeriod.set(key, []);
      downloadsByPeriod.get(key)!.push(d.downloaded_at);
    }

    const built: Period[] = [];
    // Walk backward from current, collecting any past period that hasn't been
    // downloaded yet, stopping once we hit one that HAS been downloaded (older
    // than that, periods either predate the app or were already handled).
    for (let idx = currentIndex - 1; idx >= earliestIndex; idx--) {
      const start = periodStart(idx);
      const key = toDateStr(start);
      const history = downloadsByPeriod.get(key) || [];
      if (history.length > 0) break; // reached the downloaded boundary, stop walking further back
      built.unshift({
        index: idx,
        start,
        end: new Date(start.getTime() + 13 * DAY_MS),
        status: "Past",
        downloadCount: 0,
        lastDownloadedAt: null,
      });
    }

    // Current period
    const curStart = periodStart(currentIndex);
    const curKey = toDateStr(curStart);
    const curHistory = downloadsByPeriod.get(curKey) || [];
    built.push({
      index: currentIndex,
      start: curStart,
      end: new Date(curStart.getTime() + 13 * DAY_MS),
      status: "Current",
      downloadCount: curHistory.length,
      lastDownloadedAt: curHistory[0] || null,
    });

    // Upcoming period (coming soon, not yet downloadable)
    const nextStart = periodStart(currentIndex + 1);
    built.push({
      index: currentIndex + 1,
      start: nextStart,
      end: new Date(nextStart.getTime() + 13 * DAY_MS),
      status: "Upcoming",
      downloadCount: 0,
      lastDownloadedAt: null,
    });

    // Recently downloaded: any period in our lookback window with a download history
    const history: Period[] = [];
    for (const [key, dates] of downloadsByPeriod.entries()) {
      const start = new Date(`${key}T00:00:00`);
      const idx = periodIndexForDate(start);
      if (idx >= currentIndex) continue; // current/upcoming handled above, never archived
      history.push({
        index: idx,
        start,
        end: new Date(start.getTime() + 13 * DAY_MS),
        status: "Past",
        downloadCount: dates.length,
        lastDownloadedAt: dates[0],
      });
    }
    history.sort((a, b) => (b.lastDownloadedAt || "").localeCompare(a.lastDownloadedAt || ""));

    setPeriods(built);
    setDownloadHistory(history);
    setLoading(false);
  }

  const [downloadHistory, setDownloadHistory] = useState<Period[]>([]);

  async function downloadFortnight(p: Period) {
    setGeneratingIndex(p.index);
    setError(null);
    try {
      const startDate = toDateStr(p.start);
      const rangeEndDate = toDateStr(p.end);
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

      await supabase.from("payroll_downloads").insert({ period_start: startDate, period_end: rangeEndDate });
      await loadPeriods();
    } catch (e: any) {
      setError(e.message || "Failed to generate report");
    }
    setGeneratingIndex(null);
  }

  if (loading) {
    return (
      <main className="flex items-center justify-center h-full">
        <p className="font-mono text-text-secondary text-sm">Loading…</p>
      </main>
    );
  }

  return (
    <div>
      <h1 className="text-[1.5rem] font-extrabold text-text-primary">Timesheets</h1>
      <p className="text-text-secondary text-sm mb-[18px]">
        Every download is locked to a real, non-overlapping fortnight — never more, never less. A period stays
        here until you've downloaded it at least once.
      </p>

      {error && <p className="text-danger text-sm mb-4">{error}</p>}

      <div className="flex flex-col gap-3 max-w-lg mb-6">
        {periods.map((p, i) => (
          <PeriodCard
            key={p.index}
            period={p}
            generating={generatingIndex === p.index}
            disabled={generatingIndex !== null}
            onDownload={() => downloadFortnight(p)}
            delay={i * 60}
          />
        ))}
      </div>

      {downloadHistory.length > 0 && (
        <div className="max-w-lg">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1.5 text-text-secondary text-sm font-bold mb-3 hover:text-text-primary transition"
          >
            {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            Recently downloaded ({downloadHistory.length})
          </button>
          {showHistory && (
            <div className="flex flex-col gap-3">
              {downloadHistory.map((p, i) => (
                <PeriodCard
                  key={p.index}
                  period={p}
                  generating={generatingIndex === p.index}
                  disabled={generatingIndex !== null}
                  onDownload={() => downloadFortnight(p)}
                  delay={i * 60}
                  muted
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PeriodCard({
  period,
  generating,
  disabled,
  onDownload,
  delay,
  muted,
}: {
  period: Period;
  generating: boolean;
  disabled: boolean;
  onDownload: () => void;
  delay: number;
  muted?: boolean;
}) {
  const isUpcoming = period.status === "Upcoming";
  return (
    <div
      className={`bg-surface border border-border rounded-[14px] p-5 flex items-center justify-between shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_18px_rgba(0,0,0,0.35)] animate-fade-up ${
        muted ? "opacity-80" : ""
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-accent/15 text-accent flex items-center justify-center flex-none">
          <FileSpreadsheet size={16} />
        </div>
        <div>
          <div className="font-bold text-sm text-text-primary">{formatRange(period.start, period.end)}</div>
          <StatusBadge status={period.status} />
          {period.downloadCount > 0 && (
            <div className="text-text-muted text-[0.68rem] mt-1">
              Downloaded {period.downloadCount}× — last{" "}
              {period.lastDownloadedAt ? new Date(period.lastDownloadedAt).toLocaleString() : ""}
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onDownload}
        disabled={disabled || isUpcoming}
        className={`flex items-center gap-1.5 font-bold text-sm rounded-lg px-3.5 py-2 transition disabled:opacity-50 ${
          isUpcoming ? "bg-surfaceRaised text-text-secondary cursor-not-allowed" : "bg-accent text-bg hover:opacity-90"
        }`}
      >
        {isUpcoming ? (
          "Coming soon"
        ) : (
          <>
            <Download size={14} />
            {generating ? "Generating…" : period.downloadCount > 0 ? "Download again" : "Download"}
          </>
        )}
      </button>
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
