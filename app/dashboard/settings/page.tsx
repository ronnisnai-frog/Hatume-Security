"use client";

import { useState } from "react";
import { Download, DatabaseBackup } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import * as XLSX from "xlsx";

const supabase = createClient();

export default function SettingsPage() {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<string | null>(null);

  async function exportBackup() {
    setExporting(true);
    setError(null);
    try {
      const [guards, sites, shifts, timeEntries, breaks, panicAlerts] = await Promise.all([
        supabase.from("guards").select("id, full_name, role, pay_tier, active, created_at"),
        supabase.from("sites").select("id, name, created_at"),
        supabase.from("shifts").select("id, guard_id, site_id, shift_date, scheduled_start, scheduled_end"),
        supabase.from("time_entries").select("*"),
        supabase.from("breaks").select("*"),
        supabase.from("panic_alerts").select("*"),
      ]);

      const wb = XLSX.utils.book_new();
      const addSheet = (name: string, data: any[] | null) => {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data || []), name);
      };
      addSheet("Guards", guards.data);
      addSheet("Sites", sites.data);
      addSheet("Shifts", shifts.data);
      addSheet("Time Entries", timeEntries.data);
      addSheet("Breaks", breaks.data);
      addSheet("Panic Alerts", panicAlerts.data);

      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      XLSX.writeFile(wb, `Hatume-Security-Full-Backup-${timestamp}.xlsx`);
      setLastExport(new Date().toLocaleString());
    } catch (e: any) {
      setError(e.message || "Backup failed.");
    }
    setExporting(false);
  }

  return (
    <div>
      <h1 className="text-[1.5rem] font-extrabold text-text-primary">Settings</h1>
      <p className="text-text-secondary text-sm mb-[18px]">Account and data management.</p>

      <div className="bg-surface border border-border rounded-[14px] p-5 max-w-lg shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_18px_rgba(0,0,0,0.35)] animate-fade-up">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-9 h-9 rounded-full bg-accent/15 text-accent flex items-center justify-center flex-none">
            <DatabaseBackup size={16} />
          </div>
          <div>
            <div className="font-bold text-sm text-text-primary">Full data backup</div>
            <div className="text-text-secondary text-xs">Guards, sites, shifts, clock records, breaks, and alerts</div>
          </div>
        </div>

        <p className="text-text-muted text-xs mb-4">
          Your Supabase plan doesn't include automatic backups. It's worth downloading a full copy of your data
          every so often as a safety net — this pulls everything into one Excel file, one sheet per table.
        </p>

        {error && <p className="text-danger text-sm mb-3">{error}</p>}
        {lastExport && <p className="text-success text-xs mb-3">Last downloaded: {lastExport}</p>}

        <button
          onClick={exportBackup}
          disabled={exporting}
          className="w-full flex items-center justify-center gap-2 bg-accent text-bg font-bold text-sm rounded-lg py-2.5 hover:opacity-90 transition disabled:opacity-50"
        >
          <Download size={16} />
          {exporting ? "Preparing backup…" : "Download full backup"}
        </button>
      </div>
    </div>
  );
}
