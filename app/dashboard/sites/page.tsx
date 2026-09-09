"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

type Site = { id: string; name: string };
type OpenEntry = { site_id: string; guards: { full_name: string; role: string } | null };

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [openEntries, setOpenEntries] = useState<OpenEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("sites_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "time_entries" }, refreshEntries)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data: siteData } = await supabase.from("sites").select("id, name").order("name");
    setSites(siteData || []);
    await refreshEntries();
    setLoading(false);
  }

  async function refreshEntries() {
    const { data } = await supabase
      .from("time_entries")
      .select("site_id, guards!guard_id(full_name, role)")
      .is("clock_out", null);
    setOpenEntries((data as unknown as OpenEntry[]) || []);
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
      <h1 className="text-[1.5rem] font-extrabold text-text-primary">Sites</h1>
      <p className="text-text-secondary text-sm mb-[18px]">All active client locations, live guard status.</p>

      <div className="bg-surface border border-border rounded-[14px] p-5 shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_18px_rgba(0,0,0,0.35)] animate-fade-up">
        {sites.map((s) => {
          const atSite = openEntries.filter((e) => e.site_id === s.id);
          const guardsOnDuty = atSite.filter((e) => e.guards?.role !== "supervisor").map((e) => e.guards?.full_name).filter(Boolean);
          const supervisorOnDuty = atSite.find((e) => e.guards?.role === "supervisor")?.guards?.full_name;

          return (
            <div key={s.id} className="flex items-center gap-3.5 py-3 border-b border-border last:border-b-0">
              <div className="w-9 h-9 rounded-full bg-success/15 text-success flex items-center justify-center flex-none">
                <MapPin size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-[0.86rem] text-text-primary">{s.name}</div>
                <div className="text-text-secondary text-xs">
                  {guardsOnDuty.length > 0 ? guardsOnDuty.join(", ") : "No guard on duty"}
                </div>
              </div>
              <div className="text-right flex-none">
                <div className="text-text-muted text-[0.68rem] uppercase tracking-wide">Supervisor</div>
                <div className="text-text-secondary text-xs font-bold">{supervisorOnDuty || "—"}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
