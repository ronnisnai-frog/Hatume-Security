"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [absentShifts, setAbsentShifts] = useState<Shift[]>([]);
  const [siteCount, setSiteCount] = useState(0);
  const [guardCount, setGuardCount] = useState(0);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    async function init() {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        router.push("/login");
        return;
      }
      await loadData();
      setLoading(false);
    }
    init();

    const channel = supabase
      .channel("time_entries_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "time_entries" }, loadData)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadData() {
    const today = new Date().toISOString().slice(0, 10);

    const { data: entryData } = await supabase
      .from("time_entries")
      .select("id, clock_in, clock_out, is_late, late_minutes, is_early_leave, early_minutes, is_override, rounded_minutes, guards(full_name), sites(name)")
      .gte("clock_in", `${today}T00:00:00`)
      .order("clock_in", { ascending: false });

    const { data: shiftData } = await supabase
      .from("shifts")
      .select("id, guard_id, site_id, scheduled_start, guards(full_name), sites(name)")
      .eq("shift_date", today);

    const { count: sc } = await supabase.from("sites").select("*", { count: "exact", head: true });
    const { count: gc } = await supabase.from("guards").select("*", { count: "exact", head: true }).eq("active", true);

    setEntries((entryData as unknown as TimeEntry[]) || []);
    setSiteCount(sc || 0);
    setGuardCount(gc || 0);

    const clockedInGuardIds = new Set((entryData || []).map((e: any) => e.guard_id));
    const graceMs = 15 * 60 * 1000;
    const missed = (shiftData || []).filter((s: any) => {
      const started = new Date(s.scheduled_start).getTime();
      return !clockedInGuardIds.has(s.guard_id) && Date.now() - started > graceMs;
    });
    setAbsentShifts((missed as unknown as Shift[]) || []);
  }

  const onDuty = entries.filter((e) => e.clock_in && !e.clock_out).length;
  const completed = entries.filter((e) => e.clock_out).length;
  const overrides = entries.filter((e) => e.is_override).length;

  if (loading) {
    return (
      <main className="min-h-screen bg-bg flex items-center justify-center">
        <p className="font-mono text-text-secondary text-sm">Loading guard data…</p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-bg flex">
      {/* Sidebar */}
      <aside className="w-60 border-r border-border flex flex-col">
        <div className="px-6 py-6 border-b border-border">
          <p className="font-semibold text-text-primary">Hatume Security</p>
          <p className="font-mono text-xs text-text-muted mt-1">Guard monitor</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          <SidebarItem label="Overview" active />
          <SidebarItem label="Guards" />
          <SidebarItem label="Sites" />
          <SidebarItem label="Timesheets" />
          <SidebarItem label="Alerts" badge={absentShifts.length + overrides || undefined} />
        </nav>
        <div className="px-6 py-4 border-t border-border font-mono text-xs text-text-muted">
          {guardCount} guards · {siteCount} sites
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 px-8 py-6">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">Overview</h1>
            <p className="text-sm text-text-secondary">Today, {now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</p>
          </div>
          <p className="font-mono text-sm text-text-secondary">{now.toLocaleTimeString()}</p>
        </header>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <StatCard label="On duty now" value={onDuty} accent="success" />
          <StatCard label="Completed shifts today" value={completed} accent="default" />
          <StatCard label="Absent today" value={absentShifts.length} accent="danger" />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Card title="Live activity" className="col-span-2">
            {entries.length === 0 ? (
              <EmptyState text="No clock-ins yet today." />
            ) : (
              <ul className="divide-y divide-border">
                {entries.map((e) => (
                  <li key={e.id} className="py-3 flex items-start justify-between text-sm">
                    <div>
                      <span className="text-text-primary font-medium">{e.guards?.full_name ?? "Unknown guard"}</span>
                      <span className="text-text-secondary"> — {e.sites?.name ?? "Unknown site"}</span>
                      <div className="font-mono text-xs text-text-muted mt-1">
                        In {new Date(e.clock_in).toLocaleTimeString()}
                        {e.clock_out ? ` · Out ${new Date(e.clock_out).toLocaleTimeString()}` : " · still on site"}
                        {e.rounded_minutes ? ` · ${(e.rounded_minutes / 60).toFixed(2)}h` : ""}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {e.is_late && <Tag color="warning">{`Late ${e.late_minutes}m`}</Tag>}
                      {e.is_early_leave && <Tag color="warning">{`Early ${e.early_minutes}m`}</Tag>}
                      {e.is_override && <Tag color="danger">Override</Tag>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Alerts">
            {absentShifts.length === 0 ? (
              <EmptyState text="No absences flagged." />
            ) : (
              <ul className="space-y-3">
                {absentShifts.map((s) => (
                  <li key={s.id} className="text-sm">
                    <p className="text-text-primary font-medium">{s.guards?.full_name ?? "Guard"}</p>
                    <p className="text-text-secondary text-xs">
                      Expected at {s.sites?.name} · {new Date(s.scheduled_start).toLocaleTimeString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}

function SidebarItem({ label, active, badge }: { label: string; active?: boolean; badge?: number }) {
  return (
    <div
      className={`flex items-center justify-between px-3 py-2 rounded-md text-sm cursor-pointer ${
        active ? "bg-accent/10 text-accent" : "text-text-secondary hover:bg-surface"
      }`}
    >
      <span>{label}</span>
      {badge ? (
        <span className="font-mono text-xs bg-danger/20 text-danger rounded-full px-2 py-0.5">{badge}</span>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: "success" | "danger" | "default" }) {
  const color = accent === "success" ? "text-success" : accent === "danger" ? "text-danger" : "text-text-primary";
  return (
    <div className="bg-surface border border-border rounded-lg px-5 py-4">
      <p className={`text-3xl font-semibold ${color}`}>{value}</p>
      <p className="text-sm text-text-secondary mt-1">{label}</p>
    </div>
  );
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface border border-border rounded-lg p-5 ${className}`}>
      <h2 className="text-sm font-medium text-text-primary mb-3">{title}</h2>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-text-muted py-6 text-center">{text}</p>;
}

function Tag({ color, children }: { color: "warning" | "danger"; children: React.ReactNode }) {
  const cls = color === "warning" ? "bg-warning/15 text-warning" : "bg-danger/15 text-danger";
  return <span className={`font-mono text-[11px] rounded px-2 py-0.5 h-fit ${cls}`}>{children}</span>;
}
