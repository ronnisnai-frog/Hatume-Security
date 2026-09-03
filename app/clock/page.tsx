"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Settings, X, Clock as ClockIcon, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Mode = "menu" | "clock" | "relieve" | "return" | "settings" | "break_timer";
type Stage = "pin" | "override" | "relieve_supervisor" | "relieve_guard" | "result";

const supabase = createClient();
const QUEUE_KEY = "hatume_offline_queue";

export default function ClockPage() {
  return (
    <Suspense fallback={null}>
      <AuthGate />
    </Suspense>
  );
}

// ============ Login gate: only accounts tagged tablet_access=true may enter ============
function AuthGate() {
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const meta = data.session?.user?.user_metadata as { tablet_access?: boolean } | undefined;
      setAuthorized(!!data.session && !!meta?.tablet_access);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const meta = session?.user?.user_metadata as { tablet_access?: boolean } | undefined;
      setAuthorized(!!session && !!meta?.tablet_access);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (checking) {
    return (
      <main className="min-h-screen bg-bg flex items-center justify-center">
        <p className="font-mono text-text-secondary text-sm">Loading…</p>
      </main>
    );
  }

  if (!authorized) return <TabletLogin />;
  return <ClockScreen />;
}

function TabletLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { data, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) {
      setError(signInErr.message);
      setLoading(false);
      return;
    }
    const meta = data.user?.user_metadata as { tablet_access?: boolean } | undefined;
    if (!meta?.tablet_access) {
      await supabase.auth.signOut();
      setError("This account isn't authorized for tablet login.");
      setLoading(false);
      return;
    }
    setLoading(false);
  }

  return (
    <main className="min-h-screen bg-bg flex items-center justify-center px-4">
      <form onSubmit={handleLogin} className="w-full max-w-sm bg-surface border border-border rounded-lg p-8">
        <p className="font-mono text-xs text-accent tracking-wide mb-1">Hatume Security</p>
        <h1 className="text-xl font-semibold text-text-primary mb-6">Tablet sign in</h1>

        <label className="block text-sm text-text-secondary mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full mb-4 bg-bg border border-border rounded-md px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
        />

        <label className="block text-sm text-text-secondary mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full mb-6 bg-bg border border-border rounded-md px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
        />

        {error && <p className="text-danger text-sm mb-4">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-accent text-bg font-medium rounded-md py-2 hover:opacity-90 transition disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-text-muted text-xs mt-4 text-center">
          You'll stay signed in on this device until you log out from Settings.
        </p>
      </form>
    </main>
  );
}

// ============ Offline queue helpers ============
function loadQueue(): { action: string; extra: Record<string, unknown>; ts: number }[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveQueue(q: { action: string; extra: Record<string, unknown>; ts: number }[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

function ClockScreen() {
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("menu");
  const [stage, setStage] = useState<Stage>("pin");
  const [pin, setPin] = useState("");
  const [supervisorPin, setSupervisorPin] = useState("");
  const [guardPin, setGuardPin] = useState("");
  const [message, setMessage] = useState<{ text: string; tone: "success" | "error" | "warning" } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [breakInfo, setBreakInfo] = useState<{ guardName: string; startedAt: number; limitMinutes: number } | null>(null);
  const [openBreaks, setOpenBreaks] = useState<{ guard: string; started_at: string; limit_minutes: number }[]>([]);
  const [lateReturns, setLateReturns] = useState<{ guard: string; returned_at: string; late_by_minutes: number }[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const panicTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function startPanicPress() {
    if (panicTimerRef.current) return;
    panicTimerRef.current = setTimeout(async () => {
      panicTimerRef.current = null;
      try {
        await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/clock`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "panic", site_id: siteId }),
        });
      } catch {
        // Deliberately silent either way — no UI feedback, on success or failure.
      }
    }, 3000);
  }

  function cancelPanicPress() {
    if (panicTimerRef.current) {
      clearTimeout(panicTimerRef.current);
      panicTimerRef.current = null;
    }
  }

  useEffect(() => {
    supabase.from("sites").select("id, name").then(({ data }) => setSites(data || []));
    setPendingCount(loadQueue().length);
  }, []);

  async function refreshStatus() {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/clock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status" }),
      });
      const data = await res.json();
      setOpenBreaks(data.open_breaks || []);
      setLateReturns(data.late_returns_today || []);
    } catch {
      // silent — offline, banner just won't update this cycle
    }
  }

  async function flushQueue() {
    let queue = loadQueue();
    while (queue.length > 0) {
      const item = queue[0];
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/clock`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: item.action, ...item.extra }),
        });
        if (!res.ok && res.status >= 500) throw new Error("server error");
        queue = queue.slice(1);
        saveQueue(queue);
        setPendingCount(queue.length);
      } catch {
        break; // still offline or server down — stop, retry later
      }
    }
  }

  useEffect(() => {
    refreshStatus();
    flushQueue();
    const statusTimer = setInterval(refreshStatus, 20000);
    const flushTimer = setInterval(flushQueue, 15000);
    window.addEventListener("online", flushQueue);
    return () => {
      clearInterval(statusTimer);
      clearInterval(flushTimer);
      window.removeEventListener("online", flushQueue);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goMenu() {
    setMode("menu");
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
      const t = setTimeout(goMenu, 3500);
      return () => clearTimeout(t);
    }
  }, [stage]);

  // Attempts a live call; on network failure, queues it for later and returns a synthetic "offline" result.
  async function call(action: string, extra: Record<string, unknown>) {
    setSubmitting(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/clock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      setSubmitting(false);
      return data;
    } catch {
      // Network failure — queue it (only for actions that make sense to replay later)
      if (action === "clock" || action === "relieve" || action === "return") {
        const queue = loadQueue();
        queue.push({ action, extra, ts: Date.now() });
        saveQueue(queue);
        setPendingCount(queue.length);
      }
      setSubmitting(false);
      return { offline: true };
    }
  }

  async function submitClock(withSupervisorPin?: string) {
    const data = await call("clock", { pin, site_id: siteId, supervisor_pin: withSupervisorPin });
    if (data.offline) {
      setMessage({ text: "No connection — saved and will sync automatically", tone: "warning" });
      setStage("result");
      return;
    }
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
    if (data.offline) {
      setMessage({ text: "No connection — saved and will sync automatically", tone: "warning" });
      setStage("result");
      return;
    }
    if (data.error) {
      setMessage({ text: data.error, tone: "error" });
      setStage("result");
    } else {
      setBreakInfo({ guardName: data.guard, startedAt: Date.parse(data.started_at), limitMinutes: data.limit_minutes });
      setMode("break_timer");
      refreshStatus();
    }
  }

  async function submitReturn() {
    const data = await call("return", { pin });
    if (data.offline) {
      setMessage({ text: "No connection — saved and will sync automatically", tone: "warning" });
      setStage("result");
      return;
    }
    if (data.error) {
      setMessage({ text: data.error, tone: "error" });
    } else {
      setMessage({
        text: data.is_late_return ? `${data.guard} back — ${data.late_return_minutes}m late` : `${data.guard} back on time`,
        tone: data.is_late_return ? "warning" : "success",
      });
    }
    setStage("result");
    refreshStatus();
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

  // ---------- Site selection gate ----------
  if (!siteId) {
    return (
      <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4 relative">
        <button
          onClick={() => (mode === "settings" ? setMode("menu") : setMode("settings"))}
          className="absolute top-4 right-4 p-2 rounded-md text-text-muted hover:text-text-primary hover:bg-surface transition"
          aria-label="Settings"
        >
          {mode === "settings" ? <X size={22} /> : <Settings size={22} />}
        </button>

        <p className="font-mono text-xs text-accent tracking-wide mb-2">Hatume Security</p>

        {mode === "settings" ? (
          <SettingsPanel pendingCount={pendingCount} />
        ) : (
          <>
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
          </>
        )}
      </main>
    );
  }

  const currentSiteName = sites.find((s) => s.id === siteId)?.name;

  return (
    <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4 relative">
      {/* Settings gear, top right */}
      <button
        onClick={() => (mode === "settings" ? goMenu() : openMode("settings"))}
        className="absolute top-4 right-4 p-2 rounded-md text-text-muted hover:text-text-primary hover:bg-surface transition"
        aria-label="Settings"
      >
        {mode === "settings" ? <X size={22} /> : <Settings size={22} />}
      </button>

      {/* Late-return history badge, top left */}
      {lateReturns.length > 0 && (
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="absolute top-4 left-4 flex items-center gap-1.5 px-2 py-1 rounded-md text-warning text-xs hover:bg-surface transition"
        >
          <ClockIcon size={14} />
          {lateReturns.length} late return{lateReturns.length > 1 ? "s" : ""} today
        </button>
      )}

      {showHistory && (
        <div className="absolute top-14 left-4 bg-surface border border-border rounded-lg p-4 w-64 z-10">
          <p className="text-text-primary text-sm font-medium mb-2">Late returns today</p>
          <ul className="space-y-2">
            {lateReturns.map((l, i) => (
              <li key={i} className="text-xs text-text-secondary">
                <span className="text-text-primary">{l.guard}</span> — {l.late_by_minutes}m late
              </li>
            ))}
          </ul>
        </div>
      )}

      <p
        className="font-mono text-xs text-accent tracking-wide mb-1 select-none"
        onTouchStart={startPanicPress}
        onTouchEnd={cancelPanicPress}
        onMouseDown={startPanicPress}
        onMouseUp={cancelPanicPress}
        onMouseLeave={cancelPanicPress}
      >
        Hatume Security
      </p>
      <p className="text-text-muted text-xs mb-2">{currentSiteName}</p>

      {pendingCount > 0 && (
        <p className="text-warning text-xs mb-2">
          {pendingCount} action{pendingCount > 1 ? "s" : ""} waiting to sync…
        </p>
      )}

      {/* Live banner for anyone currently on break */}
      {mode === "menu" && openBreaks.length > 0 && (
        <div className="w-72 mb-4 space-y-2">
          {openBreaks.map((b, i) => (
            <LiveBreakBanner key={i} guard={b.guard} startedAt={b.started_at} limitMinutes={b.limit_minutes} />
          ))}
        </div>
      )}

      {stage === "result" && message ? (
        <p className={`text-2xl font-semibold text-center px-4 ${message.tone === "success" ? "text-success" : message.tone === "warning" ? "text-warning" : "text-danger"}`}>
          {message.text}
        </p>
      ) : mode === "menu" ? (
        <div className="w-72 space-y-3">
          <MenuButton label="Clock in / out" onClick={() => openMode("clock")} />
          <MenuButton label="Relieve a guard (supervisor)" onClick={() => openMode("relieve")} />
          <MenuButton label="Return from break" onClick={() => openMode("return")} />
          <button onClick={() => setSiteId(null)} className="w-full text-text-muted text-xs underline pt-2">
            Change site
          </button>
        </div>
      ) : mode === "settings" ? (
        <SettingsPanel pendingCount={pendingCount} />
      ) : mode === "break_timer" && breakInfo ? (
        <BreakCountdown info={breakInfo} onDismiss={goMenu} />
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
          onCancel={goMenu}
        />
      )}
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

function BreakCountdown({
  info,
  onDismiss,
}: {
  info: { guardName: string; startedAt: number; limitMinutes: number };
  onDismiss: () => void;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const limitSeconds = info.limitMinutes * 60;
  const elapsedSeconds = Math.floor((now - info.startedAt) / 1000);
  const remainingSeconds = limitSeconds - elapsedSeconds;
  const isOvertime = remainingSeconds < 0;
  const displaySeconds = Math.abs(remainingSeconds);
  const mm = String(Math.floor(displaySeconds / 60)).padStart(2, "0");
  const ss = String(displaySeconds % 60).padStart(2, "0");

  const fraction = Math.max(0, Math.min(1, remainingSeconds / limitSeconds));
  const radius = 90;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = isOvertime ? 0 : circumference * (1 - fraction);

  let ringColor = "#F2762E";
  if (isOvertime) ringColor = "#E1484C";
  else if (fraction < 0.34) ringColor = "#E0A63A";

  return (
    <div className="flex flex-col items-center">
      <p className="text-text-secondary text-sm mb-1">{info.guardName} on break</p>
      <p className="text-text-muted text-xs mb-6">{isOvertime ? "Over the limit" : `Limit: ${info.limitMinutes} min`}</p>

      <div className="relative" style={{ width: 220, height: 220 }}>
        <svg width="220" height="220" viewBox="0 0 220 220">
          <circle cx="110" cy="110" r={radius} fill="none" stroke="#24272C" strokeWidth="14" />
          <circle
            cx="110"
            cy="110"
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashoffset}
            transform="rotate(-90 110 110)"
            style={{ transition: "stroke-dashoffset 1s linear, stroke 0.5s" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-4xl font-semibold" style={{ color: ringColor }}>
            {isOvertime ? "+" : ""}{mm}:{ss}
          </span>
        </div>
      </div>

      <button onClick={onDismiss} className="mt-8 text-text-muted text-xs underline">
        Back to menu
      </button>
    </div>
  );
}

function LiveBreakBanner({ guard, startedAt, limitMinutes }: { guard: string; startedAt: string; limitMinutes: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsedSeconds = Math.floor((now - Date.parse(startedAt)) / 1000);
  const remainingSeconds = limitMinutes * 60 - elapsedSeconds;
  const isOvertime = remainingSeconds < 0;
  const displaySeconds = Math.abs(remainingSeconds);
  const mm = String(Math.floor(displaySeconds / 60)).padStart(2, "0");
  const ss = String(displaySeconds % 60).padStart(2, "0");

  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-md border text-xs ${isOvertime ? "bg-danger/10 border-danger/40 text-danger" : "bg-accent/10 border-accent/40 text-accent"}`}>
      <span className="flex items-center gap-1.5">
        <ClockIcon size={13} />
        {guard} on break
      </span>
      <span className="font-mono">{isOvertime ? "+" : ""}{mm}:{ss}</span>
    </div>
  );
}

function SettingsPanel({ pendingCount }: { pendingCount: number }) {
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const buildId = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
  const shortVersion = buildId.slice(0, 7);

  async function checkForUpdates() {
    setChecking(true);
    setChecked(false);
    try {
      await fetch(window.location.href, { cache: "reload" });
      setChecked(true);
      setTimeout(() => window.location.reload(), 800);
    } catch {
      setChecking(false);
    }
  }

  async function logOut() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  return (
    <div className="text-center px-4 max-w-xs">
      <h1 className="text-text-primary text-lg font-semibold mb-1">Settings</h1>
      <p className="font-mono text-xs text-text-muted mb-1">Version {shortVersion}</p>
      {pendingCount > 0 && (
        <p className="text-warning text-xs mb-4">{pendingCount} action{pendingCount > 1 ? "s" : ""} waiting to sync</p>
      )}

      <button
        onClick={checkForUpdates}
        disabled={checking}
        className="w-full bg-accent text-bg font-medium rounded-md py-3 hover:opacity-90 transition disabled:opacity-50 mb-3"
      >
        {checking ? (checked ? "Restarting…" : "Checking…") : "Check for updates"}
      </button>

      <button
        onClick={logOut}
        className="w-full flex items-center justify-center gap-2 border border-border text-text-secondary rounded-md py-3 hover:bg-surface transition"
      >
        <LogOut size={16} />
        Log out of this tablet
      </button>

      <p className="text-text-muted text-xs mt-4">
        This tablet always loads the current live version — Check for updates just forces a fresh refresh in case the screen has been open a long time.
      </p>
    </div>
  );
}
