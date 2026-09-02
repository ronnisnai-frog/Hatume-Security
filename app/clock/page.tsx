"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type Stage = "pin" | "override" | "result";

export default function ClockPage() {
  const params = useSearchParams();
  const siteId = params.get("site");

  const [pin, setPin] = useState("");
  const [supervisorPin, setSupervisorPin] = useState("");
  const [stage, setStage] = useState<Stage>("pin");
  const [message, setMessage] = useState<{ text: string; tone: "success" | "error" | "warning" } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (stage === "result") {
      const t = setTimeout(() => {
        setStage("pin");
        setPin("");
        setSupervisorPin("");
        setMessage(null);
      }, 3500);
      return () => clearTimeout(t);
    }
  }, [stage]);

  async function submit(withSupervisorPin?: string) {
    if (!siteId) {
      setMessage({ text: "This tablet has no site configured. Contact admin.", tone: "error" });
      setStage("result");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/clock`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin, site_id: siteId, supervisor_pin: withSupervisorPin }),
        }
      );
      const data = await res.json();

      if (data.requires_override) {
        setStage("override");
        setSubmitting(false);
        return;
      }
      if (data.error) {
        setMessage({ text: data.error, tone: "error" });
        setStage("result");
        setSubmitting(false);
        return;
      }
      if (data.action === "clock_in") {
        setMessage({
          text: `${data.guard} clocked in${data.is_late ? ` — late ${data.late_minutes}m` : ""}`,
          tone: data.is_late ? "warning" : "success",
        });
      } else {
        setMessage({
          text: `${data.guard} clocked out${data.is_early_leave ? ` — left ${data.early_minutes}m early` : ""}`,
          tone: data.is_early_leave ? "warning" : "success",
        });
      }
      setStage("result");
    } catch (e) {
      setMessage({ text: "Connection error. Try again.", tone: "error" });
      setStage("result");
    }
    setSubmitting(false);
  }

  function press(digit: string) {
    const target = stage === "override" ? supervisorPin : pin;
    if (target.length >= 6) return;
    const next = target + digit;
    if (stage === "override") setSupervisorPin(next);
    else setPin(next);
  }

  function clear() {
    if (stage === "override") setSupervisorPin("");
    else setPin("");
  }

  const activeValue = stage === "override" ? supervisorPin : pin;

  return (
    <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4">
      <p className="font-mono text-xs text-accent tracking-wide mb-2">Hatume Security</p>

      {stage === "result" && message ? (
        <div className="text-center">
          <p
            className={`text-2xl font-semibold ${
              message.tone === "success" ? "text-success" : message.tone === "warning" ? "text-warning" : "text-danger"
            }`}
          >
            {message.text}
          </p>
        </div>
      ) : (
        <>
          <h1 className="text-text-primary text-lg mb-1">
            {stage === "override" ? "Supervisor PIN required" : "Enter your PIN"}
          </h1>
          <p className="text-text-secondary text-sm mb-6">
            {stage === "override" ? "Guard is not scheduled at this site today" : "4–6 digits"}
          </p>

          <div className="flex gap-3 mb-8">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full border border-border ${
                  i < activeValue.length ? "bg-accent border-accent" : ""
                }`}
              />
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3 w-72">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <Key key={d} onClick={() => press(d)}>
                {d}
              </Key>
            ))}
            <Key onClick={clear}>Clear</Key>
            <Key onClick={() => press("0")}>0</Key>
            <Key
              onClick={() => (stage === "override" ? submit(supervisorPin) : submit())}
              disabled={submitting || activeValue.length < 4}
              accent
            >
              {submitting ? "…" : "Go"}
            </Key>
          </div>
        </>
      )}
    </main>
  );
}

function Key({
  children,
  onClick,
  disabled,
  accent,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-20 rounded-lg text-lg font-mono border border-border transition disabled:opacity-40 ${
        accent ? "bg-accent text-bg font-semibold" : "bg-surface text-text-primary hover:bg-surfaceRaised"
      }`}
    >
      {children}
    </button>
  );
}
