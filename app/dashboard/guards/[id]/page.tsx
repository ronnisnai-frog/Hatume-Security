"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Clock, AlertTriangle, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

type Guard = { id: string; full_name: string; role: string; pay_tier: string | null; active: boolean };
type Entry = {
  id: string;
  clock_in: string;
  clock_out: string | null;
  is_late: boolean;
  late_minutes: number;
  is_early_leave: boolean;
  early_minutes: number;
  is_override: boolean;
  rounded_minutes: number | null;
  sites: { name: string } | null;
};

function tierLabel(tier: string | null) {
  if (tier === "old_guard") return "Guard (old)";
  if (tier === "new_guard") return "Guard (new)";
  if (tier === "supervisor") return "Supervisor";
  return "Guard";
}
function initialsFor(name: string) {
  const parts = name.trim().split(" ");
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
}

export default function GuardDetailPage() {
  const params = useParams();
  const router = useRouter();
  const guardId = params.id as string;

  const [guard, setGuard] = useState<Guard | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [onDuty, setOnDuty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    load();
  }, [guardId]);

  async function load() {
    const { data: guardData, error } = await supabase
      .from("guards")
      .select("id, full_name, role, pay_tier, active")
      .eq("id", guardId)
      .maybeSingle();

    if (error || !guardData) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setGuard(guardData);

    const { data: entryData } = await supabase
      .from("time_entries")
      .select("id, clock_in, clock_out, is_late, late_minutes, is_early_leave, early_minutes, is_override, rounded_minutes, sites(name)")
      .eq("guard_id", guardId)
      .order("clock_in", { ascending: false })
      .limit(30);

    setEntries((entryData as unknown as Entry[]) || []);
    setOnDuty((entryData || []).some((e: any) => e.clock_in && !e.clock_out));
    setLoading(false);
  }

  if (loading) {
    return (
      <main className="flex items-center justify-center h-full">
        <p className="font-mono text-text-secondary text-sm">Loading…</p>
      </main>
    );
  }

  if (notFound || !guard) {
    return (
      <div>
        <button onClick={() => router.push("/dashboard/guards")} className="flex items-center gap-1.5 text-text-secondary text-sm mb-4 hover:text-text-primary transition">
          <ArrowLeft size={16} />
          Back to Guards
        </button>
        <p className="text-text-muted text-sm">Guard not found.</p>
      </div>
    );
  }

  const totalHours = entries.reduce((sum, e) => sum + (e.rounded_minutes || 0) / 60, 0);
  const lateCount = entries.filter((e) => e.is_late).length;
  const overrideCount = entries.filter((e) => e.is_override).length;

  return (
    <div>
      <button onClick={() => router.push("/dashboard/guards")} className="flex items-center gap-1.5 text-text-secondary text-sm mb-4 hover:text-text-primary transition">
        <ArrowLeft size={16} />
        Back to Guards
      </button>

      <div className="flex items-center gap-4 mb-[18px]">
        <div className="w-16 h-16 rounded-full bg-accent text-bg flex items-center justify-center font-bold text-xl flex-none">
          {initialsFor(guard.full_name)}
        </div>
        <div>
          <h1 className="text-[1.4rem] font-extrabold text-text-primary">{guard.full_name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-text-secondary text-sm">{tierLabel(guard.pay_tier)}</span>
            <span className={`px-2 py-0.5 rounded-[10px] text-[0.7rem] font-bold ${onDuty ? "bg-success/15 text-success" : "bg-surfaceRaised text-text-secondary"}`}>
              {onDuty ? "On Duty" : "Off Duty"}
            </span>
          </div>
        </div>
      </div>

      <div className="flex gap-4 mb-[18px] flex-wrap">
        <StatCard icon={<TrendingUp size={16} />} label="Hours (last 30 entries)" value={totalHours.toFixed(1)} />
        <StatCard icon={<Clock size={16} />} label="Late Arrivals" value={String(lateCount)} />
        <StatCard icon={<AlertTriangle size={16} />} label="Overrides" value={String(overrideCount)} />
      </div>

      <div className="bg-surface border border-border rounded-[14px] p-5 shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_18px_rgba(0,0,0,0.35)] animate-fade-up">
        <h3 className="text-text-primary font-extrabold text-base mb-3.5">Recent History</h3>
        {entries.length === 0 ? (
          <p className="text-text-muted text-sm py-6 text-center">No clock-in history yet.</p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between py-2.5 border-b border-border last:border-b-0">
              <div>
                <div className="font-bold text-[0.86rem] text-text-primary">{e.sites?.name ?? "Unknown site"}</div>
                <div className="text-text-secondary text-xs">
                  {new Date(e.clock_in).toLocaleDateString()} · {new Date(e.clock_in).toLocaleTimeString()}
                  {e.clock_out ? ` – ${new Date(e.clock_out).toLocaleTimeString()}` : " – still on site"}
                </div>
              </div>
              <div className="flex gap-1">
                {e.is_late && <Tag color="warning">{e.late_minutes}m late</Tag>}
                {e.is_early_leave && <Tag color="warning">{e.early_minutes}m early</Tag>}
                {e.is_override && <Tag color="danger">Override</Tag>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex-1 min-w-[160px] bg-surface border border-border rounded-[14px] p-4 relative shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_18px_rgba(0,0,0,0.35)]">
      <div className="absolute top-3.5 right-3.5 w-7 h-7 rounded-full bg-surfaceRaised text-text-primary flex items-center justify-center">{icon}</div>
      <div className="text-[0.78rem] text-text-secondary mb-2">{label}</div>
      <div className="text-[1.5rem] font-bold text-text-primary">{value}</div>
    </div>
  );
}

function Tag({ color, children }: { color: "warning" | "danger"; children: React.ReactNode }) {
  const cls = color === "warning" ? "bg-warning/15 text-warning" : "bg-danger/15 text-danger";
  return <span className={`font-mono text-[11px] rounded px-2 py-0.5 h-fit ${cls}`}>{children}</span>;
}
