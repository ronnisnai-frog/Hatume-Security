"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

type Absence = { id: string; guards: { full_name: string } | null; sites: { name: string } | null; shift_date: string; scheduled_start: string };
type Override = { id: string; clock_in: string; guards: { full_name: string } | null; sites: { name: string } | null; authorized_by_guard?: { full_name: string } | null };
type Panic = { id: string; triggered_at: string; acknowledged: boolean; sites: { name: string } | null };

export default function AlertsPage() {
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [panics, setPanics] = useState<Panic[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const today = new Date().toISOString().slice(0, 10);

    const { data: shifts } = await supabase
      .from("shifts")
      .select("id, guard_id, shift_date, scheduled_start, guards(full_name), sites(name)")
      .eq("shift_date", today);

    const { data: entries } = await supabase
      .from("time_entries")
      .select("id, guard_id, clock_in, is_override, guards(full_name), sites(name)")
      .gte("clock_in", `${today}T00:00:00`);

    const clockedInIds = new Set((entries || []).map((e: any) => e.guard_id));
    const graceMs = 15 * 60 * 1000;
    const missed = (shifts || []).filter((s: any) => {
      const started = new Date(s.scheduled_start).getTime();
      return !clockedInIds.has(s.guard_id) && Date.now() - started > graceMs;
    });

    const overrideEntries = (entries || []).filter((e: any) => e.is_override);

    const { data: panicData } = await supabase
      .from("panic_alerts")
      .select("id, triggered_at, acknowledged, sites(name)")
      .order("triggered_at", { ascending: false })
      .limit(20);

    setAbsences((missed as unknown as Absence[]) || []);
    setOverrides((overrideEntries as unknown as Override[]) || []);
    setPanics((panicData as unknown as Panic[]) || []);
    setLoading(false);
  }

  async function acknowledgePanic(id: string) {
    await supabase.from("panic_alerts").update({ acknowledged: true, acknowledged_at: new Date().toISOString() }).eq("id", id);
    load();
  }

  if (loading) {
    return (
      <main className="flex items-center justify-center h-full">
        <p className="font-mono text-text-secondary text-sm">Loading…</p>
      </main>
    );
  }

  const unacknowledgedPanics = panics.filter((p) => !p.acknowledged);

  return (
    <div>
      <h1 className="text-[1.5rem] font-extrabold text-text-primary">Alerts</h1>
      <p className="text-text-secondary text-sm mb-[18px]">Absences, overrides, and duress alerts.</p>

      {unacknowledgedPanics.length > 0 && (
        <Panel title="Duress alerts" delay={0} tone="danger">
          {unacknowledgedPanics.map((p) => (
            <div key={p.id} className="flex items-center justify-between py-2.5 border-b border-border last:border-b-0">
              <div>
                <div className="font-bold text-[0.86rem] text-danger">{p.sites?.name ?? "Unknown site"}</div>
                <div className="text-text-secondary text-xs">{new Date(p.triggered_at).toLocaleString()}</div>
              </div>
              <button
                onClick={() => acknowledgePanic(p.id)}
                className="text-xs font-bold px-3 py-1.5 rounded-lg border border-border text-text-primary hover:bg-surfaceRaised transition"
              >
                Acknowledge
              </button>
            </div>
          ))}
        </Panel>
      )}

      <Panel title="Absences today" delay={80}>
        {absences.length === 0 ? (
          <EmptyState text="No absences flagged." />
        ) : (
          absences.map((a) => (
            <div key={a.id} className="py-2.5 border-b border-border last:border-b-0">
              <div className="font-bold text-[0.86rem] text-text-primary">{a.guards?.full_name ?? "Guard"}</div>
              <div className="text-text-secondary text-xs">
                Expected at {a.sites?.name} · {new Date(a.scheduled_start).toLocaleTimeString()}
              </div>
            </div>
          ))
        )}
      </Panel>

      <Panel title="Overrides today" delay={160}>
        {overrides.length === 0 ? (
          <EmptyState text="No overrides today." />
        ) : (
          overrides.map((o) => (
            <div key={o.id} className="py-2.5 border-b border-border last:border-b-0">
              <div className="font-bold text-[0.86rem] text-text-primary">{o.guards?.full_name ?? "Guard"}</div>
              <div className="text-text-secondary text-xs">
                {o.sites?.name} · {new Date(o.clock_in).toLocaleTimeString()}
              </div>
            </div>
          ))
        )}
      </Panel>
    </div>
  );
}

function Panel({ title, delay, tone, children }: { title: string; delay: number; tone?: "danger"; children: React.ReactNode }) {
  return (
    <div
      className={`bg-surface border rounded-[14px] p-5 mb-4 shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_18px_rgba(0,0,0,0.35)] animate-fade-up ${
        tone === "danger" ? "border-danger/40" : "border-border"
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <h3 className={`font-extrabold text-base mb-3.5 ${tone === "danger" ? "text-danger" : "text-text-primary"}`}>{title}</h3>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-text-muted text-sm py-4 text-center">{text}</p>;
}
