"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, MapPin, AlertTriangle, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

type TimeEntry = {
  id: string;
  clock_in: string;
  clock_out: string | null;
  is_late: boolean;
  late_minutes: number;
  is_early_leave: boolean;
  early_minutes: number;
  is_override: boolean;
  rounded_minutes: number | null;
  guards: { full_name: string } | null;
  sites: { name: string } | null;
};

type Shift = {
  id: string;
  guard_id: string;
  site_id: string;
  scheduled_start: string;
  guards: { full_name: string } | null;
  sites: { name: string } | null;
};

export default function DashboardOverview() {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [absentShifts, setAbsentShifts] = useState<Shift[]>([]);
  const [siteCount, setSiteCount] = useState(0);
  const [weekCounts, setWeekCounts] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);

  useEffect(() => {
    loadData();
    const channel = supabase
      .channel("overview_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "time_entries" }, loadData)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function loadData() {
    const today = new Date().toISOString().slice(0, 10);

    const { data: entryData } = await supabase
      .from("time_entries")
      .select(
        "id, clock_in, clock_out, is_late, late_minutes, is_early_leave, early_minutes, is_override, rounded_minutes, guards(full_name), sites(name)"
      )
      .gte("clock_in", `${today}T00:00:00`)
      .order("clock_in", { ascending: false });

    const { data: shiftData } = await supabase
      .from("shifts")
      .select("id, guard_id, site_id, scheduled_start, guards(full_name), sites(name)")
      .eq("shift_date", today);

    const { count: sc } = await supabase.from("sites").select("*", { count: "exact", head: true });

    // Last 7 days of check-in counts, for the activity bars
    const counts: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().slice(0, 10);
      const { count } = await supabase
        .from("time_entries")
        .select("*", { count: "exact", head: true })
        .gte("clock_in", `${dayStr}T00:00:00`)
        .lte("clock_in", `${dayStr}T23:59:59`);
      counts.push(count || 0);
    }
    setWeekCounts(counts);

    setEntries((entryData as unknown as TimeEntry[]) || []);
    setSiteCount(sc || 0);

    const clockedInGuardIds = new Set((entryData || []).map((e: any) => e.guard_id));
    const graceMs = 15 * 60 * 1000;
    const missed = (shiftData || []).filter((s: any) => {
      const started = new Date(s.scheduled_start).getTime();
      return !clockedInGuardIds.has(s.guard_id) && Date.now() - started > graceMs;
    });
    setAbsentShifts((missed as unknown as Shift[]) || []);
    setLoading(false);
  }

  const onDuty = entries.filter((e) => e.clock_in && !e.clock_out).length;
  const overrides = entries.filter((e) => e.is_override).length;
  const openAlerts = absentShifts.length + overrides;
  const lateToday = entries.filter((e) => e.is_late).length;
  const maxCount = Math.max(...weekCounts, 1);

  if (loading) {
    return (
      <main className="flex items-center justify-center h-full">
        <p className="font-mono text-text-secondary text-sm">Loading…</p>
      </main>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-start mb-[18px] flex-wrap gap-3.5">
        <div>
          <h1 className="text-[1.5rem] font-extrabold text-text-primary">Dashboard</h1>
          <p className="text-text-secondary text-sm">Monitor all active sites and guard status at a glance.</p>
        </div>
      </div>

      {/* ===== Stat row ===== */}
      <div className="flex gap-4 mb-[18px] flex-wrap">
        <StatCard
          hero
          icon={<ShieldCheck size={16} />}
          label="Guards On Duty"
          value={onDuty}
          delay={0}
        />
        <StatCard
          icon={<MapPin size={16} />}
          label="Active Sites"
          value={siteCount}
          delay={80}
          iconBg="bg-success/15"
          iconColor="text-success"
        />
        <StatCard
          icon={<AlertTriangle size={16} />}
          label="Open Alerts"
          value={openAlerts}
          delay={160}
          iconBg="bg-warning/15"
          iconColor="text-warning"
        />
        <StatCard
          icon={<Clock size={16} />}
          label="Late Check-ins"
          value={lateToday}
          delay={240}
        />
      </div>

      {/* ===== Two-col: activity + alerts ===== */}
      <div className="flex gap-4 mb-4 flex-wrap">
        <div
          className="bg-surface border border-border rounded-[14px] p-5 flex-[1.4] min-w-[280px] shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_18px_rgba(0,0,0,0.35)] animate-fade-up"
          style={{ animationDelay: "80ms" }}
        >
          <div className="flex justify-between items-center mb-3.5">
            <h3 className="text-text-primary font-extrabold text-base">Check-ins This Week</h3>
            <span className="text-text-secondary text-xs">● All Sites</span>
          </div>
          <div className="h-[150px] flex items-end gap-2.5">
            {weekCounts.map((c, i) => (
              <div
                key={i}
                className="flex-1 bg-accent rounded-t-md transition-all"
                style={{ height: `${Math.max((c / maxCount) * 100, 4)}%` }}
              />
            ))}
          </div>
        </div>

        <div
          className="bg-surface border border-border rounded-[14px] p-5 flex-1 min-w-[280px] shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_18px_rgba(0,0,0,0.35)] animate-fade-up"
          style={{ animationDelay: "160ms" }}
        >
          <div className="flex justify-between items-center mb-3.5">
            <h3 className="text-text-primary font-extrabold text-base">Alerts</h3>
          </div>
          {openAlerts === 0 ? (
            <EmptyState text="No alerts right now." />
          ) : (
            <div className="bg-bg rounded-lg p-3.5">
              <div className="font-bold text-[0.86rem] text-text-primary">
                {openAlerts} item{openAlerts > 1 ? "s" : ""} need attention
              </div>
              <div className="text-text-secondary text-xs mt-0.5 mb-2.5">
                {absentShifts.length} absence{absentShifts.length !== 1 ? "s" : ""}, {overrides} override
                {overrides !== 1 ? "s" : ""}
              </div>
              <a
                href="/dashboard/alerts"
                className="block text-center w-full bg-accent text-bg font-bold text-sm rounded-lg py-2.5 hover:opacity-90 transition"
              >
                Review Now
              </a>
            </div>
          )}
        </div>
      </div>

      {/* ===== Recent check-ins ===== */}
      <div
        className="bg-surface border border-border rounded-[14px] p-5 shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_18px_rgba(0,0,0,0.35)] animate-fade-up"
        style={{ animationDelay: "240ms" }}
      >
        <div className="flex justify-between items-center mb-3.5">
          <h3 className="text-text-primary font-extrabold text-base">Recent Check-ins</h3>
        </div>
        {entries.length === 0 ? (
          <EmptyState text="No clock-ins yet today." />
        ) : (
          entries.slice(0, 8).map((e) => (
            <div key={e.id} className="flex items-center gap-2.5 py-2.5 border-b border-border last:border-b-0">
              <div className="w-9 h-9 rounded-full bg-accent text-bg flex items-center justify-center font-bold text-[0.8rem] flex-none">
                {initialsFor(e.guards?.full_name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-[0.86rem] text-text-primary">{e.guards?.full_name ?? "Unknown guard"}</div>
                <div className="text-text-secondary text-xs">{e.sites?.name ?? "Unknown site"}</div>
              </div>
              {e.is_late ? (
                <Badge tone="warning">{e.late_minutes}m late</Badge>
              ) : (
                <Badge tone="success">On Time</Badge>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function initialsFor(name?: string) {
  if (!name) return "?";
  const parts = name.trim().split(" ");
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
}

function StatCard({
  icon,
  label,
  value,
  hero,
  delay,
  iconBg,
  iconColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hero?: boolean;
  delay: number;
  iconBg?: string;
  iconColor?: string;
}) {
  return (
    <div
      className={`flex-1 min-w-[170px] rounded-[14px] p-4 relative shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_18px_rgba(0,0,0,0.35)] animate-fade-up ${
        hero ? "bg-accent text-bg" : "bg-surface border border-border"
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        className={`absolute top-3.5 right-3.5 w-7 h-7 rounded-full flex items-center justify-center ${
          hero ? "bg-white/20 text-bg" : iconBg || "bg-surfaceRaised text-text-primary" 
        } ${!hero && iconColor ? iconColor : ""}`}
      >
        {icon}
      </div>
      <div className={`text-[0.78rem] mb-2 ${hero ? "text-bg/70" : "text-text-secondary"}`}>{label}</div>
      <div className={`text-[1.7rem] font-bold ${hero ? "text-bg" : "text-text-primary"}`}>{value}</div>
    </div>
  );
}

function Badge({ tone, children }: { tone: "success" | "warning"; children: React.ReactNode }) {
  const cls = tone === "success" ? "bg-success/15 text-success" : "bg-warning/15 text-warning";
  return <span className={`inline-block px-2.5 py-1 rounded-[10px] text-[0.72rem] font-bold ${cls}`}>{children}</span>;
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-text-muted text-sm py-6 text-center">{text}</p>;
}
