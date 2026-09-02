"use client";

import { Suspense, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "home" | "clock" | "relieve" | "return" | "settings";
type Stage = "pin" | "override" | "relieve_supervisor" | "relieve_guard" | "result";

const supabase = createClient();

export default function ClockPage() {
  return (
    <Suspense fallback={null}>
      <ClockScreen />
    </Suspense>
  );
}

function usePortrait() {
  const [isPortrait, setIsPortrait] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const update = () => setIsPortrait(mq.matches);
    update();
    mq.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return isPortrait;
}

function ClockScreen() {
  const isPortrait = usePortrait();
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("home");
  const [stage, setStage] = useState<Stage>("pin");
  const [pin, setPin] = useState("");
  const [supervisorPin, setSupervisorPin] = useState("");
  const [guardPin, setGuardPin] = useState("");
  const [message, setMessage] = useState<{ text: string; tone: "success" | "error" | "warning" } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    supabase.from("sites").select("id, name").then(({ data }) => setSites(data || []));
  }, []);

  function goHome() {
    setMode("home");
    setStage("pin");
    setPin("");
    setSupervisorPin("");
    setGuardPin("");
    setMessage(null);
  }

  function openMode(m: Mode) {
    setMode(m);
    setStage(m === "relieve" ? "relieve_supervisor" : "pin");
    setPin("");
    setSupervisorPin("");
    setGuardPin("");
    setMessage(null);
  }

  useEffect(() => {
    if (stage === "result") {
      const t = setTimeout(goHome, 3500);
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
    setMessage(data.error ? { text: data.error, tone: "error" } : { text: `${data.guard} on break — back in ${data.limit_minutes}m`, tone: "success" });
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

  function handleGo() {
    if (mode === "clock" && stage === "pin") submitClock();
    else if (mode === "clock" && stage === "override") submitClock(supervisorPin);
    else if (mode === "return" && stage === "pin") submitReturn();
    else if (mode === "relieve" && stage === "relieve_supervisor") setStage("relieve_guard");
    else if (mode === "relieve" && stage === "relieve_guard") submitRelieve();
  }

  const currentSiteName = sites.find((s) => s.id === siteId)?.name;

  // ---------- Site selection gate ----------
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

  const navItems: { label: string; mode: Mode }[] = [
    { label: "Home", mode: "home" },
    { label: "Clock in / out", mode: "clock" },
    { label: "Relieve a guard", mode: "relieve" },
    { label: "Return from break", mode: "return" },
    { label: "Settings", mode: "settings" },
  ];

  const content = (
    <>
      {stage === "result" && message ? (
        <p className={`text-2xl font-semibold text-center px-4 ${message.tone === "success" ? "text-success" : message.tone === "warning" ? "text-warning" : "text-danger"}`}>
          {message.text}
        </p>
      ) : mode === "home" ? (
        <div className="text-center px-4">
          <p className="text-text-secondary text-sm mb-2">Ready</p>
          <h1 className="text-text-primary text-2xl font-semibold">
            {isPortrait ? "Select an action below" : "Select an action from the left"}
          </h1>
        </div>
      ) : mode === "settings" ? (
        <SettingsPanel />
      ) : (
        <PinScreen
          mode={mode}
          stage={stage}
          pin={pin}
          supervisorPin={supervisorPin}
          guardPin={guardPin}
          submitting={submitting}
          onPress={press}
          onClear={(field) => ({ pin: setPin, supervisorPin: setSupervisorPin, guardPin: setGuardPin }[field])("")}
          onGo={handleGo}
          onCancel={goHome}
        />
      )}
    </>
  );

  // ---------- Portrait: top bar + bottom tab nav ----------
  if (isPortrait) {
    return (
      <div className="min-h-screen bg-bg flex flex-col">
        <header className="px-4 py-4 border-b border-border flex items-center justify-between">
          <div>
            <p className="font-semibold text-text-primary text-sm">Hatume Security</p>
            <p className="font-mono text-xs text-text-muted">{currentSiteName}</p>
          </div>
          <button onClick={() => setSiteId(null)} className="text-text-muted text-xs underline">
            Change site
          </button>
        </header>

        <main className="flex-1 flex items-center justify-center py-6">{content}</main>

        <nav className="border-t border-border grid grid-cols-5">
          {navItems.map((item) => (
            <button
              key={item.mode}
              onClick={() => (item.mode === "home" ? goHome() : openMode(item.mode))}
              className={`py-3 text-xs text-center ${mode === item.mode ? "text-accent" : "text-text-secondary"}`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    );
  }

  // ---------- Landscape: sidebar layout ----------
  return (
    <div className="min-h-screen bg-bg flex">
      <aside className="w-64 border-r border-border flex flex-col">
        <div className="px-6 py-6 border-b border-border">
          <p className="font-semibold text-text-primary">Hatume Security</p>
          <p className="font-mono text-xs text-text-muted mt-1">{currentSiteName}</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <NavItem
              key={item.mode}
              label={item.label}
              active={mode === item.mode}
              onClick={() => (item.mode === "home" ? goHome() : openMode(item.mode))}
            />
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-border">
          <NavItem label="Change site" onClick={() => setSiteId(null)} muted />
        </div>
      </aside>

      <main className="flex-1 flex flex-col items-center justify-center px-4">{content}</main>
    </div>
  );
}

function NavItem({ label, active, onClick, muted }: { label: string; active?: boolean; onClick: () => void; muted?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-3 rounded-md text-sm transition ${
        active ? "bg-accent/10 text-accent" : muted ? "text-text-muted hover:bg-surface" : "text-text-secondary hover:bg-surface"
      }`}
    >
      {label}
    </button>
  );
}

function PinScreen({
  mode,
  stage,
  pin,
  supervisorPin,
  guardPin,
  submitting,
  onPress,
  onClear,
  onGo,
  onCancel,
}: {
  mode: Mode;
  stage: Stage;
  pin: string;
  supervisorPin: string;
  guardPin: string;
  submitting: boolean;
  onPress: (field: "pin" | "supervisorPin" | "guardPin", digit: string) => void;
  onClear: (field: "pin" | "supervisorPin" | "guardPin") => void;
  onGo: () => void;
  onCancel: () => void;
}) {
  let heading = "";
  let sub = "";
  let field: "pin" | "supervisorPin" | "guardPin" = "pin";

  if (mode === "clock" && stage === "pin") {
    heading = "Enter your PIN";
    sub = "4–6 digits";
    field = "pin";
  } else if (mode === "clock" && stage === "override") {
    heading = "Supervisor PIN required";
    sub = "Not scheduled at this site today";
    field = "supervisorPin";
  } else if (mode === "return" && stage === "pin") {
    heading = "Enter your PIN";
    sub = "Returning from break";
    field = "pin";
  } else if (mode === "relieve" && stage === "relieve_supervisor") {
    heading = "Supervisor PIN";
    sub = "Authorizing a break";
    field = "supervisorPin";
  } else if (mode === "relieve" && stage === "relieve_guard") {
    heading = "Guard's PIN";
    sub = "Who's taking the break?";
    field = "guardPin";
  }

  const values = { pin, supervisorPin, guardPin };
  const activeValue = values[field];

  return (
    <div className="flex flex-col items-center">
      <h1 className="text-text-primary text-lg mb-1">{heading}</h1>
      <p className="text-text-secondary text-sm mb-6">{sub}</p>

      <div className="flex gap-3 mb-8">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`w-4 h-4 rounded-full border border-border ${i < activeValue.length ? "bg-accent border-accent" : ""}`} />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 w-72 max-w-[85vw]">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Key key={d} onClick={() => onPress(field, d)}>{d}</Key>
        ))}
        <Key onClick={() => onClear(field)}>Clear</Key>
        <Key onClick={() => onPress(field, "0")}>0</Key>
        <Key onClick={onGo} disabled={submitting || activeValue.length < 4} accent>
          {submitting ? "…" : "Go"}
        </Key>
      </div>

      <button onClick={onCancel} className="mt-8 text-text-muted text-xs underline">
        Cancel
      </button>
    </div>
  );
}

function SettingsPanel() {
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const buildId = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
  const shortVersion = buildId.slice(0, 7);

  async function checkForUpdates() {
    setChecking(true);
    setChecked(false);
    try {
      // Force a real network fetch of the current page, bypassing any cache,
      // then hard-reload so the browser is guaranteed to run whatever is
      // currently live on Vercel.
      await fetch(window.location.href, { cache: "reload" });
      setChecked(true);
      setTimeout(() => window.location.reload(), 800);
    } catch {
      setChecking(false);
    }
  }

  return (
    <div className="text-center px-4 max-w-xs">
      <h1 className="text-text-primary text-lg font-semibold mb-1">Settings</h1>
      <p className="font-mono text-xs text-text-muted mb-6">Version {shortVersion}</p>

      <button
        onClick={checkForUpdates}
        disabled={checking}
        className="w-full bg-accent text-bg font-medium rounded-md py-3 hover:opacity-90 transition disabled:opacity-50"
      >
        {checking ? (checked ? "Restarting…" : "Checking…") : "Check for updates"}
      </button>
      <p className="text-text-muted text-xs mt-4">
        This tablet always loads the current live version — this just forces a fresh refresh in case the screen has been open a long time.
      </p>
    </div>
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
