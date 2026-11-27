import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';

export type DateRangePreset = 'today' | '7d' | 'month' | 'lastMonth' | 'all' | 'custom';

const PRESETS: { key: Exclude<DateRangePreset, 'custom'>; label: string }[] = [
  { key: 'today', label: 'Hôm nay' },
  { key: '7d', label: '7 ngày' },
  { key: 'month', label: 'Tháng này' },
  { key: 'lastMonth', label: 'Tháng trước' },
  { key: 'all', label: 'Tất cả' },
];

export function presetToRange(p: DateRangePreset): { from: string; to: string } {
  const t = dayjs();
  switch (p) {
    case 'today':
      return { from: t.format('YYYY-MM-DD'), to: t.format('YYYY-MM-DD') };
    case '7d':
      return { from: t.subtract(6, 'day').format('YYYY-MM-DD'), to: t.format('YYYY-MM-DD') };
    case 'month':
      return { from: t.startOf('month').format('YYYY-MM-DD'), to: t.format('YYYY-MM-DD') };
    case 'lastMonth': {
      const l = t.subtract(1, 'month');
      return { from: l.startOf('month').format('YYYY-MM-DD'), to: l.endOf('month').format('YYYY-MM-DD') };
    }
    default:
      return { from: '', to: '' };
  }
}

/** Ngày về dạng YYYY-MM-DD (chấp nhận dd/mm/yyyy, YYYY-MM-DD, ISO) */
export function toYMD(d?: string): string {
  if (!d) return '';
  const s = String(d).trim();
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s.slice(0, 10);
}

/** Bộ lọc khoảng ngày dùng chung (mặc định 7 ngày gần nhất) */
export function useDateRange(initial: DateRangePreset = '7d') {
  const [preset, setPreset] = useState<DateRangePreset>(initial);
  const [range, setRange] = useState(() => presetToRange(initial));
  return useMemo(() => {
    const inRange = (d?: string) => {
      const v = toYMD(d);
      if (range.from && v < range.from) return false;
      if (range.to && v > range.to) return false;
      return true;
    };
    /** Tới hết ngày cuối kỳ (dùng tính số dư / công nợ tại cuối kỳ) */
    const upToEnd = (d?: string) => !range.to || toYMD(d) <= range.to;
    const label =
      !range.from && !range.to
        ? 'Tất cả thời gian'
        : `${range.from ? dayjs(range.from).format('DD/MM/YYYY') : '...'} – ${range.to ? dayjs(range.to).format('DD/MM/YYYY') : '...'}`;
    return {
      preset,
      range,
      label,
      inRange,
      upToEnd,
      choose: (p: DateRangePreset) => {
        setPreset(p);
        setRange(presetToRange(p));
      },
      setFrom: (from: string) => {
        setPreset('custom');
        setRange((r) => ({ ...r, from }));
      },
      setTo: (to: string) => {
        setPreset('custom');
        setRange((r) => ({ ...r, to }));
      },
    };
  }, [preset, range]);
}

export type DateRangeState = ReturnType<typeof useDateRange>;

export function DateRangeBar({ state, note }: { state: DateRangeState; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-2.5 flex flex-wrap items-center gap-2 text-xs">
      <CalendarDays size={15} className="text-muted-foreground" />
      {PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => state.choose(p.key)}
          className={`px-2.5 py-1 rounded-lg font-semibold border transition-colors ${
            state.preset === p.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted border-border'
          }`}
        >
          {p.label}
        </button>
      ))}
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Từ</span>
        <input
          type="date"
          value={state.range.from}
          onChange={(e) => state.setFrom(e.target.value)}
          className="h-7 rounded-lg border border-border bg-background px-2 text-xs"
        />
        <span className="text-muted-foreground">đến</span>
        <input
          type="date"
          value={state.range.to}
          onChange={(e) => state.setTo(e.target.value)}
          className="h-7 rounded-lg border border-border bg-background px-2 text-xs"
        />
      </div>
      <span className="text-muted-foreground ml-auto">{note || state.label}</span>
    </div>
  );
}
