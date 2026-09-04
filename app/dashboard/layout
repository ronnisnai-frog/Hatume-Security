"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutGrid,
  Shield,
  MapPin,
  FileSpreadsheet,
  AlertTriangle,
  LogOut,
  Search,
  Bell,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid },
  { href: "/dashboard/guards", label: "Guards", icon: Shield },
  { href: "/dashboard/sites", label: "Sites", icon: MapPin },
  { href: "/dashboard/timesheets", label: "Timesheets", icon: FileSpreadsheet },
  { href: "/dashboard/alerts", label: "Alerts", icon: AlertTriangle },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [logoutOpen, setLogoutOpen] = useState(false);

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

  const initials = (email || "?")
    .split("@")[0]
    .slice(0, 2)
    .toUpperCase();

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
                active
                  ? "bg-accent text-bg"
                  : "text-text-secondary hover:bg-surfaceRaised hover:translate-x-[3px]"
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
          <div className="relative flex-1 flex justify-center max-w-[400px]">
            <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text"
              placeholder="Search…"
              className="w-full max-w-[320px] py-2.5 pl-9 pr-3.5 rounded-lg border border-border bg-bg text-text-primary text-[0.85rem] focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div className="flex items-center gap-3.5">
            <button className="text-text-primary p-1.5 hover:text-accent transition">
              <Bell size={18} />
            </button>
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
