/**
 * India retail-relevant festival / holiday dates for dashboard alerts.
 * Fixed dates use YYYY-MM-DD; recurring use MM-DD (every year).
 */

export type FestivalDef = {
  name: string;
  /** Fixed calendar date YYYY-MM-DD or recurring MM-DD */
  date: string;
  kind?: 'festival' | 'national' | 'retail';
};

const FESTIVALS: FestivalDef[] = [
  { name: 'Republic Day', date: '01-26', kind: 'national' },
  { name: 'Valentine\'s Day', date: '02-14', kind: 'retail' },
  { name: 'Holi', date: '2026-03-03', kind: 'festival' },
  { name: 'Ugadi / Gudi Padwa', date: '2026-03-19', kind: 'festival' },
  { name: 'Good Friday', date: '2026-04-03', kind: 'festival' },
  { name: 'Ramzan / Eid', date: '2026-03-20', kind: 'festival' },
  { name: 'Labour Day', date: '05-01', kind: 'national' },
  { name: 'Mother\'s Day', date: '2026-05-10', kind: 'retail' },
  { name: 'Independence Day', date: '08-15', kind: 'national' },
  { name: 'Raksha Bandhan', date: '2026-08-28', kind: 'festival' },
  { name: 'Onam', date: '2026-08-26', kind: 'festival' },
  { name: 'Teacher\'s Day', date: '09-05', kind: 'retail' },
  { name: 'Ganesh Chaturthi', date: '2026-09-14', kind: 'festival' },
  { name: 'Gandhi Jayanti', date: '10-02', kind: 'national' },
  { name: 'Dussehra', date: '2026-10-20', kind: 'festival' },
  { name: 'Diwali', date: '2026-11-08', kind: 'festival' },
  { name: 'Govardhan Puja', date: '2026-11-09', kind: 'festival' },
  { name: 'Bhai Dooj', date: '2026-11-10', kind: 'festival' },
  { name: 'Children\'s Day', date: '11-14', kind: 'retail' },
  { name: 'Christmas', date: '12-25', kind: 'festival' },
  { name: 'New Year\'s Eve', date: '12-31', kind: 'retail' },
];

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function resolveFestivalDate(raw: string, year: number): Date | null {
  const value = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  if (/^\d{2}-\d{2}$/.test(value)) {
    const [m, d] = value.split('-').map(Number);
    return new Date(year, m - 1, d);
  }
  return null;
}

/** Upcoming festivals within the next `withinDays` (includes today). */
export function upcomingFestivals(withinDays = 45, limit = 8) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const year = today.getFullYear();
  const end = new Date(today);
  end.setDate(end.getDate() + withinDays);

  const rows: {
    name: string;
    date: string;
    date_label: string;
    days_until: number;
    kind: string;
  }[] = [];

  for (const f of FESTIVALS) {
    const candidates = [
      resolveFestivalDate(f.date, year),
      /^\d{2}-\d{2}$/.test(f.date) ? resolveFestivalDate(f.date, year + 1) : null,
    ].filter(Boolean) as Date[];

    for (const d of candidates) {
      if (d < today || d > end) continue;
      const days = Math.round((d.getTime() - today.getTime()) / 86400000);
      rows.push({
        name: f.name,
        date: toDateKey(d),
        date_label: d.toLocaleDateString('en-IN', {
          weekday: 'short',
          day: '2-digit',
          month: 'short',
        }),
        days_until: days,
        kind: f.kind || 'festival',
      });
    }
  }

  rows.sort((a, b) => a.days_until - b.days_until || a.name.localeCompare(b.name));
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.name}|${r.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

export { FESTIVALS };
