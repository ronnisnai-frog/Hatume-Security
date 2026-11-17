"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, FileDown, CalendarRange, AlertCircle, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import * as XLSX from "xlsx-js-style";
import { addDays, buildRosterWorkbook, isGridSheet, parseRosterGrid, pngToday, type GuardLite } from "@/lib/rosterGrid";

const supabase = createClient();

type Guard = { id: string; full_name: string };
type Site = { id: string; name: string };

type ParsedRow = {
  rowNum: number;
  guardName: string;
  siteName: string;
  date: string;
  startTime: string;
  endTime: string;
};

type RowError = { rowNum: number; message: string };

export default function RosterPage() {
  const [guards, setGuards] = useState<Guard[]>([]);
  const [allGuards, setAllGuards] = useState<GuardLite[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [currentRange, setCurrentRange] = useState<{ min: string; max: string; count: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<RowError[]>([]);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: guardData } = await supabase.from("guards").select("id, full_name").eq("active", true).order("full_name");
    const { data: siteData } = await supabase.from("sites").select("id, name").order("name");
    const { data: shiftDates } = await supabase.from("shifts").select("shift_date").order("shift_date");

    const { data: everyone } = await supabase.from("guards").select("id, full_name, active");
    setAllGuards(everyone || []);
    setGuards(guardData || []);
    setSites(siteData || []);

    if (shiftDates && shiftDates.length > 0) {
      setCurrentRange({
        min: shiftDates[0].shift_date,
        max: shiftDates[shiftDates.length - 1].shift_date,
        count: shiftDates.length,
      });
    } else {
      setCurrentRange(null);
    }
    setLoading(false);
  }

  async function downloadRoster(blank: boolean) {
    setErrors([]);
    setSuccessMsg(null);
    const from = pngToday();
    const until = addDays(from, 13);
    let shifts = null;
    if (!blank && currentRange) {
      // Use the most recent 7 days of the live schedule as the weekly pattern
      const { data } = await supabase
        .from("shifts")
        .select("guard_id, site_id, shift_date, scheduled_start, scheduled_end")
        .gte("shift_date", addDays(currentRange.max, -6))
        .lte("shift_date", currentRange.max);
      shifts = data || [];
    }
    const wb = buildRosterWorkbook({ sites, guards: allGuards, shifts, from, until });
    XLSX.writeFile(wb, blank ? "Hatume-Security-Roster-Blank.xlsx" : "Hatume-Security-Roster.xlsx");
  }

  function parseTimeToDate(dateStr: string, timeStr: string): Date | null {
    const m = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (hh > 23 || mm > 59) return null;
    return new Date(`${dateStr}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+10:00`);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrors([]);
    setSuccessMsg(null);
    setUploading(true);

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];

      // New weekly-grid layout (same look as the printed roster)
      const grid: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
      if (isGridSheet(grid)) {
        const res = parseRosterGrid(grid, guards, sites);
        if (res.errors.length > 0) {
          setErrors(res.errors);
          setUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = "";
          return;
        }
        await supabase.from("shifts").delete().gte("shift_date", res.from).lte("shift_date", res.until);
        for (let i = 0; i < res.shifts.length; i += 200) {
          const { error: insErr } = await supabase.from("shifts").insert(res.shifts.slice(i, i + 200));
          if (insErr) throw insErr;
        }
        setSuccessMsg(`Uploaded ${res.shifts.length} shifts covering ${res.from} to ${res.until}. This is now the live schedule for that range.`);
        await load();
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      // Older flat-table layout (Guard / Site / Date / Start Time / End Time)
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { raw: false });

      if (rows.length === 0) {
        setErrors([{ rowNum: 0, message: "The file has no rows to import." }]);
        setUploading(false);
        return;
      }

      const parsed: ParsedRow[] = rows.map((r, i) => ({
        rowNum: i + 2, // account for header row
        guardName: String(r.Guard || "").trim(),
        siteName: String(r.Site || "").trim(),
        date: String(r.Date || "").trim(),
        startTime: String(r["Start Time"] || "").trim(),
        endTime: String(r["End Time"] || "").trim(),
      }));

      const rowErrors: RowError[] = [];
      const validRows: { guard_id: string; site_id: string; shift_date: string; scheduled_start: string; scheduled_end: string }[] = [];

      for (const row of parsed) {
        if (!row.guardName || !row.siteName || !row.date || !row.startTime || !row.endTime) {
          rowErrors.push({ rowNum: row.rowNum, message: "Missing one or more required fields." });
          continue;
        }
        const guard = guards.find((g) => g.full_name.toLowerCase() === row.guardName.toLowerCase());
        if (!guard) {
          rowErrors.push({ rowNum: row.rowNum, message: `Guard name "${row.guardName}" doesn't match anyone on file.` });
          continue;
        }
        const site = sites.find((s) => s.name.toLowerCase() === row.siteName.toLowerCase());
        if (!site) {
          rowErrors.push({ rowNum: row.rowNum, message: `Site name "${row.siteName}" doesn't match any site on file.` });
          continue;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
          rowErrors.push({ rowNum: row.rowNum, message: `Date "${row.date}" should be in YYYY-MM-DD format.` });
          continue;
        }
        const start = parseTimeToDate(row.date, row.startTime);
        if (!start) {
          rowErrors.push({ rowNum: row.rowNum, message: `Start time "${row.startTime}" should be in HH:MM format.` });
          continue;
        }
        const endSameDay = parseTimeToDate(row.date, row.endTime);
        if (!endSameDay) {
          rowErrors.push({ rowNum: row.rowNum, message: `End time "${row.endTime}" should be in HH:MM format.` });
          continue;
        }
        // Overnight shift: end time is earlier than start time, so it lands the next day
        const end = endSameDay <= start ? new Date(endSameDay.getTime() + 24 * 60 * 60 * 1000) : endSameDay;

        validRows.push({
          guard_id: guard.id,
          site_id: site.id,
          shift_date: row.date,
          scheduled_start: start.toISOString(),
          scheduled_end: end.toISOString(),
        });
      }

      if (rowErrors.length > 0) {
        setErrors(rowErrors);
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      const dates = validRows.map((r) => r.shift_date).sort();
      const minDate = dates[0];
      const maxDate = dates[dates.length - 1];

      // Clean replace: remove any existing shifts in this exact date range before inserting the new ones
      await supabase.from("shifts").delete().gte("shift_date", minDate).lte("shift_date", maxDate);
      const { error: insertErr } = await supabase.from("shifts").insert(validRows);
      if (insertErr) throw insertErr;

      setSuccessMsg(`Uploaded ${validRows.length} shifts covering ${minDate} to ${maxDate}. This is now the live schedule for that range.`);
      await load();
    } catch (err: any) {
      setErrors([{ rowNum: 0, message: err.message || "Something went wrong reading that file." }]);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
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
      <h1 className="text-[1.5rem] font-extrabold text-text-primary">Roster</h1>
      <p className="text-text-secondary text-sm mb-[18px]">
        Download the roster, change the names in the weekly grid, set the "Effective from" and "Until" dates at the
        top, and upload it here — this becomes the live schedule guards clock against.
      </p>

      <div className="bg-surface border border-border rounded-[14px] p-5 mb-4 max-w-lg shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_18px_rgba(0,0,0,0.35)] animate-fade-up">
        <div className="flex items-center gap-2.5 mb-1">
          <CalendarRange size={16} className="text-accent" />
          <span className="font-bold text-sm text-text-primary">Current schedule</span>
        </div>
        {currentRange ? (
          <p className="text-text-secondary text-xs">
            {currentRange.count} shifts scheduled, covering {currentRange.min} to {currentRange.max}
          </p>
        ) : (
          <p className="text-text-secondary text-xs">No shifts currently scheduled.</p>
        )}
      </div>

      <div
        className="bg-surface border border-border rounded-[14px] p-5 max-w-lg shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_18px_rgba(0,0,0,0.35)] animate-fade-up"
        style={{ animationDelay: "80ms" }}
      >
        <button
          onClick={() => downloadRoster(false)}
          disabled={!currentRange}
          className="w-full flex items-center justify-center gap-2 border border-border text-text-primary font-bold text-sm rounded-lg py-2.5 hover:bg-surfaceRaised transition mb-3 disabled:opacity-50"
        >
          <FileDown size={16} />
          Download current roster
        </button>
        <button
          onClick={() => downloadRoster(true)}
          className="w-full flex items-center justify-center gap-2 border border-border text-text-primary font-bold text-sm rounded-lg py-2.5 hover:bg-surfaceRaised transition mb-3"
        >
          <FileDown size={16} />
          Download blank roster
        </button>

        <label className="w-full flex items-center justify-center gap-2 bg-accent text-bg font-bold text-sm rounded-lg py-2.5 hover:opacity-90 transition cursor-pointer">
          <Upload size={16} />
          {uploading ? "Uploading…" : "Upload filled-in roster"}
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} disabled={uploading} />
        </label>

        <p className="text-text-muted text-xs mt-3">
          The weekly grid repeats on each matching weekday between "Effective from" and "Until". Uploading replaces
          any existing schedule inside that date range — dates outside it are untouched. Write guards as "Hubert. N"
          or their full name.
        </p>

        {successMsg && (
          <div className="mt-4 flex items-start gap-2 bg-success/10 border border-success/30 rounded-lg p-3">
            <CheckCircle2 size={16} className="text-success flex-none mt-0.5" />
            <p className="text-success text-xs">{successMsg}</p>
          </div>
        )}

        {errors.length > 0 && (
          <div className="mt-4 bg-danger/10 border border-danger/30 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle size={16} className="text-danger flex-none" />
              <p className="text-danger text-xs font-bold">Nothing was uploaded — fix these and try again:</p>
            </div>
            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {errors.map((e, i) => (
                <li key={i} className="text-danger text-xs">
                  {e.rowNum > 0 ? `Row ${e.rowNum}: ` : ""}
                  {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
