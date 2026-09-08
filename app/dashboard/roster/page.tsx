"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, FileDown, CalendarRange, AlertCircle, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import * as XLSX from "xlsx";

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

  function downloadTemplate() {
    const sampleRows = [
      { Guard: guards[0]?.full_name || "Tame Yari", Site: sites[0]?.name || "Main Gate (Gordons)", Date: "2026-09-25", "Start Time": "06:00", "End Time": "18:00" },
      { Guard: guards[1]?.full_name || "Desmond Nimika", Site: sites[0]?.name || "Main Gate (Gordons)", Date: "2026-09-25", "Start Time": "18:00", "End Time": "06:00" },
    ];

    const wb = XLSX.utils.book_new();
    const wsMain = XLSX.utils.json_to_sheet(sampleRows);
    XLSX.utils.book_append_sheet(wb, wsMain, "Roster");

    const referenceRows: { Guards: string; Sites: string }[] = [];
    const maxLen = Math.max(guards.length, sites.length);
    for (let i = 0; i < maxLen; i++) {
      referenceRows.push({ Guards: guards[i]?.full_name || "", Sites: sites[i]?.name || "" });
    }
    const wsRef = XLSX.utils.json_to_sheet(referenceRows);
    XLSX.utils.book_append_sheet(wb, wsRef, "Valid Names (reference)");

    XLSX.writeFile(wb, "Hatume-Security-Roster-Template.xlsx");
  }

  function parseTimeToDate(dateStr: string, timeStr: string): Date | null {
    const m = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (hh > 23 || mm > 59) return null;
    const d = new Date(`${dateStr}T00:00:00+10:00`);
    d.setHours(hh, mm, 0, 0);
    return d;
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
        Download a template, fill it in for the new period, and upload it here — this becomes the live schedule
        guards clock against.
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
          onClick={downloadTemplate}
          className="w-full flex items-center justify-center gap-2 border border-border text-text-primary font-bold text-sm rounded-lg py-2.5 hover:bg-surfaceRaised transition mb-3"
        >
          <FileDown size={16} />
          Download roster template
        </button>

        <label className="w-full flex items-center justify-center gap-2 bg-accent text-bg font-bold text-sm rounded-lg py-2.5 hover:opacity-90 transition cursor-pointer">
          <Upload size={16} />
          {uploading ? "Uploading…" : "Upload filled-in roster"}
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} disabled={uploading} />
        </label>

        <p className="text-text-muted text-xs mt-3">
          Uploading replaces any existing schedule for the exact date range covered by your file — dates outside
          that range are untouched.
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
