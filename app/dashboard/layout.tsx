"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutGrid,
  Shield,
  MapPin,
  FileSpreadsheet,
  AlertTriangle,
  CalendarRange,
  Settings as SettingsIcon,
  LogOut,
  Search,
  Bell,
  User,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid },
  { href: "/dashboard/guards", label: "Guards", icon: Shield },
  { href: "/dashboard/sites", label: "Sites", icon: MapPin },
  { href: "/dashboard/roster", label: "Roster", icon: CalendarRange },
  { href: "/dashboard/timesheets", label: "Timesheets", icon: FileSpreadsheet },
  { href: "/dashboard/alerts", label: "Alerts", icon: AlertTriangle },
  { href: "/dashboard/settings", label: "Settings", icon: SettingsIcon },
];

type SearchGuard = { id: string; full_name: string };
type SearchSite = { id: string; name: string };
type AlertItem = { type: "absence" | "override" | "panic"; label: string; sub: string };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [logoutOpen, setLogoutOpen] = useState(false);

  const [allGuards, setAllGuards] = useState<SearchGuard[]>([]);
  const [allSites, setAllSites] = useState<SearchSite[]>([]);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const [bellOpen, setBellOpen] = useState(false);
  const [alertItems, setAlertItems] = useState<AlertItem[]>([]);
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.push("/login");
        return;
      }
      setEmail(data.session.user.email ?? null);
      setChecking(false);
    });
  }, [router]);

  useEffect(() => {
    if (checking) return;
    supabase.from("guards").select("id, full_name").eq("active", true).then(({ data }) => setAllGuards(data || []));
    supabase.from("sites").select("id, name").then(({ data }) => setAllSites(data || []));
    loadAlerts();
    const channel = supabase
      .channel("layout_alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "time_entries" }, loadAlerts)
      .on("postgres_changes", { event: "*", schema: "public", table: "panic_alerts" }, loadAlerts)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [checking]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function loadAlerts() {
    const today = new Date().toISOString().slice(0, 10);

    const { data: shifts } = await supabase
      .from("shifts")
      .select("guard_id, scheduled_start, guards(full_name), sites(name)")
      .eq("shift_date", today);
    const { data: entries } = await supabase
      .from("time_entries")
      .select("guard_id, is_override, guards(full_name), sites(name)")
      .gte("clock_in", `${today}T00:00:00`);
    const { data: panics } = await supabase
      .from("panic_alerts")
      .select("id, triggered_at, sites(name)")
      .eq("acknowledged", false)
      .order("triggered_at", { ascending: false });

    const clockedInIds = new Set((entries || []).map((e: any) => e.guard_id));
    const graceMs = 15 * 60 * 1000;
    const items: AlertItem[] = [];

    for (const p of panics || []) {
      items.push({ type: "panic", label: `Duress alert — ${(p as any).sites?.name ?? "Unknown site"}`, sub: new Date((p as any).triggered_at).toLocaleTimeString() });
    }
    for (const s of shifts || []) {
      const started = new Date((s as any).scheduled_start).getTime();
      if (!clockedInIds.has((s as any).guard_id) && Date.now() - started > graceMs) {
        items.push({ type: "absence", label: `${(s as any).guards?.full_name ?? "Guard"} — absent`, sub: (s as any).sites?.name ?? "" });
      }
    }
    for (const e of entries || []) {
      if ((e as any).is_override) {
        items.push({ type: "override", label: `${(e as any).guards?.full_name ?? "Guard"} — override`, sub: (e as any).sites?.name ?? "" });
      }
    }
    setAlertItems(items);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (checking) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="font-mono text-text-secondary text-sm">Loading…</p>
      </main>
    );
  }

  const initials = (email || "?").split("@")[0].slice(0, 2).toUpperCase();

  const q = query.trim().toLowerCase();
  const matchedGuards = q ? allGuards.filter((g) => g.full_name.toLowerCase().includes(q)).slice(0, 5) : [];
  const matchedSites = q ? allSites.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 5) : [];
  const hasResults = matchedGuards.length > 0 || matchedSites.length > 0;

  return (
    <div className="min-h-screen flex items-stretch">
      {/* ===== Sidebar ===== */}
      <aside className="w-[220px] flex-none bg-surface border-r border-border py-0 pb-4">
        <div className="flex items-center gap-2.5 px-5 pt-[18px] pb-[22px]">
          <span className="font-semibold text-[1.1rem] text-text-primary">
            <span className="text-accent">Hatume</span> Security
          </span>
        </div>

        <div className="px-5 pt-2.5 pb-2 text-[0.72rem] uppercase tracking-wide text-text-secondary font-bold">
          Menu
        </div>
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-4 py-2.5 mx-3 my-0.5 rounded-lg text-[0.88rem] font-semibold transition-all duration-200 ${
                active ? "bg-accent text-bg" : "text-text-secondary hover:bg-surfaceRaised hover:translate-x-[3px]"
              }`}
            >
              <Icon size={16} />
              {item.label}
            </Link>
          );
        })}

        <div className="px-5 pt-4 pb-2 text-[0.72rem] uppercase tracking-wide text-text-secondary font-bold">
          General
        </div>
        <button
          onClick={() => setLogoutOpen(true)}
          className="flex items-center gap-2.5 px-4 py-2.5 mx-3 my-0.5 rounded-lg text-[0.88rem] font-semibold text-danger hover:bg-surfaceRaised transition-all w-[calc(100%-1.5rem)] text-left"
        >
          <LogOut size={16} />
          Logout
        </button>
      </aside>

      {/* ===== Main area ===== */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="bg-surface border-b border-border flex items-center justify-between px-6 py-3.5">
          <div ref={searchRef} className="relative flex-1 flex justify-center max-w-[400px]">
            <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary z-10" />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search guards or sites…"
              className="w-full max-w-[320px] py-2.5 pl-9 pr-3.5 rounded-lg border border-border bg-bg text-text-primary text-[0.85rem] focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {searchOpen && q && (
              <div className="absolute top-full mt-1 w-full max-w-[320px] bg-surface border border-border rounded-lg shadow-[0_8px_18px_rgba(0,0,0,0.4)] z-20 overflow-hidden">
                {!hasResults ? (
                  <p className="text-text-muted text-xs px-3.5 py-3">No matches.</p>
                ) : (
                  <>
                    {matchedGuards.map((g) => (
                      <Link
                        key={g.id}
                        href={`/dashboard/guards/${g.id}`}
                        onClick={() => setSearchOpen(false)}
                        className="flex items-center gap-2 px-3.5 py-2.5 hover:bg-surfaceRaised transition text-sm text-text-primary"
                      >
                        <User size={14} className="text-accent" />
                        {g.full_name}
                      </Link>
                    ))}
                    {matchedSites.map((s) => (
                      <Link
                        key={s.id}
                        href="/dashboard/sites"
                        onClick={() => setSearchOpen(false)}
                        className="flex items-center gap-2 px-3.5 py-2.5 hover:bg-surfaceRaised transition text-sm text-text-primary"
                      >
                        <MapPin size={14} className="text-success" />
                        {s.name}
                      </Link>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3.5">
            <div ref={bellRef} className="relative">
              <button onClick={() => setBellOpen((v) => !v)} className="relative text-text-primary p-1.5 hover:text-accent transition">
                <Bell size={18} />
                {alertItems.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-danger text-white text-[0.6rem] font-bold flex items-center justify-center">
                    {alertItems.length > 9 ? "9+" : alertItems.length}
                  </span>
                )}
              </button>
              {bellOpen && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-surface border border-border rounded-lg shadow-[0_8px_18px_rgba(0,0,0,0.4)] z-20 overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-border font-bold text-sm text-text-primary">Alerts</div>
                  {alertItems.length === 0 ? (
                    <p className="text-text-muted text-xs px-3.5 py-4 text-center">Nothing needs attention.</p>
                  ) : (
                    <div className="max-h-64 overflow-y-auto">
                      {alertItems.slice(0, 8).map((a, i) => (
                        <div key={i} className="px-3.5 py-2.5 border-b border-border last:border-b-0">
                          <div className={`text-xs font-bold ${a.type === "panic" ? "text-danger" : "text-text-primary"}`}>{a.label}</div>
                          <div className="text-text-secondary text-[0.7rem]">{a.sub}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <Link
                    href="/dashboard/alerts"
                    onClick={() => setBellOpen(false)}
                    className="block text-center text-accent text-xs font-bold py-2.5 hover:bg-surfaceRaised transition"
                  >
                    View all alerts
                  </Link>
                </div>
              )}
            </div>
            <div className="w-[34px] h-[34px] rounded-full bg-accent text-bg flex items-center justify-center font-bold text-[0.85rem]">
              {initials}
            </div>
          </div>
        </header>

        <div className="flex-1 px-7 py-6">{children}</div>
      </div>

      {/* ===== Logout modal ===== */}
      {logoutOpen && (
        <div className="fixed inset-0 bg-black/50 z-[400] flex items-center justify-center p-6">
          <div className="bg-surface rounded-2xl p-8 max-w-[340px] w-full text-center border border-border">
            <div className="w-[52px] h-[52px] rounded-full bg-surfaceRaised flex items-center justify-center mx-auto mb-4">
              <LogOut size={22} className="text-accent" />
            </div>
            <h3 className="text-text-primary font-bold text-lg mb-1">Logout</h3>
            <p className="text-text-secondary text-sm mb-5">Are you sure you want to logout?</p>
            <div className="flex gap-2.5">
              <button
                onClick={() => setLogoutOpen(false)}
                className="flex-1 py-2.5 rounded-lg border border-border text-text-primary font-bold text-sm hover:bg-surfaceRaised transition"
              >
                Cancel
              </button>
              <button
                onClick={handleLogout}
                className="flex-1 py-2.5 rounded-lg bg-accent text-bg font-bold text-sm hover:opacity-90 transition"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
