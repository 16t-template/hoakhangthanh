import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Boxes,
  CalendarDays,
  CircleDollarSign,
  Coins,
  CreditCard,
  Flower2,
  MinusCircle,
  PackagePlus,
  Plus,
  Search,
  Store,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/Button';
import { PartnerAutocomplete, removeVietnameseTones } from '@/components/ui/PartnerAutocomplete';
import {
  calculateSupplierFinancials,
  useCashStore,
  useDebtStore,
  useDistributorStore,
  useEmployeeStore,
  useFlowerStore,
  useInventoryStore,
  useOrderStore,
  useSupplierOrderStore,
  useSupplierStore,
} from '@/stores/hoaKhangThanhStore';
import type { Order, SupplierOrder } from '@/types/hoaKhangThanh';

type Preset = 'today' | '7d' | 'month' | 'lastMonth' | 'year' | 'all' | 'custom';
type GroupBy = 'day' | 'month';

const CANCELLED = new Set(['cancelled', 'huy']);

const fmt = (n: number) => Math.round(n || 0).toLocaleString('vi-VN');
const fmtVND = (n: number) => `${fmt(n)} đ`;

/** Ngày đơn về dạng YYYY-MM-DD (chấp nhận cả dd/mm/yyyy) */
function ymd(d?: string): string {
  if (!d) return '';
  const s = d.trim();
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s.slice(0, 10);
}

function presetRange(p: Preset): { from: string; to: string } {
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
    case 'year':
      return { from: t.startOf('year').format('YYYY-MM-DD'), to: t.format('YYYY-MM-DD') };
    default:
      return { from: '', to: '' };
  }
}

/** Số liệu tiền của 1 đơn bán */
function saleFigures(o: Order) {
  const items = o.items || [];
  const itemsSale = items.reduce((s, i) => s + (i.amount ?? (i.quantity || 0) * (i.unitPrice || 0)), 0);
  const sale = itemsSale > 0 ? itemsSale : o.itemsSubtotal || 0;
  const cost = items.reduce((s, i) => s + (i.importTotal ?? (i.quantity || 0) * (i.costPrice || 0)), 0);
  const shipping = o.shippingFee || 0;
  const discount = o.discount || 0;
  return { sale, cost, shipping, discount, profit: sale - cost - discount };
}

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Hôm nay' },
  { key: '7d', label: '7 ngày' },
  { key: 'month', label: 'Tháng này' },
  { key: 'lastMonth', label: 'Tháng trước' },
  { key: 'year', label: 'Năm nay' },
  { key: 'all', label: 'Tất cả' },
];

export default function DashboardPage() {
  const navigate = useNavigate();
  const orders = useOrderStore((s) => s.orders);
  const supplierOrders = useSupplierOrderStore((s) => s.orders);
  const employees = useEmployeeStore((s) => s.employees);
  const flowers = useFlowerStore((s) => s.flowers);
  const distributors = useDistributorStore((s) => s.distributors);
  const suppliers = useSupplierStore((s) => s.suppliers);
  const inventory = useInventoryStore((s) => s.inventory);
  const transactions = useCashStore((s) => s.transactions);
  const debtRecords = useDebtStore((s) => s.records);

  // ---------- Bộ lọc ----------
  const [preset, setPreset] = useState<Preset>('month');
  const [range, setRange] = useState(() => presetRange('month'));
  const [nppName, setNppName] = useState('');
  const [nccName, setNccName] = useState('');
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('day');

  const choosePreset = (p: Preset) => {
    setPreset(p);
    setRange(presetRange(p));
  };
  const hasFilter = preset !== 'all' || nppName || nccName || search;
  const resetFilters = () => {
    choosePreset('all');
    setNppName('');
    setNccName('');
    setSearch('');
  };

  const nppOptions = useMemo(
    () => distributors.map((d) => ({ id: d.id, name: d.name, code: d.code, phone: d.phone })),
    [distributors],
  );
  const nccOptions = useMemo(
    () => suppliers.map((s) => ({ id: s.id, name: s.name, code: s.code, phone: s.phone })),
    [suppliers],
  );

  const inRange = (d?: string) => {
    const v = ymd(d);
    if (range.from && v < range.from) return false;
    if (range.to && v > range.to) return false;
    return true;
  };
  const q = removeVietnameseTones(search.trim());
  const matches = (...parts: (string | undefined)[]) =>
    !q || parts.some((p) => p && removeVietnameseTones(p).includes(q));

  // Đơn bán theo lọc (ngày + NPP + tìm kiếm)
  const filteredOrders = useMemo(() => {
    const npp = nppName.trim().toLowerCase();
    return orders.filter((o) => {
      if (CANCELLED.has(o.status)) return false;
      if (!inRange(o.orderDate)) return false;
      if (npp && (o.distributorName || '').trim().toLowerCase() !== npp) return false;
      return matches(
        o.code,
        o.distributorName,
        o.notes,
        ...(o.items || []).flatMap((i) => [i.flowerCode, i.flowerName]),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, range, nppName, q]);

  // Đơn nhập NCC theo lọc (ngày + NCC + tìm kiếm)
  const filteredPurchases = useMemo(() => {
    const ncc = nccName.trim().toLowerCase();
    return supplierOrders.filter((o: SupplierOrder) => {
      if (o.status === 'huy') return false;
      if (!inRange(o.orderDate)) return false;
      if (ncc && (o.supplierName || '').trim().toLowerCase() !== ncc) return false;
      return matches(o.code, o.supplierName, o.notes, ...(o.items || []).flatMap((i) => [i.flowerCode, i.flowerName]));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierOrders, range, nccName, q]);

  // ---------- Các ô tổng ----------
  const totals = useMemo(() => {
    const t = { sale: 0, cost: 0, shipping: 0, discount: 0, revenue: 0, profit: 0, orders: filteredOrders.length, qty: 0, purchase: 0, purchaseCount: filteredPurchases.length };
    for (const o of filteredOrders) {
      const f = saleFigures(o);
      t.sale += f.sale;
      t.cost += f.cost;
      t.shipping += f.shipping;
      t.discount += f.discount;
      t.profit += f.profit;
      t.qty += (o.items || []).reduce((s, i) => s + (i.quantity || 0), 0);
    }
    t.revenue = t.sale + t.shipping - t.discount;
    for (const p of filteredPurchases) t.purchase += p.totalAmount || 0;
    return t;
  }, [filteredOrders, filteredPurchases]);

  // ---------- Bảng lợi nhuận theo ngày / tháng ----------
  const profitRows = useMemo(() => {
    const map = new Map<string, { key: string; orders: number; sale: number; cost: number; discount: number; shipping: number; revenue: number; profit: number; purchase: number }>();
    const row = (key: string) => {
      let r = map.get(key);
      if (!r) {
        r = { key, orders: 0, sale: 0, cost: 0, discount: 0, shipping: 0, revenue: 0, profit: 0, purchase: 0 };
        map.set(key, r);
      }
      return r;
    };
    const keyOf = (d?: string) => (groupBy === 'day' ? ymd(d) : ymd(d).slice(0, 7));
    for (const o of filteredOrders) {
      const k = keyOf(o.orderDate);
      if (!k) continue;
      const f = saleFigures(o);
      const r = row(k);
      r.orders += 1;
      r.sale += f.sale;
      r.cost += f.cost;
      r.discount += f.discount;
      r.shipping += f.shipping;
      r.revenue += f.sale + f.shipping - f.discount;
      r.profit += f.profit;
    }
    for (const p of filteredPurchases) {
      const k = keyOf(p.orderDate);
      if (k) row(k).purchase += p.totalAmount || 0;
    }
    return Array.from(map.values()).sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [filteredOrders, filteredPurchases, groupBy]);

  const labelOf = (key: string) =>
    groupBy === 'day' ? dayjs(key).format('DD/MM/YYYY') : `Tháng ${key.slice(5, 7)}/${key.slice(0, 4)}`;

  const chartData = useMemo(
    () =>
      profitRows
        .slice(0, groupBy === 'day' ? 31 : 12)
        .reverse()
        .map((r) => ({
          label: groupBy === 'day' ? dayjs(r.key).format('DD/MM') : `${r.key.slice(5, 7)}/${r.key.slice(2, 4)}`,
          'Tiền bán': r.sale,
          'Lợi nhuận': r.profit,
        })),
    [profitRows, groupBy],
  );

  // ---------- Phần tổng quan cũ & Công nợ NCC ----------
  const supplierDebtSummary = useMemo(() => {
    let totalImport = 0;
    let totalPaid = 0;
    let totalDebt = 0;
    let countWithDebt = 0;
    for (const s of suppliers) {
      const fin = calculateSupplierFinancials(s, debtRecords, supplierOrders);
      totalImport += fin.importAmount || 0;
      totalPaid += fin.paidAmount || 0;
      const d = fin.finalDebt ?? fin.totalDebt ?? 0;
      totalDebt += d;
      if (d > 0) countWithDebt++;
    }
    return { totalImport, totalPaid, totalDebt, countWithDebt };
  }, [suppliers, debtRecords, supplierOrders]);

  // Tiền mua NCC và Trả NCC tính chuẩn xác THEO BỘ LỌC (ngày + nhà cung cấp + tìm kiếm)
  const filteredPurchasesSummary = useMemo(() => {
    // 1. Tiền mua NCC theo bộ lọc
    const buyAmount = filteredPurchases.reduce((s, p) => s + (p.totalAmount || 0), 0);

    // 2. Tiền trả NCC theo bộ lọc (bao gồm thanh toán trên đơn nhập & phiếu chi trả nợ NCC)
    const recordedCodes = new Set<string>();
    let paidAmount = 0;
    for (const p of filteredPurchases) {
      paidAmount += p.paidAmount || 0;
      if (p.code) recordedCodes.add(p.code);
      if (p.id) recordedCodes.add(p.id);
    }

    const ncc = nccName.trim().toLowerCase();
    for (const r of debtRecords) {
      if (r.partnerType !== 'ncc') continue;
      if (!inRange(r.date)) continue;
      if (ncc && (r.partnerName || '').trim().toLowerCase() !== ncc) continue;
      const ref = r.referenceCode || (r.id?.startsWith('debt-ncc-') ? r.id.replace('debt-ncc-', '') : '');
      if (ref && recordedCodes.has(ref)) continue;

      const isThu = r.type === 'thu' || ((r.decreaseAmount || 0) > 0 && (r.increaseAmount || 0) === 0);
      const dec = r.decreaseAmount !== undefined ? r.decreaseAmount : (isThu ? (r.amount || 0) : 0);
      paidAmount += dec;
    }

    return { buyAmount, paidAmount };
  }, [filteredPurchases, debtRecords, range, nccName]);

  const lowStockCount = useMemo(() => inventory.filter((i) => i.currentStock <= i.minStock && i.minStock > 0).length, [inventory]);
  const cashSummary = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of transactions) {
      if (!inRange(t.date)) continue;
      if (t.type === 'income') income += t.amount;
      else expense += t.amount;
    }
    return { income, expense, balance: income - expense };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, range]);

  const rangeLabel =
    preset === 'all' || (!range.from && !range.to)
      ? 'Tất cả thời gian'
      : `${range.from ? dayjs(range.from).format('DD/MM/YYYY') : '...'} – ${range.to ? dayjs(range.to).format('DD/MM/YYYY') : '...'}`;

  const margin = totals.sale > 0 ? (totals.profit / totals.sale) * 100 : 0;

  const kpis = [
    { label: 'Tổng tiền bán', value: totals.sale, icon: TrendingUp, cls: 'bg-emerald-500/10 text-emerald-600', sub: `${fmt(totals.orders)} đơn • ${fmt(totals.qty)} cành/bó` },
    { label: 'Tiền cước xe', value: totals.shipping, icon: Truck, cls: 'bg-amber-500/10 text-amber-600', sub: 'Thu thêm theo đơn' },
    { label: 'Tiền trừ hàng', value: totals.discount, icon: MinusCircle, cls: 'bg-rose-500/10 text-rose-600', sub: 'Khoản trừ cho khách' },
    { label: 'Doanh thu', value: totals.revenue, icon: CircleDollarSign, cls: 'bg-teal-500/10 text-teal-600', sub: 'Tiền bán + cước xe − trừ hàng' },
    { label: 'Tiền nhập (giá vốn hoa đã bán)', value: totals.cost, icon: PackagePlus, cls: 'bg-sky-500/10 text-sky-600', sub: `Đơn nhập NCC: ${fmtVND(totals.purchase)} (${fmt(totals.purchaseCount)} đơn)` },
    { label: 'Lợi nhuận', value: totals.profit, icon: Coins, cls: 'bg-violet-500/10 text-violet-600', sub: `Bán − vốn − trừ hàng • ${margin.toFixed(1)}%` },
  ];

  return (
    <div className="p-3 md:p-5 space-y-5 w-full">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4 rounded-2xl border border-primary/15 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Flower2 size={22} />
          </span>
          <div>
            <h1 className="text-lg md:text-xl font-bold tracking-tight text-foreground">Tổng quan kinh doanh</h1>
            <p className="text-xs text-muted-foreground">Số liệu theo bộ lọc: {rangeLabel}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => navigate('/don-hang')} className="gap-1.5">
            <Plus size={16} /> Tạo đơn mới
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/don-hang-ncc')} className="gap-1.5 bg-card">
            <PackagePlus size={16} /> Đơn nhập NCC
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/thu-chi')} className="gap-1.5 bg-card">
            <Wallet size={16} /> Thu chi
          </Button>
        </div>
      </div>

      {/* Bộ lọc */}
      <div className="rounded-2xl border border-border bg-card p-3 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarDays size={16} className="text-muted-foreground" />
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => choosePreset(p.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                preset === p.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted border-border'
              }`}
            >
              {p.label}
            </button>
          ))}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Từ</span>
            <input
              type="date"
              value={range.from}
              onChange={(e) => {
                setPreset('custom');
                setRange((r) => ({ ...r, from: e.target.value }));
              }}
              className="h-8 rounded-lg border border-border bg-background px-2 text-xs"
            />
            <span className="text-muted-foreground">đến</span>
            <input
              type="date"
              value={range.to}
              onChange={(e) => {
                setPreset('custom');
                setRange((r) => ({ ...r, to: e.target.value }));
              }}
              className="h-8 rounded-lg border border-border bg-background px-2 text-xs"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm mã đơn, khách hàng, NCC, mã/tên hoa..."
              className="w-full h-9 rounded-lg border border-border bg-background pl-8 pr-8 text-sm"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X size={14} />
              </button>
            )}
          </div>
          <PartnerAutocomplete
            value={nppName}
            options={nppOptions}
            allowCustom={false}
            placeholder="Lọc theo NPP / khách hàng..."
            onChange={(p) => setNppName(p.name || '')}
            inputClassName="h-9 text-sm"
          />
          <PartnerAutocomplete
            value={nccName}
            options={nccOptions}
            allowCustom={false}
            placeholder="Lọc theo NCC / nhà vườn..."
            onChange={(p) => setNccName(p.name || '')}
            inputClassName="h-9 text-sm"
          />
        </div>
        {hasFilter && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {fmt(totals.orders)} đơn bán • {fmt(totals.purchaseCount)} đơn nhập NCC
              {nppName && <> • NPP: <b className="text-foreground">{nppName}</b></>}
              {nccName && <> • NCC: <b className="text-foreground">{nccName}</b></>}
            </span>
            <button type="button" onClick={resetFilters} className="text-primary hover:underline font-medium">
              Xoá bộ lọc
            </button>
          </div>
        )}
      </div>

      {/* Các ô tổng theo lọc */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">{k.label}</span>
              <div className={`p-2 rounded-xl ${k.cls}`}>
                <k.icon size={18} />
              </div>
            </div>
            <div className={`mt-2 text-xl md:text-2xl font-bold tracking-tight ${k.value < 0 ? 'text-rose-600' : 'text-foreground'}`}>
              {fmtVND(k.value)}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground truncate" title={k.sub}>
              {k.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Lợi nhuận theo ngày / tháng */}
      <div className="grid grid-cols-1 2xl:grid-cols-5 gap-4">
        <div className="2xl:col-span-3 rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-border">
            <div>
              <h2 className="text-base font-semibold text-foreground">Lợi nhuận theo {groupBy === 'day' ? 'ngày' : 'tháng'}</h2>
              <p className="text-xs text-muted-foreground">Doanh thu = Tiền bán + Cước xe − Trừ hàng • Lợi nhuận = Tiền bán − Tiền nhập (giá vốn) − Trừ hàng</p>
            </div>
            <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/40">
              {(['day', 'month'] as GroupBy[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroupBy(g)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                    groupBy === g ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Theo {g === 'day' ? 'ngày' : 'tháng'}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-auto max-h-[460px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/90 backdrop-blur text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">{groupBy === 'day' ? 'Ngày' : 'Tháng'}</th>
                  <th className="text-right px-3 py-2 font-semibold">Số đơn</th>
                  <th className="text-right px-3 py-2 font-semibold">Tiền bán</th>
                  <th className="text-right px-3 py-2 font-semibold">Cước xe</th>
                  <th className="text-right px-3 py-2 font-semibold">Trừ hàng</th>
                  <th className="text-right px-3 py-2 font-semibold">Doanh thu</th>
                  <th className="text-right px-3 py-2 font-semibold">Tiền nhập</th>
                  <th className="text-right px-3 py-2 font-semibold">Lợi nhuận</th>
                  <th className="text-right px-3 py-2 font-semibold">Tỷ suất</th>
                  <th className="text-right px-3 py-2 font-semibold">Nhập NCC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {profitRows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="text-center text-muted-foreground py-10 text-sm">
                      Không có dữ liệu trong bộ lọc này
                    </td>
                  </tr>
                )}
                {profitRows.map((r) => (
                  <tr key={r.key} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{labelOf(r.key)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.orders)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{fmt(r.sale)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-600">{fmt(r.shipping)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-rose-600">{fmt(r.discount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-teal-600">{fmt(r.revenue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-sky-600">{fmt(r.cost)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-bold ${r.profit < 0 ? 'text-rose-600' : 'text-violet-600'}`}>{fmt(r.profit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {r.sale > 0 ? `${((r.profit / r.sale) * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(r.purchase)}</td>
                  </tr>
                ))}
              </tbody>
              {profitRows.length > 0 && (
                <tfoot className="sticky bottom-0 bg-muted/90 backdrop-blur font-bold text-sm">
                  <tr>
                    <td className="px-3 py-2">Tổng ({fmt(profitRows.length)} {groupBy === 'day' ? 'ngày' : 'tháng'})</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.orders)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{fmt(totals.sale)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-600">{fmt(totals.shipping)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-rose-600">{fmt(totals.discount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-teal-600">{fmt(totals.revenue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-sky-600">{fmt(totals.cost)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${totals.profit < 0 ? 'text-rose-600' : 'text-violet-600'}`}>{fmt(totals.profit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{margin.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.purchase)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        <div className="2xl:col-span-2 rounded-2xl border border-border bg-card p-4 shadow-sm space-y-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Biểu đồ tiền bán & lợi nhuận</h2>
            <p className="text-xs text-muted-foreground">
              {groupBy === 'day' ? 'Tối đa 31 ngày gần nhất trong bộ lọc' : 'Tối đa 12 tháng gần nhất trong bộ lọc'}
            </p>
          </div>
          <div className="h-[380px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="label" fontSize={11} tickLine={false} />
                <YAxis fontSize={11} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1_000_000)}tr`} />
                <Tooltip formatter={(v: number) => fmtVND(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Tiền bán" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Lợi nhuận" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Tổng quan nhanh */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-8 gap-3">
        {[
          { icon: Flower2, cls: 'bg-rose-500/10 text-rose-600', title: `${fmt(flowers.length)} giống hoa`, sub: 'Danh sách hoa', to: '/hoa' },
          { icon: Store, cls: 'bg-purple-500/10 text-purple-600', title: `${fmt(distributors.length)} nhà phân phối`, sub: 'Danh sách NPP', to: '/nha-phan-phoi' },
          { icon: Truck, cls: 'bg-emerald-500/10 text-emerald-600', title: `${fmt(suppliers.length)} nhà vườn / NCC`, sub: 'Danh sách NCC', to: '/nha-cung-cap' },
          {
            icon: PackagePlus,
            cls: 'bg-blue-500/10 text-blue-600',
            to: '/don-hang-ncc',
            customContent: (
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold leading-tight flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-blue-600 tabular-nums whitespace-nowrap">
                    <span className="text-muted-foreground font-normal text-[11px]">Mua: </span>
                    {fmtVND(filteredPurchasesSummary.buyAmount)}
                  </span>
                  <span className="text-muted-foreground/60 hidden xl:inline">•</span>
                  <span className="text-emerald-600 tabular-nums whitespace-nowrap">
                    <span className="text-muted-foreground font-normal text-[11px]">Trả: </span>
                    {fmtVND(filteredPurchasesSummary.paidAmount)}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground truncate mt-1" title="Theo bộ lọc thời gian & nhà cung cấp">
                  Mua & Trả NCC (theo lọc • {fmt(filteredPurchases.length)} đơn)
                </div>
              </div>
            ),
          },
          {
            icon: CreditCard,
            cls: 'bg-rose-500/10 text-rose-600',
            title: fmtVND(supplierDebtSummary.totalDebt),
            sub: `${supplierDebtSummary.countWithDebt} NCC còn nợ • Công nợ NCC`,
            to: '/cong-no-ncc',
          },
          { icon: Users, cls: 'bg-sky-500/10 text-sky-600', title: `${fmt(employees.length)} nhân viên`, sub: 'Danh sách nhân viên', to: '/nhan-vien' },
          {
            icon: Boxes,
            cls: lowStockCount > 0 ? 'bg-amber-500/10 text-amber-600' : 'bg-primary/10 text-primary',
            title: lowStockCount > 0 ? `${fmt(lowStockCount)} mặt hàng sắp hết` : 'Tồn kho ổn',
            sub: 'Tồn kho',
            to: '/ton-kho',
          },
          {
            icon: Wallet,
            cls: 'bg-violet-500/10 text-violet-600',
            title: fmtVND(cashSummary.balance),
            sub: `Thu chi theo lọc • Thu ${fmt(cashSummary.income)} / Chi ${fmt(cashSummary.expense)}`,
            to: '/thu-chi',
          },
        ].map((c, idx) => (
          <div
            key={c.to || idx}
            onClick={() => navigate(c.to)}
            className="rounded-xl border border-border bg-card/60 p-3 flex items-center gap-3 hover:bg-muted/40 transition-colors cursor-pointer"
          >
            <div className={`p-2.5 rounded-lg shrink-0 ${c.cls}`}>
              <c.icon size={20} />
            </div>
            {c.customContent ? (
              c.customContent
            ) : (
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground truncate">{c.title}</div>
                <div className="text-[11px] text-muted-foreground truncate" title={c.sub}>{c.sub}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
