"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

type Site = { id: string; name: string };

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("sites")
      .select("id, name")
      .order("name")
      .then(({ data }) => {
        setSites(data || []);
        setLoading(false);
      });
  }, []);

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
      <p className="text-text-secondary text-sm mb-[18px]">All active client locations.</p>

      <div className="bg-surface border border-border rounded-[14px] p-5 shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_18px_rgba(0,0,0,0.35)] animate-fade-up">
        {sites.map((s) => (
          <div key={s.id} className="flex items-center gap-2.5 py-2.5 border-b border-border last:border-b-0">
            <div className="w-9 h-9 rounded-full bg-success/15 text-success flex items-center justify-center flex-none">
              <MapPin size={16} />
            </div>
            <div className="font-bold text-[0.86rem] text-text-primary">{s.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
