import dayjs from 'dayjs';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Receipt, Store } from 'lucide-react';
import { removeVietnameseTones } from '@/components/ui/PartnerAutocomplete';
import {
    getOrderTotal,
  useDebtStore,
  useDistributorStore,
  useOrderStore,
} from '@/stores/hoaKhangThanhStore';

const fmt = (n: number) => Math.round(n || 0).toLocaleString('vi-VN');
const fmtVND = (n: number) => `${fmt(n)} đ`;
const CANCELLED = new Set(['cancelled', 'huy']);

/** Ngày về dạng YYYY-MM-DD (chấp nhận cả dd/mm/yyyy) */
function ymd(d?: string): string {
  if (!d) return '';
  const s = d.trim();
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s.slice(0, 10);
}
const norm = (v?: string) => (v || '').trim().toLowerCase();
const isThu = (r: { type?: string; decreaseAmount?: number; increaseAmount?: number }) =>
  r.type === 'thu' || ((r.decreaseAmount || 0) > 0 && (r.increaseAmount || 0) === 0);

interface Props {
  range: { from: string; to: string };
  nppName: string;
  search: string;
  groupBy: 'day' | 'month';
  rangeLabel: string;
}

/**
 * Dashboard NPP: công nợ từng NPP (hiện tại) + phát sinh bán / thu trong kỳ lọc.
 * - Công nợ cuối: tính trên toàn bộ dữ liệu (giống trang Danh sách NPP / Công nợ NPP).
 * - Bán / Thu trong kỳ: chỉ tính trong khoảng ngày đang lọc ở Dashboard.
 */
export function NppDebtSection({ range, nppName, search, groupBy, rangeLabel }: Props) {
  const navigate = useNavigate();
  const orders = useOrderStore((s) => s.orders);
  const debtRecords = useDebtStore((s) => s.records);
  const distributors = useDistributorStore((s) => s.distributors);

  const data = useMemo(() => {
    // Gom sổ công nợ & đơn hàng theo NPP (cùng cách ghép với trang Công nợ NPP: id / mã / tên)
    const byId = new Map<string, number>();
    const byCode = new Map<string, number>();
    const byName = new Map<string, number>();
    distributors.forEach((d, i) => {
      byId.set(d.id, i);
      if (d.code && !byCode.has(d.code)) byCode.set(d.code, i);
      if (norm(d.name) && !byName.has(norm(d.name))) byName.set(norm(d.name), i);
    });
    const recs: (typeof debtRecords)[] = distributors.map(() => []);
    const ords: (typeof orders)[] = distributors.map(() => []);
    for (const r of debtRecords) {
      if (r.partnerType !== 'npp') continue;
      const hit = new Set<number>();
      if (r.partnerId && byId.has(r.partnerId)) hit.add(byId.get(r.partnerId)!);
      if (r.partnerCode && byCode.has(r.partnerCode)) hit.add(byCode.get(r.partnerCode)!);
      const n = byName.get(norm(r.partnerName));
      if (n !== undefined) hit.add(n);
      hit.forEach((i) => recs[i].push(r));
    }
    for (const o of orders) {
      const hit = new Set<number>();
      if (o.distributorId && byId.has(o.distributorId)) hit.add(byId.get(o.distributorId)!);
      const n = byName.get(norm(o.distributorName));
      if (n !== undefined) hit.add(n);
      hit.forEach((i) => ords[i].push(o));
    }

    const from = range.from;
    const to = range.to;
    const keyOf = (d: string) => (groupBy === 'day' ? d : d.slice(0, 7));
    const nppFilter = norm(nppName);
    const q = removeVietnameseTones(search.trim());

    type Move = { day: string; inc: number; dec: number };
    const periodMap = new Map<string, { key: string; sale: number; thu: number }>();
    const rows: {
      id: string;
      code: string;
      name: string;
      openDebt: number;
      sale: number;
      thu: number;
      closeDebt: number;
      lastOrder: string;
      lastPay: string;
      moves: Move[];
    }[] = [];

    distributors.forEach((d, i) => {
      // Phát sinh của NPP: dòng sổ công nợ + đơn hàng chưa ghi sổ (giống calculateDistributorFinancials)
      const moves: Move[] = [];
      const recorded = new Set<string>();
      let lastPay = '';
      for (const r of recs[i]) {
        const thu = isThu(r);
        const inc = r.increaseAmount !== undefined ? r.increaseAmount : !thu ? r.amount || 0 : 0;
        const dec = r.decreaseAmount !== undefined ? r.decreaseAmount : thu ? r.amount || 0 : 0;
        const day = ymd(r.date);
        moves.push({ day, inc, dec });
        if (dec > 0 && day > lastPay) lastPay = day;
        if (r.referenceCode) recorded.add(r.referenceCode);
        if (r.id && r.id.startsWith('debt-dh-')) recorded.add(r.id.replace('debt-dh-', ''));
      }
      let lastOrder = '';
      for (const o of ords[i]) {
        if (CANCELLED.has(o.status)) continue;
        const day = ymd(o.orderDate);
        if (day > lastOrder) lastOrder = day;
        const isRecorded = (o.code && recorded.has(o.code)) || recorded.has(o.id);
        if (isRecorded) continue;
        moves.push({ day, inc: getOrderTotal(o), dec: o.paidAmount || 0 });
      }

      // Đầu kỳ = công nợ cũ + phát sinh trước ngày bắt đầu lọc; cuối kỳ = đầu kỳ + phát sinh trong kỳ
      let openDebt = d.oldDebt || 0;
      let sale = 0;
      let thuAmt = 0;
      for (const m of moves) {
        if (from && m.day < from) openDebt += m.inc - m.dec;
        else if (!to || m.day <= to) {
          sale += m.inc;
          thuAmt += m.dec;
        }
      }
      rows.push({
        id: d.id,
        code: d.code,
        name: d.name,
        openDebt,
        sale,
        thu: thuAmt,
        closeDebt: openDebt + sale - thuAmt,
        lastOrder,
        lastPay,
        moves,
      });
    });

    const shown = rows
      .filter((r) => !nppFilter || norm(r.name) === nppFilter)
      .filter((r) => !q || removeVietnameseTones(`${r.code} ${r.name}`).includes(q))
      .filter((r) => r.closeDebt !== 0 || r.sale !== 0 || r.thu !== 0)
      .sort((a, b) => b.closeDebt - a.closeDebt);

    // Bảng theo ngày / tháng: cùng các NPP đang hiện, chỉ phát sinh trong kỳ
    for (const r of shown) {
      for (const m of r.moves) {
        if (!m.day || (from && m.day < from) || (to && m.day > to)) continue;
        const k = keyOf(m.day);
        let b = periodMap.get(k);
        if (!b) {
          b = { key: k, sale: 0, thu: 0 };
          periodMap.set(k, b);
        }
        b.sale += m.inc;
        b.thu += m.dec;
      }
    }
    const periods = Array.from(periodMap.values())
      .filter((p) => p.sale !== 0 || p.thu !== 0)
      .sort((a, b) => (a.key < b.key ? 1 : -1));

    const sum = shown.reduce(
      (s, r) => ({
        open: s.open + r.openDebt,
        debt: s.debt + r.closeDebt,
        owing: s.owing + (r.closeDebt > 0 ? 1 : 0),
        sale: s.sale + r.sale,
        thu: s.thu + r.thu,
      }),
      { open: 0, debt: 0, owing: 0, sale: 0, thu: 0 },
    );
    const periodSum = periods.reduce((a, p) => ({ sale: a.sale + p.sale, thu: a.thu + p.thu }), { sale: 0, thu: 0 });
    return { rows: shown, periods, sum, periodSum };
  }, [orders, debtRecords, distributors, range, nppName, search, groupBy]);

  const today = dayjs().format('YYYY-MM-DD');
  const daysAgo = (d: string) => (d ? dayjs(today).diff(dayjs(d), 'day') : null);
  const periodLabel = (k: string) =>
    groupBy === 'day' ? dayjs(k).format('DD/MM/YYYY') : `Tháng ${k.slice(5, 7)}/${k.slice(0, 4)}`;

  const cards = [
    { label: 'Tổng công nợ NPP cuối kỳ', value: fmtVND(data.sum.debt), icon: Receipt, cls: 'bg-rose-500/10 text-rose-600' },
    { label: 'NPP còn nợ cuối kỳ', value: `${fmt(data.sum.owing)} NPP`, icon: AlertTriangle, cls: 'bg-amber-500/10 text-amber-600' },
    { label: 'Tiền bán NPP trong kỳ (+)', value: fmtVND(data.sum.sale), icon: ArrowUpRight, cls: 'bg-blue-500/10 text-blue-600' },
    { label: 'Tiền thu nợ NPP trong kỳ (−)', value: fmtVND(data.sum.thu), icon: ArrowDownLeft, cls: 'bg-emerald-500/10 text-emerald-600' },
  ];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Store size={18} className="text-purple-600" /> Công nợ Nhà phân phối
        </h2>
        <span className="text-xs text-muted-foreground">Bán / thu theo kỳ lọc: {rangeLabel}</span>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
              <div className={`p-2 rounded-xl ${c.cls}`}>
                <c.icon size={18} />
              </div>
            </div>
            <div className="mt-2 text-lg md:text-xl font-bold tracking-tight text-foreground">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-5 gap-4">
        {/* Bảng công nợ theo NPP */}
        <div className="2xl:col-span-3 rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-2 p-4 border-b border-border">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Công nợ theo từng NPP</h3>
              <p className="text-xs text-muted-foreground">Đầu kỳ + Bán − Thu = Cuối kỳ (theo khoảng ngày lọc) • nợ nhiều nhất ở trên</p>
            </div>
            <span className="text-xs text-muted-foreground">{fmt(data.rows.length)} NPP</span>
          </div>
          <div className="overflow-auto max-h-[460px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/90 backdrop-blur text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">NPP</th>
                  <th className="text-right px-3 py-2 font-semibold">Công nợ đầu kỳ</th>
                  <th className="text-right px-3 py-2 font-semibold">Bán trong kỳ</th>
                  <th className="text-right px-3 py-2 font-semibold">Thu trong kỳ</th>
                  <th className="text-right px-3 py-2 font-semibold">Công nợ cuối kỳ</th>
                  <th className="text-right px-3 py-2 font-semibold">Đơn gần nhất</th>
                  <th className="text-right px-3 py-2 font-semibold">Trả gần nhất</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center text-muted-foreground py-10 text-sm">
                      Không có NPP nào trong bộ lọc này
                    </td>
                  </tr>
                )}
                {data.rows.map((r) => {
                  const oDays = daysAgo(r.lastOrder);
                  const pDays = daysAgo(r.lastPay);
                  return (
                    <tr key={r.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => navigate('/cong-no')}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground truncate max-w-[220px]">{r.name}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">{r.code}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(r.openDebt)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-blue-600">{r.sale ? fmt(r.sale) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{r.thu ? fmt(r.thu) : '—'}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-bold ${r.closeDebt > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {fmt(r.closeDebt)}
                      </td>
                      <td className={`px-3 py-2 text-right text-xs whitespace-nowrap ${oDays !== null && oDays > 10 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                        {r.lastOrder ? `${dayjs(r.lastOrder).format('DD/MM')} (${oDays} ngày)` : '—'}
                      </td>
                      <td className={`px-3 py-2 text-right text-xs whitespace-nowrap ${pDays !== null && pDays > 10 && r.closeDebt > 0 ? 'text-rose-600 font-semibold' : 'text-muted-foreground'}`}>
                        {r.lastPay ? `${dayjs(r.lastPay).format('DD/MM')} (${pDays} ngày)` : r.closeDebt > 0 ? 'Chưa trả' : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {data.rows.length > 0 && (
                <tfoot className="sticky bottom-0 bg-muted/90 backdrop-blur font-bold text-sm">
                  <tr>
                    <td className="px-3 py-2">Tổng ({fmt(data.rows.length)} NPP)</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(data.sum.open)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-blue-600">{fmt(data.sum.sale)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{fmt(data.sum.thu)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-rose-600">{fmt(data.sum.debt)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Bảng phát sinh công nợ NPP theo ngày / tháng */}
        <div className="2xl:col-span-2 rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">
              Phát sinh công nợ NPP theo {groupBy === 'day' ? 'ngày' : 'tháng'}
            </h3>
            <p className="text-xs text-muted-foreground">Bán (+) − Thu (−) = Nợ tăng / giảm trong {groupBy === 'day' ? 'ngày' : 'tháng'}</p>
          </div>
          <div className="overflow-auto max-h-[460px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/90 backdrop-blur text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">{groupBy === 'day' ? 'Ngày' : 'Tháng'}</th>
                  <th className="text-right px-3 py-2 font-semibold">Bán (+)</th>
                  <th className="text-right px-3 py-2 font-semibold">Thu (−)</th>
                  <th className="text-right px-3 py-2 font-semibold">Nợ tăng / giảm</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.periods.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center text-muted-foreground py-10 text-sm">
                      Không có phát sinh trong bộ lọc này
                    </td>
                  </tr>
                )}
                {data.periods.map((p) => {
                  const net = p.sale - p.thu;
                  return (
                    <tr key={p.key} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{periodLabel(p.key)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-blue-600">{p.sale ? fmt(p.sale) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{p.thu ? fmt(p.thu) : '—'}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-bold ${net > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {net > 0 ? '+' : ''}
                        {fmt(net)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {data.periods.length > 0 && (
                <tfoot className="sticky bottom-0 bg-muted/90 backdrop-blur font-bold text-sm">
                  <tr>
                    <td className="px-3 py-2">Tổng</td>
                    <td className="px-3 py-2 text-right tabular-nums text-blue-600">{fmt(data.periodSum.sale)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{fmt(data.periodSum.thu)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${data.periodSum.sale - data.periodSum.thu > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {data.periodSum.sale - data.periodSum.thu > 0 ? '+' : ''}
                      {fmt(data.periodSum.sale - data.periodSum.thu)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
