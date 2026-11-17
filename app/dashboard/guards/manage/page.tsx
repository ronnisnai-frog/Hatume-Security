"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, KeyRound, Pencil, Plus, UserCheck, UserX, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

type Guard = {
  id: string;
  full_name: string;
  pin: string;
  role: string;
  pay_tier: string | null;
  active: boolean;
};

const TIER_ORDER: Record<string, number> = { supervisor: 0, old_guard: 1, new_guard: 2 };

const TIER_OPTIONS = [
  { value: "new_guard", label: "Guard (new) — K288" },
  { value: "old_guard", label: "Guard (old) — K320" },
  { value: "supervisor", label: "Supervisor — K340" },
];

function tierLabel(tier: string | null) {
  if (tier === "old_guard") return "Guard (old)";
  if (tier === "new_guard") return "Guard (new)";
  if (tier === "supervisor") return "Supervisor";
  return "Guard";
}

function randomPin(taken: Set<string>) {
  for (let i = 0; i < 200; i++) {
    const p = String(Math.floor(1000 + Math.random() * 9000));
    if (!taken.has(p)) return p;
  }
  return "";
}

type FormState = { id: string | null; full_name: string; pay_tier: string; pin: string };

export default function ManageGuardsPage() {
  const [guards, setGuards] = useState<Guard[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data, error: err } = await supabase
      .from("guards")
      .select("id, full_name, pin, role, pay_tier, active");
    if (err) setError(err.message);
    const sorted = (data || []).sort((a: Guard, b: Guard) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      const ta = TIER_ORDER[a.pay_tier || "new_guard"] ?? 3;
      const tb = TIER_ORDER[b.pay_tier || "new_guard"] ?? 3;
      if (ta !== tb) return ta - tb;
      return a.full_name.localeCompare(b.full_name);
    });
    setGuards(sorted);
    setLoading(false);
  }

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  }

  function openAdd() {
    const taken = new Set(guards.map((g) => g.pin));
    setFormError(null);
    setForm({ id: null, full_name: "", pay_tier: "new_guard", pin: randomPin(taken) });
  }

  function openEdit(g: Guard) {
    setFormError(null);
    setForm({ id: g.id, full_name: g.full_name, pay_tier: g.pay_tier || "new_guard", pin: g.pin });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const name = form.full_name.trim().replace(/\s+/g, " ");
    if (name.length < 2) return setFormError("Enter the guard's full name.");
    if (!/^\d{4}$/.test(form.pin)) return setFormError("PIN must be exactly 4 digits.");
    if (guards.some((g) => g.id !== form.id && g.pin === form.pin)) {
      return setFormError("That PIN is already used by another guard (active or inactive). Pick a different one.");
    }
    if (guards.some((g) => g.id !== form.id && g.full_name.toLowerCase() === name.toLowerCase())) {
      return setFormError("A guard with that exact name already exists. Add a surname or initial so they can be told apart.");
    }

    const role = form.pay_tier === "supervisor" ? "supervisor" : "guard";
    setSaving(true);
    setFormError(null);

    const payload = { full_name: name, pay_tier: form.pay_tier, role, pin: form.pin };
    const { error: err } = form.id
      ? await supabase.from("guards").update(payload).eq("id", form.id)
      : await supabase.from("guards").insert({ ...payload, active: true });

    setSaving(false);
    if (err) {
      setFormError(
        err.message.toLowerCase().includes("duplicate") || err.code === "23505"
          ? "That PIN is already in use. Pick a different one."
          : err.message
      );
      return;
    }
    const wasEdit = !!form.id;
    setForm(null);
    flash(wasEdit ? "Changes saved." : `${name} added. Their PIN is ${payload.pin}.`);
    await load();
  }

  async function setActive(g: Guard, active: boolean) {
    if (!active) {
      const ok = confirm(
        `Deactivate ${g.full_name}?\n\nThey will no longer be able to clock in and will disappear from the Guards tab and roster upload. Their past clock records and pay history are kept.`
      );
      if (!ok) return;
    }
    const { error: err } = await supabase.from("guards").update({ active }).eq("id", g.id);
    if (err) {
      setError(err.message);
      return;
    }
    flash(active ? `${g.full_name} reactivated.` : `${g.full_name} deactivated.`);
    await load();
  }

  async function resetPin(g: Guard) {
    const taken = new Set(guards.map((x) => x.pin));
    const pin = randomPin(taken);
    if (!pin) return setError("Couldn't find a free PIN.");
    if (!confirm(`Give ${g.full_name} a new PIN?\n\nTheir old PIN will stop working immediately.`)) return;
    const { error: err } = await supabase.from("guards").update({ pin }).eq("id", g.id);
    if (err) {
      setError(err.message);
      return;
    }
    setRevealed((r) => new Set(r).add(g.id));
    flash(`${g.full_name}'s new PIN is ${pin}.`);
    await load();
  }

  function toggleReveal(id: string) {
    setRevealed((r) => {
      const n = new Set(r);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  if (loading) {
    return (
      <main className="flex items-center justify-center h-full">
        <p className="font-mono text-text-secondary text-sm">Loading…</p>
      </main>
    );
  }

  const active = guards.filter((g) => g.active);
  const inactive = guards.filter((g) => !g.active);

  const row = (g: Guard) => (
    <div key={g.id} className="flex flex-wrap items-center gap-3 py-3 border-b border-border last:border-b-0">
      <div className="flex-1 min-w-[160px]">
        <div className={`font-bold text-[0.9rem] ${g.active ? "text-text-primary" : "text-text-muted"}`}>{g.full_name}</div>
        <div className="text-text-secondary text-xs">{tierLabel(g.pay_tier)}</div>
      </div>
      <div className="flex items-center gap-1.5 font-mono text-sm text-text-secondary w-[88px]">
        <span>{revealed.has(g.id) ? g.pin : "••••"}</span>
        <button onClick={() => toggleReveal(g.id)} className="text-text-muted hover:text-text-primary" aria-label="Show or hide PIN">
          {revealed.has(g.id) ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => openEdit(g)} className="flex items-center gap-1.5 border border-border rounded-lg px-2.5 py-1.5 text-xs font-bold text-text-primary hover:border-accent transition">
          <Pencil size={13} /> Edit
        </button>
        {g.active && (
          <button onClick={() => resetPin(g)} className="flex items-center gap-1.5 border border-border rounded-lg px-2.5 py-1.5 text-xs font-bold text-text-primary hover:border-accent transition">
            <KeyRound size={13} /> New PIN
          </button>
        )}
        {g.active ? (
          <button onClick={() => setActive(g, false)} className="flex items-center gap-1.5 border border-danger/40 text-danger rounded-lg px-2.5 py-1.5 text-xs font-bold hover:bg-danger/10 transition">
            <UserX size={13} /> Deactivate
          </button>
        ) : (
          <button onClick={() => setActive(g, true)} className="flex items-center gap-1.5 border border-success/40 text-success rounded-lg px-2.5 py-1.5 text-xs font-bold hover:bg-success/10 transition">
            <UserCheck size={13} /> Reactivate
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <Link href="/dashboard/guards" className="inline-flex items-center gap-1.5 text-text-secondary text-sm mb-3 hover:text-text-primary">
        <ArrowLeft size={14} /> Guards
      </Link>

      <div className="flex items-start justify-between gap-3 mb-[18px]">
        <div>
          <h1 className="text-[1.5rem] font-extrabold text-text-primary">Manage guards</h1>
          <p className="text-text-secondary text-sm">Add new guards, change details, or deactivate people who have left.</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 bg-accent text-bg font-bold text-sm rounded-lg px-3.5 py-2 hover:opacity-90 transition flex-none">
          <Plus size={16} /> Add guard
        </button>
      </div>

      {notice && <div className="mb-4 rounded-lg bg-success/15 text-success text-sm px-3.5 py-2.5">{notice}</div>}
      {error && <div className="mb-4 rounded-lg bg-danger/15 text-danger text-sm px-3.5 py-2.5">{error}</div>}

      <div className="bg-surface border border-border rounded-[14px] p-5 shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_18px_rgba(0,0,0,0.35)] animate-fade-up mb-5 max-w-3xl">
        <div className="text-text-muted text-[0.68rem] uppercase tracking-wide mb-1">Active ({active.length})</div>
        {active.length === 0 ? <p className="text-text-secondary text-sm py-3">No active guards.</p> : active.map(row)}
      </div>

      {inactive.length > 0 && (
        <div className="bg-surface border border-border rounded-[14px] p-5 shadow-[0_2px_6px_rgba(0,0,0,0.25),0_8px_18px_rgba(0,0,0,0.35)] animate-fade-up max-w-3xl">
          <div className="text-text-muted text-[0.68rem] uppercase tracking-wide mb-1">Inactive ({inactive.length})</div>
          <p className="text-text-muted text-xs mb-1">Can't clock in. Their records and past pay stay in the system.</p>
          {inactive.map(row)}
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4">
          <form onSubmit={save} className="w-full max-w-sm bg-surface border border-border rounded-[14px] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-text-primary">{form.id ? "Edit guard" : "Add guard"}</h2>
              <button type="button" onClick={() => setForm(null)} className="text-text-muted hover:text-text-primary" aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <label className="block text-sm text-text-secondary mb-1">Full name</label>
            <input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              autoFocus
              className="w-full mb-4 bg-bg border border-border rounded-md px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />

            <label className="block text-sm text-text-secondary mb-1">Pay level</label>
            <select
              value={form.pay_tier}
              onChange={(e) => setForm({ ...form, pay_tier: e.target.value })}
              className="w-full mb-4 bg-bg border border-border rounded-md px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {TIER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>

            <label className="block text-sm text-text-secondary mb-1">4-digit PIN</label>
            <div className="flex gap-2 mb-2">
              <input
                value={form.pin}
                inputMode="numeric"
                maxLength={4}
                onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                className="flex-1 bg-bg border border-border rounded-md px-3 py-2 text-text-primary font-mono tracking-[0.3em] text-center focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="button"
                onClick={() => setForm({ ...form, pin: randomPin(new Set(guards.filter((g) => g.id !== form.id).map((g) => g.pin))) })}
                className="border border-border rounded-md px-3 text-xs font-bold text-text-primary hover:border-accent transition"
              >
                Generate
              </button>
            </div>
            <p className="text-text-muted text-xs mb-4">Every guard needs a different PIN. Tell it to the guard privately.</p>

            {formError && <p className="text-danger text-sm mb-3">{formError}</p>}

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-accent text-bg font-bold text-sm rounded-lg py-2.5 hover:opacity-90 transition disabled:opacity-50"
            >
              {saving ? "Saving…" : form.id ? "Save changes" : "Add guard"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
