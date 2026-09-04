"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

type Guard = {
  id: string;
  full_name: string;
  role: string;
  pay_tier: string | null;
  active: boolean;
};

function initialsFor(name: string) {
  const parts = name.trim().split(" ");
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
}

function tierLabel(tier: string | null) {
  if (tier === "old_guard") return "Guard (old)";
  if (tier === "new_guard") return "Guard (new)";
  if (tier === "supervisor") return "Supervisor";
  return "Guard";
}

export default function GuardsPage() {
  const [guards, setGuards] = useState<Guard[]>([]);
  const [onDutyIds, setOnDutyIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: guardData } = await supabase
      .from("guards")
      .select("id, full_name, role, pay_tier, active")
      .order("full_name");

    const { data: openEntries } = await supabase.from("time_entries").select("guard_id").is("clock_out", null);

    setGuards(guardData || []);
    setOnDutyIds(new Set((openEntries || []).map((e: any) => e.guard_id)));
    setLoading(false);
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
      <h1 className="text-[1.5rem] font-extrabold text-text-primary">Guards</h1>
      <p className="text-text-secondary text-sm mb-[18px]">Your security personnel and their current status.</p>

      <div className="flex flex-wrap gap-[18px]">
        {guards.map((g, i) => {
          const onDuty = onDutyIds.has(g.id);
          return (
            <div
              key={g.id}
              className="w-[280px] bg-surface border border-border rounded-xl p-5 shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_18px_rgba(0,0,0,0.35)] animate-fade-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="w-[52px] h-[52px] rounded-full bg-accent text-bg flex items-center justify-center font-bold text-[1.1rem] mb-3">
                {initialsFor(g.full_name)}
              </div>
              <div className="font-bold text-[0.98rem] text-text-primary">{g.full_name}</div>
              <div className="text-text-secondary text-xs mb-2.5">{tierLabel(g.pay_tier)}</div>
              <span
                className={`inline-block px-2.5 py-1 rounded-[10px] text-[0.72rem] font-bold ${
                  onDuty ? "bg-success/15 text-success" : "bg-surfaceRaised text-text-secondary"
                }`}
              >
                {onDuty ? "On Duty" : "Off Duty"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
