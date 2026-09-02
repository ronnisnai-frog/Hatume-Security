"use client";

import { Suspense, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "menu" | "clock" | "relieve" | "return";
type Stage = "site" | "pin" | "override" | "relieve_supervisor" | "relieve_guard" | "result";

const supabase = createClient();

export default function ClockPage() {
  return (
    <Suspense fallback={null}>
      <ClockScreen />
    </Suspense>
  );
}

function ClockScreen() {
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("menu");
  const [stage, setStage] = useState<Stage>("site");
  const [pin, setPin] = useState("");
  const [supervisorPin, setSupervisorPin] = useState("");
  const [guardPin, setGuardPin] = useState("");
  const [message, setMessage] = useState<{ text: string; tone: "success" | "error" | "warning" } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Sites are safe to list publicly — names only, no guard data
  useEffect(() => {
    supabase.from("sites").select("id, name").then(({ data }) => setSites(data || []));
  }, []);

  function reset() {
    setMode("menu");
    setStage("site");
    setPin("");
    setSupervisorPin("");
    setGuardPin("");
    setMessage(null);
  }

  useEffect(() => {
    if (stage === "result") {
      const t = setTimeout(reset, 3500);
      return () => clearTimeout(t);
    }
  }, [stage]);

  async function call(action: string, extra: Record<string, unknown>) {
    setSubmitting(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/clock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      setSubmitting(false);
      return data;
    } catch {
      setSubmitting(false);
      return { error: "Connection error. Try again." };
    }
  }

  async function submitClock(withSupervisorPin?: string) {
    const data = await call("clock", { pin, site_id: siteId, supervisor_pin: withSupervisorPin });
    if (data.requires_override) {
      setStage("override");
      return;
    }
    if (data.error) {
      setMessage({ text: data.error, tone: "error" });
      setStage("result");
      return;
    }
    if (data.action === "clock_in") {
      setMessage({ text: `${data.guard} clocked in${data.is_late ? ` — late ${data.late_minutes}m` : ""}`, tone: data.is_late ? "warning" : "success" });
    } else {
      setMessage({ text: `${data.guard} clocked out${data.is_early_leave ? ` — left ${data.early_minutes}m early` : ""}`, tone: data.is_early_leave ? "warning" : "success" });
    }
    setStage("result");
  }

  async function submitRelieve() {
    const data = await call("relieve", { supervisor_pin: supervisorPin, guard_pin: guardPin });
    if (data.error) {
      setMessage({ text: data.error, tone: "error" });
    } else {
      setMessage({ text: `${data.guard} on break — back in ${data.limit_minutes}m`, tone: "success" });
    }
    setStage("result");
  }

  async function submitReturn() {
    const data = await call("return", { pin });
    if (data.error) {
      setMessage({ text: data.error, tone: "error" });
    } else {
      setMessage({
        text: data.is_late_return ? `${data.guard} back — ${data.late_return_minutes}m late` : `${data.guard} back on time`,
        tone: data.is_late_return ? "warning" : "success",
      });
    }
    setStage("result");
  }

  function press(field: "pin" | "supervisorPin" | "guardPin", digit: string) {
    const setters = { pin: setPin, supervisorPin: setSupervisorPin, guardPin: setGuardPin };
    const values = { pin, supervisorPin, guardPin };
    if (values[field].length >= 6) return;
    setters[field](values[field] + digit);
  }

  // ---------- Site selection (always first) ----------
  if (!siteId) {
    return (
      <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4">
        <p className="font-mono text-xs text-accent tracking-wide mb-2">Hatume Security</p>
        <h1 className="text-text-primary text-lg mb-6">Where is this drop-off?</h1>
        <div className="w-72 space-y-3">
          {sites.map((s) => (
            <button
              key={s.id}
              onClick={() => setSiteId(s.id)}
              className="w-full py-4 rounded-lg bg-surface border border-border text-text-primary hover:bg-surfaceRaised"
            >
              {s.name}
            </button>
          ))}
        </div>
      </main>
    );
  }

  // ---------- Result screen ----------
  if (stage === "result" && message) {
    return (
      <main className="min-h-screen bg-bg flex items-center justify-center px-4">
        <p className={`text-2xl font-semibold text-center ${message.tone === "success" ? "text-success" : message.tone === "warning" ? "text-warning" : "text-danger"}`}>
          {message.text}
        </p>
      </main>
    );
  }

  // ---------- Main menu ----------
  if (mode === "menu") {
    return (
      <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4">
        <p className="font-mono text-xs text-accent tracking-wide mb-1">Hatume Security</p>
        <p className="text-text-secondary text-sm mb-8">{sites.find((s) => s.id === siteId)?.name}</p>
        <div className="w-72 space-y-3">
          <MenuButton label="Clock in / out" onClick={() => { setMode("clock"); setStage("pin"); }} />
          <MenuButton label="Relieve a guard (supervisor)" onClick={() => { setMode("relieve"); setStage("relieve_supervisor"); }} />
          <MenuButton label="Return from break" onClick={() => { setMode("return"); setStage("pin"); }} />
        </div>
        <button onClick={() => setSiteId(null)} className="mt-8 text-text-muted text-xs underline">
          Change site
        </button>
      </main>
    );
  }

  // ---------- PIN pad screens (clock / return / relieve) ----------
  let heading = "";
  let sub = "";
  let field: "pin" | "supervisorPin" | "guardPin" = "pin";
  let onGo = () => {};

  if (mode === "clock" && stage === "pin") {
    heading = "Enter your PIN";
    sub = "4–6 digits";
    field = "pin";
    onGo = () => submitClock();
  } else if (mode === "clock" && stage === "override") {
    heading = "Supervisor PIN required";
    sub = "Not scheduled at this site today";
    field = "supervisorPin";
    onGo = () => submitClock(supervisorPin);
  } else if (mode === "return" && stage === "pin") {
    heading = "Enter your PIN";
    sub = "Returning from break";
    field = "pin";
    onGo = () => submitReturn();
  } else if (mode === "relieve" && stage === "relieve_supervisor") {
    heading = "Supervisor PIN";
    sub = "Authorizing a break";
    field = "supervisorPin";
    onGo = () => setStage("relieve_guard");
  } else if (mode === "relieve" && stage === "relieve_guard") {
    heading = "Guard's PIN";
    sub = "Who's taking the break?";
    field = "guardPin";
    onGo = () => submitRelieve();
  }

  const values = { pin, supervisorPin, guardPin };
  const activeValue = values[field];

  return (
    <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4">
      <p className="font-mono text-xs text-accent tracking-wide mb-1">Hatume Security</p>
      <p className="text-text-muted text-xs mb-4">{sites.find((s) => s.id === siteId)?.name}</p>
      <h1 className="text-text-primary text-lg mb-1">{heading}</h1>
      <p className="text-text-secondary text-sm mb-6">{sub}</p>

      <div className="flex gap-3 mb-8">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`w-4 h-4 rounded-full border border-border ${i < activeValue.length ? "bg-accent border-accent" : ""}`} />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 w-72">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Key key={d} onClick={() => press(field, d)}>{d}</Key>
        ))}
        <Key onClick={() => ({ pin: setPin, supervisorPin: setSupervisorPin, guardPin: setGuardPin }[field])("")}>Clear</Key>
        <Key onClick={() => press(field, "0")}>0</Key>
        <Key onClick={onGo} disabled={submitting || activeValue.length < 4} accent>
          {submitting ? "…" : "Go"}
        </Key>
      </div>

      <button onClick={reset} className="mt-8 text-text-muted text-xs underline">
        Cancel
      </button>
    </main>
  );
}

function MenuButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full py-5 rounded-lg bg-surface border border-border text-text-primary text-base hover:bg-surfaceRaised">
      {label}
    </button>
  );
}

function Key({ children, onClick, disabled, accent }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-20 rounded-lg text-lg font-mono border border-border transition disabled:opacity-40 ${accent ? "bg-accent text-bg font-semibold" : "bg-surface text-text-primary hover:bg-surfaceRaised"}`}
    >
      {children}
    </button>
  );
}
