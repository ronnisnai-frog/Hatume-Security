import * as XLSX from "xlsx-js-style";

export type GuardLite = { id: string; full_name: string; active?: boolean };
export type SiteLite = { id: string; name: string };
export type ShiftLite = {
  guard_id: string;
  site_id: string;
  shift_date: string;
  scheduled_start: string;
  scheduled_end: string;
};
export type NewShift = ShiftLite;
export type RowError = { rowNum: number; message: string };

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SITE_ORDER = ["ht haus", "boina", "main gate", "long reach", "otees"];
const MAX_DAYS = 90;

/* ---------- small helpers ---------- */

export function pngToday(): string {
  return new Date(Date.now() + 10 * 3600 * 1000).toISOString().slice(0, 10);
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Monday = 0 ... Sunday = 6
export function weekdayIndex(dateStr: string): number {
  return (new Date(`${dateStr}T00:00:00Z`).getUTCDay() + 6) % 7;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function shortName(full: string): string {
  const t = full.replace(/\./g, " ").replace(/\s+/g, " ").trim().split(" ");
  if (t.length < 2) return full.trim();
  return `${t[0]}. ${t[t.length - 1][0].toUpperCase()}`;
}

function hourLabel(h: number, m: number): string {
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${pad(m)}${ampm}` : `${h12}${ampm}`;
}

function pngParts(iso: string) {
  const d = new Date(new Date(iso).getTime() + 10 * 3600 * 1000);
  return { h: d.getUTCHours(), m: d.getUTCMinutes() };
}

export function slotLabel(startIso: string, endIso: string): { label: string; startMin: number } {
  const s = pngParts(startIso);
  const e = pngParts(endIso);
  return { label: `${hourLabel(s.h, s.m)} – ${hourLabel(e.h, e.m)}`, startMin: s.h * 60 + s.m };
}

function isNightStart(startMin: number) {
  return startMin >= 17 * 60 || startMin < 5 * 60;
}

function siteRank(name: string): number {
  const n = name.toLowerCase();
  const i = SITE_ORDER.findIndex((k) => n.includes(k));
  return i === -1 ? 99 : i;
}

function sortSites(sites: SiteLite[]): SiteLite[] {
  return [...sites].sort((a, b) => siteRank(a.name) - siteRank(b.name) || a.name.localeCompare(b.name));
}

/* ---------- building the grid workbook ---------- */

const thin = { style: "thin", color: { rgb: "000000" } };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };

type Slot = { label: string; startMin: number; byDay: string[][] };

export function buildRosterWorkbook(opts: {
  sites: SiteLite[];
  guards: GuardLite[];
  shifts: ShiftLite[] | null; // pattern source (last 7 days of schedule), or null for a blank template
  from: string;
  until: string;
}): XLSX.WorkBook {
  const { sites, guards, shifts, from, until } = opts;
  const guardById = new Map(guards.map((g) => [g.id, g]));

  const slotsBySite = new Map<string, Map<string, Slot>>();
  for (const s of shifts || []) {
    const g = guardById.get(s.guard_id);
    if (!g) continue;
    const { label, startMin } = slotLabel(s.scheduled_start, s.scheduled_end);
    if (!slotsBySite.has(s.site_id)) slotsBySite.set(s.site_id, new Map());
    const m = slotsBySite.get(s.site_id)!;
    if (!m.has(label)) m.set(label, { label, startMin, byDay: [[], [], [], [], [], [], []] });
    m.get(label)!.byDay[weekdayIndex(s.shift_date)].push(shortName(g.full_name));
  }

  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];
  const put = (r: number, c: number, v: string, s?: any, z?: string) => {
    const cell: any = { v, t: "s" };
    if (s) cell.s = s;
    if (z) cell.z = z;
    ws[XLSX.utils.encode_cell({ r, c })] = cell;
  };

  put(0, 0, "HATUME SECURITY SERVICE – GUARD ROSTER", {
    font: { bold: true, sz: 14 },
    alignment: { horizontal: "center" },
  });
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } });

  const label = { font: { italic: true } };
  const dateCell = { font: { bold: true }, border: BORDER, alignment: { horizontal: "center" } };
  put(1, 0, "Effective from (YYYY-MM-DD)", label);
  put(1, 1, from, dateCell, "@");
  put(1, 2, "Until (YYYY-MM-DD)", label);
  put(1, 3, until, dateCell, "@");
  put(2, 0, "This weekly pattern repeats on every matching weekday between the two dates above.", {
    font: { italic: true, color: { rgb: "666666" }, sz: 9 },
  });

  let r = 4;
  for (const site of sortSites(sites)) {
    put(r, 0, site.name, { font: { bold: true, italic: true } });
    r++;
    ["Time", ...DAYS].forEach((h, c) => put(r, c, h, { font: { bold: true }, border: BORDER }));
    r++;

    let slots = Array.from(slotsBySite.get(site.id)?.values() || []).sort((a, b) => a.startMin - b.startMin);
    if (slots.length === 0) {
      slots = [
        { label: "6am – 6pm", startMin: 360, byDay: [[], [], [], [], [], [], []] },
        { label: "6pm – 6am", startMin: 1080, byDay: [[], [], [], [], [], [], []] },
      ];
    }
    for (const slot of slots) {
      const rows = Math.max(1, ...slot.byDay.map((d) => d.length));
      const fill = isNightStart(slot.startMin) ? { fgColor: { rgb: "D9D9D9" } } : undefined;
      for (let i = 0; i < rows; i++) {
        put(r, 0, slot.label, { font: { bold: true }, border: BORDER, fill });
        for (let d = 0; d < 7; d++) put(r, d + 1, slot.byDay[d][i] || "", { border: BORDER, fill });
        r++;
      }
    }
    r++;
  }

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(r, 5), c: 7 } });
  ws["!merges"] = merges;
  ws["!cols"] = [{ wch: 26 }, ...DAYS.map(() => ({ wch: 16 }))];
  (ws as any)["!pageSetup"] = { orientation: "landscape", fitToWidth: 1, fitToHeight: 0 };
  (ws as any)["!sheetPr"] = { pageSetUpPr: { fitToPage: true } };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Roster");

  const ref: { "Active guards": string; Sites: string }[] = [];
  const active = guards.filter((g) => g.active !== false);
  const n = Math.max(active.length, sites.length);
  for (let i = 0; i < n; i++) {
    ref.push({ "Active guards": active[i]?.full_name || "", Sites: sites[i]?.name || "" });
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ref), "Valid Names (reference)");
  return wb;
}

/* ---------- reading the grid back in ---------- */

export function isGridSheet(rows: string[][]): boolean {
  return rows.some((r) => String(r[0] || "").trim().toLowerCase() === "time" && String(r[1] || "").trim().toLowerCase() === "monday");
}

function parseClock(part: string): string | null {
  const m = part.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    if (m[3] === "am") h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else if (h > 23) return null;
  return `${pad(h)}:${pad(min)}`;
}

export function parseSlot(text: string): { start: string; end: string } | null {
  const parts = text.split(/\s*(?:–|—|-|\bto\b)\s*/i);
  if (parts.length !== 2) return null;
  const start = parseClock(parts[0]);
  const end = parseClock(parts[1]);
  return start && end ? { start, end } : null;
}

const norm = (s: string) => s.replace(/\./g, " ").replace(/\s+/g, " ").trim().toLowerCase();

function matchGuard(raw: string, guards: GuardLite[]): { guard?: GuardLite; error?: string } {
  const n = norm(raw);
  const exact = guards.filter((g) => norm(g.full_name) === n);
  if (exact.length === 1) return { guard: exact[0] };
  const t = n.split(" ");
  const first = t[0];
  const initial = t.length > 1 ? t[t.length - 1][0] : "";
  const cands = guards.filter((g) => {
    const gt = norm(g.full_name).split(" ");
    if (gt[0] !== first) return false;
    return initial ? gt[gt.length - 1].startsWith(initial) : true;
  });
  if (cands.length === 1) return { guard: cands[0] };
  if (cands.length > 1) return { error: `"${raw}" matches more than one guard — write the full name.` };
  return { error: `"${raw}" doesn't match any active guard. Add them on the Guards → Manage guards page first.` };
}

function toIso(date: string, hhmm: string): string {
  return new Date(`${date}T${hhmm}:00+10:00`).toISOString();
}

export function parseRosterGrid(
  rows: string[][],
  guards: GuardLite[],
  sites: SiteLite[]
): { shifts: NewShift[]; errors: RowError[]; from: string; until: string } {
  const errors: RowError[] = [];
  const cell = (r: string[], c: number) => String(r[c] ?? "").trim();

  let from = "";
  let until = "";
  for (const r of rows) {
    for (let c = 0; c < r.length; c++) {
      const v = cell(r, c).toLowerCase();
      if (v.startsWith("effective from")) from = cell(r, c + 1);
      if (v.startsWith("until")) until = cell(r, c + 1);
    }
  }
  if (!isValidDate(from)) errors.push({ rowNum: 2, message: `"Effective from" must be a date written as YYYY-MM-DD (found "${from}").` });
  if (!isValidDate(until)) errors.push({ rowNum: 2, message: `"Until" must be a date written as YYYY-MM-DD (found "${until}").` });
  if (errors.length) return { shifts: [], errors, from, until };
  if (until < from) return { shifts: [], errors: [{ rowNum: 2, message: `"Until" is before "Effective from".` }], from, until };
  if ((Date.parse(until) - Date.parse(from)) / 86400000 > MAX_DAYS) {
    return { shifts: [], errors: [{ rowNum: 2, message: `The date range is longer than ${MAX_DAYS} days. Upload it in smaller chunks.` }], from, until };
  }

  type Entry = { site: SiteLite; start: string; end: string; day: number; guard: GuardLite };
  const entries: Entry[] = [];
  let currentSite: SiteLite | null = null;
  let inTable = false;

  rows.forEach((r, i) => {
    const rowNum = i + 1;
    if (i < 3) return;
    const a = cell(r, 0);
    const b = cell(r, 1);

    if (a.toLowerCase() === "time" && b.toLowerCase() === "monday") {
      inTable = true;
      return;
    }
    const hasNames = r.slice(1, 8).some((v) => String(v || "").trim() !== "");

    // A site title row: text in column A, nothing else on the row
    if (a && !hasNames) {
      const found = sites.find((s) => s.name.toLowerCase() === a.toLowerCase());
      if (found) {
        currentSite = found;
        inTable = false;
      } else if (!parseSlot(a)) {
        errors.push({ rowNum, message: `Site name "${a}" doesn't match any site on file.` });
        currentSite = null;
        inTable = false;
      }
      return;
    }
    if (!inTable || !hasNames) return;
    if (!a) {
      errors.push({ rowNum, message: "This row has names but no time in the first column." });
      return;
    }

    if (!currentSite) {
      errors.push({ rowNum, message: "These names aren't under a recognised site heading." });
      return;
    }
    const slot = parseSlot(a);
    if (!slot) {
      errors.push({ rowNum, message: `Time "${a}" should look like "6am – 6pm" or "18:00 - 06:00".` });
      return;
    }
    for (let d = 0; d < 7; d++) {
      const raw = cell(r, d + 1);
      if (!raw || /^(-|x|off|n\/a)$/i.test(raw)) continue;
      const res = matchGuard(raw, guards);
      if (!res.guard) {
        errors.push({ rowNum, message: `${DAYS[d]}: ${res.error}` });
        continue;
      }
      entries.push({ site: currentSite, start: slot.start, end: slot.end, day: d, guard: res.guard });
    }
  });

  if (errors.length === 0 && entries.length === 0) {
    errors.push({ rowNum: 0, message: "No guard names were found in the roster grid." });
  }
  if (errors.length) return { shifts: [], errors, from, until };

  const shifts: NewShift[] = [];
  for (let date = from; date <= until; date = addDays(date, 1)) {
    const wd = weekdayIndex(date);
    for (const e of entries) {
      if (e.day !== wd) continue;
      const start = toIso(date, e.start);
      let end = toIso(date, e.end);
      if (new Date(end) <= new Date(start)) end = new Date(new Date(end).getTime() + 86400000).toISOString();
      shifts.push({ guard_id: e.guard.id, site_id: e.site.id, shift_date: date, scheduled_start: start, scheduled_end: end });
    }
  }
  return { shifts, errors, from, until };
}
