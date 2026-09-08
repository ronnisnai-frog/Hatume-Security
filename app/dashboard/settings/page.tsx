"use client";

import { useEffect, useState } from "react";
import { Download, DatabaseBackup, ShieldCheck, ShieldOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import * as XLSX from "xlsx";

const supabase = createClient();

type MfaStatus = "checking" | "disabled" | "enrolling" | "enabled";

export default function SettingsPage() {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<string | null>(null);

  const [mfaStatus, setMfaStatus] = useState<MfaStatus>("checking");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);

  useEffect(() => {
    checkMfaStatus();
  }, []);

  async function checkMfaStatus() {
    const { data } = await supabase.auth.mfa.listFactors();
    const verified = data?.totp?.find((f) => f.status === "verified");
    if (verified) {
      setFactorId(verified.id);
      setMfaStatus("enabled");
    } else {
      setMfaStatus("disabled");
    }
  }

  async function startEnroll() {
    setMfaBusy(true);
    setMfaError(null);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setMfaBusy(false);
    if (error || !data) {
      setMfaError(error?.message || "Couldn't start setup.");
      return;
    }
    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
    setMfaStatus("enrolling");
  }

  async function verifyEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setMfaBusy(true);
    setMfaError(null);
    const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeErr || !challenge) {
      setMfaBusy(false);
      setMfaError(challengeErr?.message || "Couldn't verify that code.");
      return;
    }
    const { error: verifyErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: verifyCode.trim(),
    });
    setMfaBusy(false);
    if (verifyErr) {
      setMfaError("That code didn't match — check your authenticator app and try again.");
      return;
    }
    setVerifyCode("");
    setMfaStatus("enabled");
  }

  async function disableMfa() {
    if (!factorId) return;
    if (!confirm("Turn off two-factor authentication? Your account will only need a password to sign in.")) return;
    setMfaBusy(true);
    await supabase.auth.mfa.unenroll({ factorId });
    setMfaBusy(false);
    setFactorId(null);
    setMfaStatus("disabled");
  }

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

      <div className="bg-surface border border-border rounded-[14px] p-5 max-w-lg shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_18px_rgba(0,0,0,0.35)] animate-fade-up mb-4">
        <div className="flex items-center gap-2.5 mb-3">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-none ${mfaStatus === "enabled" ? "bg-success/15 text-success" : "bg-accent/15 text-accent"}`}>
            {mfaStatus === "enabled" ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}
          </div>
          <div>
            <div className="font-bold text-sm text-text-primary">Two-factor authentication</div>
            <div className="text-text-secondary text-xs">
              {mfaStatus === "enabled" ? "Enabled — your account needs a code to sign in" : "Adds a second step to your dashboard login"}
            </div>
          </div>
        </div>

        {mfaStatus === "checking" && <p className="text-text-muted text-xs">Checking…</p>}

        {mfaStatus === "disabled" && (
          <>
            <p className="text-text-muted text-xs mb-4">
              Since this dashboard now touches real payroll and personal guard data, adding a second step —
              a 6-digit code from an authenticator app on your phone — means a leaked password alone isn't
              enough to get in.
            </p>
            {mfaError && <p className="text-danger text-sm mb-3">{mfaError}</p>}
            <button
              onClick={startEnroll}
              disabled={mfaBusy}
              className="w-full bg-accent text-bg font-bold text-sm rounded-lg py-2.5 hover:opacity-90 transition disabled:opacity-50"
            >
              {mfaBusy ? "Starting…" : "Enable two-factor authentication"}
            </button>
          </>
        )}

        {mfaStatus === "enrolling" && (
          <form onSubmit={verifyEnroll}>
            <p className="text-text-secondary text-xs mb-3">
              Scan this with your authenticator app (Google Authenticator, Authy, etc.), then enter the 6-digit
              code it shows.
            </p>
            {qrCode && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrCode} alt="Two-factor QR code" className="mx-auto mb-3 w-40 h-40 bg-white p-2 rounded-lg" />
            )}
            {secret && (
              <p className="text-text-muted text-[0.7rem] text-center mb-4 font-mono break-all">
                Can't scan? Enter manually: {secret}
              </p>
            )}
            <input
              type="text"
              inputMode="numeric"
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6-digit code"
              maxLength={6}
              className="w-full mb-3 bg-bg border border-border rounded-md px-3 py-2 text-text-primary text-center tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {mfaError && <p className="text-danger text-sm mb-3">{mfaError}</p>}
            <button
              type="submit"
              disabled={mfaBusy || verifyCode.length < 6}
              className="w-full bg-accent text-bg font-bold text-sm rounded-lg py-2.5 hover:opacity-90 transition disabled:opacity-50"
            >
              {mfaBusy ? "Verifying…" : "Confirm and enable"}
            </button>
          </form>
        )}

        {mfaStatus === "enabled" && (
          <button
            onClick={disableMfa}
            disabled={mfaBusy}
            className="w-full border border-danger/40 text-danger font-bold text-sm rounded-lg py-2.5 hover:bg-danger/10 transition disabled:opacity-50"
          >
            {mfaBusy ? "Working…" : "Turn off two-factor authentication"}
          </button>
        )}
      </div>

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
