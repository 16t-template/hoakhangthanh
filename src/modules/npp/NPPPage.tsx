import { History } from 'lucide-react';
import { ModuleHistory } from '@/components/data/ModuleHistory';
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  ChartColumn,
  CheckCircle2,
  Clock,
  Coins,
  List,
  MapPin,
  Plus,
  RotateCcw,
  SquarePen,
  Tag,
  Trash2,
  Trophy,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { ListToolbar } from '@/components/data/ListToolbar';
import { DataTable } from '@/components/data/DataTable';
import { MultiSelectFilter, type FilterOption } from '@/components/ui/MultiSelectFilter';
import type { ColumnDef } from '@/stores/createListStore';
import { useColumnSettings } from '@/hooks/useColumnSettings';
import { useUserPermissions } from '@/stores/permissionStore';
import {
  calculateDistributorFinancials,
  clearAllDebtAndOrderData,
  normalizeToISODate,
  useDebtStore,
  useDistributorStore,
  useOrderStore,
} from '@/stores/hoaKhangThanhStore';
import type { Distributor, Order } from '@/types/hoaKhangThanh';
import { getDaysDifference } from '@/lib/debtCheck';
import { formatDate, parseDateTimestamp } from '@/lib/format';
import { NPPDrawer } from './NPPDrawer';
import { NPPStats } from './NPPStats';

type Tab = 'danhsach' | 'thongke' | 'lichsu';

const INITIAL_COLUMNS: ColumnDef[] = [
  { id: 'code', label: 'Mã NPP', visible: true, minWidth: 95, width: 105, order: 0 },
  { id: 'name', label: 'Tên Nhà Phân Phối', visible: true, minWidth: 180, width: 220, order: 1 },
  { id: 'representative', label: 'Người đại diện', visible: true, minWidth: 120, width: 130, order: 2 },
  { id: 'phone', label: 'Số điện thoại', visible: true, minWidth: 110, width: 120, order: 3 },
  { id: 'lastOrder', label: 'Đơn gần nhất', visible: true, minWidth: 150, width: 165, order: 4 },
  { id: 'lastPayment', label: 'Ngày trả nợ gần nhất', visible: true, minWidth: 165, width: 185, order: 5 },
  { id: 'oldDebt', label: 'Công nợ cũ', visible: true, minWidth: 115, width: 125, order: 6 },
  { id: 'salesAmount', label: 'Tiền bán hoa', visible: true, minWidth: 125, width: 135, order: 7 },
  { id: 'collectedAmount', label: 'Tiền thu nợ', visible: true, minWidth: 120, width: 130, order: 8 },
  { id: 'finalDebt', label: 'Công nợ cuối', visible: true, minWidth: 125, width: 135, order: 9 },
  { id: 'actions', label: 'Thao tác', visible: true, minWidth: 80, width: 85, order: 10 },
];

export default function NPPPage() {
  const perms = useUserPermissions('npp');
  const { distributors, deleteDistributor } = useDistributorStore();
  const { orders } = useOrderStore();
  const { records: debtRecords } = useDebtStore();

  const [activeTab, setActiveTab] = useState<Tab>('danhsach');
  const [searchTerm, setSearchTerm] = useState('');

  // Filters
  const [selectedTiers, setSelectedTiers] = useState<string[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedOrderActivity, setSelectedOrderActivity] = useState<string[]>([]);
  const [quickActivityTab, setQuickActivityTab] = useState<
    'all' | 'overdue' | 'over_10_order' | 'over_10_debt' | 'recent' | 'days_4_7' | 'days_8_14' | 'days_15_30' | 'over_30' | 'none'
  >('all');
  const [orderDateStart, setOrderDateStart] = useState('');
  const [orderDateEnd, setOrderDateEnd] = useState('');

  // Selection & Columns
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const {
    columns,
    handleToggleColumn,
    handleUpdateColumn,
    handleReorderColumns,
    handleResetColumns,
  } = useColumnSettings('npp', INITIAL_COLUMNS);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Drawer
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit' | 'view'>('create');
  const [selectedDistributor, setSelectedDistributor] = useState<Distributor | null>(null);

  // Theo dõi đơn hàng gần nhất của từng NPP (Đếm số ngày & kiểm tra quá 3 ngày chưa nhập thêm)
  const distributorOrderMap = useMemo(() => {
    const map = new Map<
      string,
      {
        latestOrder: Order | null;
        latestOrderDate: string | null;
        daysAgo: number | null;
        isOverdue: boolean;
        orderCount: number;
      }
    >();

    distributors.forEach((d) => {
      const matching = orders.filter((o) => {
        const matchId = o.distributorId === d.id;
        const matchName =
          o.distributorName &&
          (o.distributorName.toLowerCase() === d.name.toLowerCase() ||
            d.name.toLowerCase().includes(o.distributorName.toLowerCase()) ||
            o.distributorName.toLowerCase().includes(d.name.toLowerCase()));
        const matchPhone =
          o.phone &&
          d.phone &&
          o.phone.replace(/\s+/g, '') === d.phone.replace(/\s+/g, '');
        return matchId || matchName || matchPhone;
      });

      const validOrders = matching.filter((o) => o.status !== 'huy' && o.status !== 'cancelled');
      const targetOrders = validOrders.length > 0 ? validOrders : matching;

      if (targetOrders.length === 0) {
        map.set(d.id, {
          latestOrder: null,
          latestOrderDate: null,
          daysAgo: null,
          isOverdue: false,
          orderCount: 0,
        });
        return;
      }

      const sorted = [...targetOrders].sort((a, b) => {
        const dateA = normalizeToISODate(a.orderDate);
        const dateB = normalizeToISODate(b.orderDate);
        if (dateB !== dateA) return dateB.localeCompare(dateA);
        return (b.code || b.id).localeCompare(a.code || a.id);
      });

      const latest = sorted[0];
      const days = Math.max(0, getDaysDifference(latest.orderDate));
      const isOverdue = days > 3;

      map.set(d.id, {
        latestOrder: latest,
        latestOrderDate: latest.orderDate,
        daysAgo: days,
        isOverdue,
        orderCount: matching.length,
      });
    });

    return map;
  }, [distributors, orders]);

  // Theo dõi ngày trả nợ gần nhất của từng NPP (Từ phiếu thu nợ hoặc thanh toán đơn hàng)
  const distributorPaymentMap = useMemo(() => {
    const map = new Map<
      string,
      {
        latestPaymentDate: string | null;
        latestPaymentAmount: number;
        daysAgo: number | null;
        isOverdue10: boolean;
        paymentCount: number;
        source: 'debt_receipt' | 'order' | null;
      }
    >();

    distributors.forEach((d) => {
      const normName = d.name ? d.name.trim().toLowerCase() : '';
      const payments: { date: string; amount: number; source: 'debt_receipt' | 'order'; code?: string }[] = [];

      // 1. Từ sổ công nợ (phiếu thu / trả nợ)
      debtRecords.forEach((r) => {
        if (r.partnerType !== 'npp') return;
        const matchId = r.partnerId === d.id;
        const matchCode = r.partnerCode && r.partnerCode === d.code;
        const matchName = r.partnerName && r.partnerName.trim().toLowerCase() === normName;
        if (!matchId && !matchCode && !matchName) return;

        const isThu = r.type === 'thu' || ((r.decreaseAmount || 0) > 0 && (r.increaseAmount || 0) === 0);
        const amt = r.decreaseAmount !== undefined ? r.decreaseAmount : (isThu ? (r.amount || 0) : 0);
        if (isThu && amt > 0) {
          const dt = r.date;
          if (dt) payments.push({ date: dt, amount: amt, source: 'debt_receipt', code: r.referenceCode || r.id });
        }
      });

      // 2. Từ đơn hàng đã thanh toán (paidAmount > 0)
      orders.forEach((o) => {
        if (o.status === 'huy' || o.status === 'cancelled') return;
        const matchId = o.distributorId === d.id;
        const matchName =
          o.distributorName &&
          (o.distributorName.toLowerCase() === d.name.toLowerCase() ||
            d.name.toLowerCase().includes(o.distributorName.toLowerCase()) ||
            o.distributorName.toLowerCase().includes(d.name.toLowerCase()));
        if (!matchId && !matchName) return;

        const paid = o.paidAmount || 0;
        if (paid > 0 && o.orderDate) {
          payments.push({ date: o.orderDate, amount: paid, source: 'order', code: o.code });
        }
      });

      if (payments.length === 0) {
        map.set(d.id, {
          latestPaymentDate: null,
          latestPaymentAmount: 0,
          daysAgo: null,
          isOverdue10: false,
          paymentCount: 0,
          source: null,
        });
        return;
      }

      // Sắp xếp ngày trả nợ mới nhất lên đầu
      payments.sort((a, b) => {
        const timeA = parseDateTimestamp(a.date) ?? 0;
        const timeB = parseDateTimestamp(b.date) ?? 0;
        return timeB - timeA;
      });

      const latest = payments[0];
      const days = Math.max(0, getDaysDifference(latest.date));
      const isOverdue10 = days > 10;

      map.set(d.id, {
        latestPaymentDate: latest.date,
        latestPaymentAmount: latest.amount,
        daysAgo: days,
        isOverdue10,
        paymentCount: payments.length,
        source: latest.source,
      });
    });

    return map;
  }, [distributors, debtRecords, orders]);

  // Đồng bộ và tính toán chính xác tiền bán hoa, tiền thu nợ, công nợ cuối cho từng NPP từ sổ công nợ & đơn hàng
  const enrichedDistributors = useMemo(() => {
    return distributors.map((d) => {
      const fin = calculateDistributorFinancials(d, debtRecords, orders);
      const orderInfo = distributorOrderMap.get(d.id);
      const paymentInfo = distributorPaymentMap.get(d.id);
      return {
        ...d,
        oldDebt: fin.oldDebt,
        salesAmount: fin.salesAmount,
        collectedAmount: fin.collectedAmount,
        finalDebt: fin.finalDebt,
        currentDebt: fin.finalDebt,
        totalRevenue: fin.totalRevenue,
        lastOrderDate: orderInfo?.latestOrderDate ? normalizeToISODate(orderInfo.latestOrderDate) : '',
        daysSinceLastOrder: orderInfo?.daysAgo ?? undefined,
        lastPaymentDate: paymentInfo?.latestPaymentDate ? normalizeToISODate(paymentInfo.latestPaymentDate) : '',
        daysSinceLastPayment: paymentInfo?.daysAgo ?? undefined,
      };
    });
  }, [distributors, debtRecords, orders, distributorOrderMap, distributorPaymentMap]);

  // Thống kê nhanh số lượng NPP theo tình trạng lên đơn & trả nợ
  const orderActivityCounts = useMemo(() => {
    let overdue = 0;
    let over_10_order = 0;
    let over_10_debt = 0;
    let recent = 0;
    let days_4_7 = 0;
    let days_8_14 = 0;
    let days_15_30 = 0;
    let over_30 = 0;
    let none = 0;

    distributors.forEach((d) => {
      const info = distributorOrderMap.get(d.id);
      const days = info?.daysAgo ?? null;
      if (days === null) {
        none++;
      } else {
        if (days <= 3) recent++;
        if (days > 3) overdue++;
        if (days > 10) over_10_order++;
        if (days >= 4 && days <= 7) days_4_7++;
        else if (days >= 8 && days <= 14) days_8_14++;
        else if (days >= 15 && days <= 30) days_15_30++;
        else if (days > 30) over_30++;
      }

      const payInfo = distributorPaymentMap.get(d.id);
      const fin = calculateDistributorFinancials(d, debtRecords, orders);
      if (fin.finalDebt > 0 && (!payInfo || payInfo.daysAgo === null || (payInfo.daysAgo ?? 0) > 10)) {
        over_10_debt++;
      }
    });

    return {
      overdue,
      over_10_order,
      over_10_debt,
      recent,
      days_4_7,
      days_8_14,
      days_15_30,
      over_30,
      none,
      total: distributors.length,
    };
  }, [distributors, distributorOrderMap, distributorPaymentMap, debtRecords, orders]);

  const tierOptions: FilterOption[] = [
    { label: 'VIP 1 (Kim Cương)', value: 'VIP 1 (Kim Cương)' },
    { label: 'VIP 2 (Vàng)', value: 'VIP 2 (Vàng)' },
    { label: 'VIP 3 (Bạc)', value: 'VIP 3 (Bạc)' },
    { label: 'Tiềm năng', value: 'Tiềm năng' },
  ];

  const regionOptions: FilterOption[] = useMemo(() => {
    const map: Record<string, number> = {};
    distributors.forEach((d) => {
      map[d.region] = (map[d.region] || 0) + 1;
    });
    return Object.entries(map).map(([r, count]) => ({ label: r, value: r, count }));
  }, [distributors]);

  const statusOptions: FilterOption[] = [
    { label: 'Đang hoạt động', value: 'active' },
    { label: 'Tạm khóa', value: 'inactive' },
  ];

  const orderActivityOptions: FilterOption[] = useMemo(() => {
    return [
      { label: '⚠️ Quá 3 ngày chưa đặt', value: 'overdue', count: orderActivityCounts.overdue },
      { label: '⏰ > 10 ngày chưa đặt', value: 'over_10_order', count: orderActivityCounts.over_10_order },
      { label: '💸 > 10 ngày chưa trả nợ', value: 'over_10_debt', count: orderActivityCounts.over_10_debt },
      { label: 'Đã đặt gần đây (≤ 3 ngày)', value: 'recent', count: orderActivityCounts.recent },
      { label: '4 – 7 ngày chưa đặt (1 tuần)', value: 'days_4_7', count: orderActivityCounts.days_4_7 },
      { label: '8 – 14 ngày chưa đặt (2 tuần)', value: 'days_8_14', count: orderActivityCounts.days_8_14 },
      { label: '15 – 30 ngày chưa đặt (1 tháng)', value: 'days_15_30', count: orderActivityCounts.days_15_30 },
      { label: 'Quá 30 ngày chưa đặt (> 1 tháng)', value: 'over_30', count: orderActivityCounts.over_30 },
      { label: 'Chưa có đơn hàng', value: 'none', count: orderActivityCounts.none },
    ];
  }, [orderActivityCounts]);

  const filteredData = useMemo(() => {
    return enrichedDistributors.filter((d) => {
      const q = searchTerm.toLowerCase();
      const matchSearch =
        !q ||
        d.name.toLowerCase().includes(q) ||
        d.code.toLowerCase().includes(q) ||
        d.representative.toLowerCase().includes(q) ||
        d.phone.includes(q);

      const matchTier = selectedTiers.length === 0 || selectedTiers.includes(d.tier);
      const matchRegion = selectedRegions.length === 0 || selectedRegions.includes(d.region);
      const matchStatus = selectedStatuses.length === 0 || selectedStatuses.includes(d.status);

      const info = distributorOrderMap.get(d.id);
      const days = info?.daysAgo ?? null;
      const hasOrder = days !== null && Boolean(info?.latestOrderDate);

      const payInfo = distributorPaymentMap.get(d.id);
      const hasDebt = (d.currentDebt !== undefined ? d.currentDebt : (d.finalDebt || 0)) > 0;
      const isDebtOverdue10 = hasDebt && (!payInfo || payInfo.daysAgo === null || (payInfo.daysAgo ?? 0) > 10);

      // Match quick tab
      let matchQuickTab = true;
      if (quickActivityTab === 'overdue') matchQuickTab = days !== null && days > 3;
      else if (quickActivityTab === 'over_10_order') matchQuickTab = days !== null && days > 10;
      else if (quickActivityTab === 'over_10_debt') matchQuickTab = isDebtOverdue10;
      else if (quickActivityTab === 'recent') matchQuickTab = days !== null && days <= 3;
      else if (quickActivityTab === 'days_4_7') matchQuickTab = days !== null && days >= 4 && days <= 7;
      else if (quickActivityTab === 'days_8_14') matchQuickTab = days !== null && days >= 8 && days <= 14;
      else if (quickActivityTab === 'days_15_30') matchQuickTab = days !== null && days >= 15 && days <= 30;
      else if (quickActivityTab === 'over_30') matchQuickTab = days !== null && days > 30;
      else if (quickActivityTab === 'none') matchQuickTab = days === null;

      // Match multi select
      let matchActivity = true;
      if (selectedOrderActivity.length > 0) {
        matchActivity = selectedOrderActivity.some((val) => {
          if (val === 'overdue') return days !== null && days > 3;
          if (val === 'over_10_order') return days !== null && days > 10;
          if (val === 'over_10_debt') return isDebtOverdue10;
          if (val === 'recent') return days !== null && days <= 3;
          if (val === 'days_4_7') return days !== null && days >= 4 && days <= 7;
          if (val === 'days_8_14') return days !== null && days >= 8 && days <= 14;
          if (val === 'days_15_30') return days !== null && days >= 15 && days <= 30;
          if (val === 'over_30') return days !== null && days > 30;
          if (val === 'none') return days === null;
          return false;
        });
      }

      // Match date range
      let matchDateRange = true;
      if (orderDateStart || orderDateEnd) {
        if (!hasOrder || !info?.latestOrderDate) {
          matchDateRange = false;
        } else {
          const iso = normalizeToISODate(info.latestOrderDate);
          if (orderDateStart && iso < orderDateStart) matchDateRange = false;
          if (orderDateEnd && iso > orderDateEnd) matchDateRange = false;
        }
      }

      return matchSearch && matchTier && matchRegion && matchStatus && matchActivity && matchQuickTab && matchDateRange;
    });
  }, [
    enrichedDistributors,
    searchTerm,
    selectedTiers,
    selectedRegions,
    selectedStatuses,
    selectedOrderActivity,
    quickActivityTab,
    orderDateStart,
    orderDateEnd,
    distributorOrderMap,
    distributorPaymentMap,
  ]);

  
  const handleToggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleAll = (ids: string[]) => {
    setSelectedIds((prev) => (prev.size === ids.length ? new Set() : new Set(ids)));
  };

  const handleDeleteMany = () => {
    if (!perms.delete) {
      toast.error('Bạn không có quyền xóa nhà phân phối!');
      return;
    }
    if (confirm(`Bạn có chắc muốn xóa ${selectedIds.size} nhà phân phối đã chọn?`)) {
      selectedIds.forEach((id) => deleteDistributor(id));
      setSelectedIds(new Set());
      toast.success('Đã xóa các đại lý đã chọn');
    }
  };

  const handleAddNew = () => {
    if (!perms.create) {
      toast.error('Bạn không có quyền thêm mới nhà phân phối!');
      return;
    }
    setSelectedDistributor(null);
    setDrawerMode('create');
    setIsDrawerOpen(true);
  };

  const handleEdit = (d: Distributor) => {
    if (!perms.edit) {
      toast.error('Bạn không có quyền chỉnh sửa nhà phân phối!');
      return;
    }
    setSelectedDistributor(d);
    setDrawerMode('edit');
    setIsDrawerOpen(true);
  };

  const handleView = (d: Distributor) => {
    setSelectedDistributor(d);
    setDrawerMode('view');
    setIsDrawerOpen(true);
  };

  const handleDelete = (d: Distributor) => {
    if (!perms.delete) {
      toast.error('Bạn không có quyền xóa nhà phân phối!');
      return;
    }
    if (confirm(`Bạn có chắc muốn xóa đại lý "${d.name}"?`)) {
      deleteDistributor(d.id);
      toast.success(`Đã xóa đại lý ${d.name}`);
    }
  };

  const formatNumber = (num: number) => {
    return (num || 0).toLocaleString('vi-VN');
  };

  const renderCell = (columnId: string, row: Distributor) => {
    switch (columnId) {
      case 'code':
        return (
          <button
            type="button"
            onClick={() => handleView(row)}
            className="px-2 py-0.5 rounded text-xs font-mono font-medium border border-border bg-muted/40 text-foreground hover:border-primary/40 hover:text-primary transition-colors text-left"
          >
            {row.code}
          </button>
        );
      case 'name':
        return (
          <div className="text-xs font-semibold text-foreground cursor-pointer hover:text-primary" onClick={() => handleView(row)}>
            <div>{row.name}</div>
          </div>
        );
      case 'representative':
        return <span className="text-xs font-medium text-foreground">{row.representative}</span>;
      case 'phone':
        return (
          <a href={`tel:${row.phone}`} className="text-xs text-primary hover:underline font-medium">
            {row.phone}
          </a>
        );
      case 'lastOrder': {
        const orderInfo = distributorOrderMap.get(row.id);
        if (!orderInfo || orderInfo.daysAgo === null || !orderInfo.latestOrder) {
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-muted/60 text-muted-foreground border border-border">
              Chưa lên đơn
            </span>
          );
        }

        const formattedDate = formatDate(normalizeToISODate(orderInfo.latestOrderDate || ''));

        if (orderInfo.isOverdue) {
          return (
            <div className="flex flex-col gap-0.5">
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300 dark:border-rose-800 w-fit shadow-xs"
                title={`Đã ${orderInfo.daysAgo} ngày chưa lên đơn mới (Quá hạn 3 ngày)`}
              >
                <AlertTriangle size={11} className="text-rose-600 shrink-0" />
                {orderInfo.daysAgo} ngày chưa đặt
              </span>
              <span className="text-[10px] text-rose-600/90 dark:text-rose-400 font-mono font-medium">
                Lần cuối: {formattedDate}
              </span>
            </div>
          );
        }

        if (orderInfo.daysAgo === 0) {
          return (
            <div className="flex flex-col gap-0.5">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 w-fit">
                <CheckCircle2 size={11} className="text-emerald-600 shrink-0" />
                Hôm nay
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {formattedDate} ({orderInfo.latestOrder.code})
              </span>
            </div>
          );
        }

        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-200 dark:border-sky-800 w-fit">
              <Clock size={11} className="text-sky-600 shrink-0" />
              {orderInfo.daysAgo} ngày trước
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">
              {formattedDate} ({orderInfo.latestOrder.code})
            </span>
          </div>
        );
      }
      case 'lastPayment': {
        const payInfo = distributorPaymentMap.get(row.id);
        const finalDebt =
          row.finalDebt !== undefined
            ? row.finalDebt
            : (row.oldDebt || 0) + (row.salesAmount || 0) - (row.collectedAmount || 0);

        if (!payInfo || payInfo.daysAgo === null || !payInfo.latestPaymentDate) {
          if (finalDebt <= 0) {
            return (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-muted/60 text-muted-foreground border border-border">
                Không nợ
              </span>
            );
          }
          return (
            <div className="flex flex-col gap-0.5">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-800/60 w-fit">
                <AlertTriangle size={11} className="text-amber-600 shrink-0" />
                Chưa có thanh toán
              </span>
            </div>
          );
        }

        const formattedDate = formatDate(normalizeToISODate(payInfo.latestPaymentDate));

        if (payInfo.isOverdue10) {
          return (
            <div className="flex flex-col gap-0.5">
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300 dark:border-rose-800 w-fit shadow-xs"
                title={`Đã ${payInfo.daysAgo} ngày chưa thanh toán thêm (Quá 10 ngày)`}
              >
                <AlertTriangle size={11} className="text-rose-600 shrink-0" />
                {payInfo.daysAgo} ngày chưa trả
              </span>
              <span className="text-[10px] text-rose-600/90 dark:text-rose-400 font-mono font-medium">
                Lần cuối: {formattedDate} {payInfo.latestPaymentAmount > 0 && `(${formatNumber(payInfo.latestPaymentAmount)})`}
              </span>
            </div>
          );
        }

        if (payInfo.daysAgo === 0) {
          return (
            <div className="flex flex-col gap-0.5">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 w-fit">
                <CheckCircle2 size={11} className="text-emerald-600 shrink-0" />
                Hôm nay
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {formattedDate} {payInfo.latestPaymentAmount > 0 && `(${formatNumber(payInfo.latestPaymentAmount)})`}
              </span>
            </div>
          );
        }

        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 w-fit">
              <CheckCircle2 size={11} className="text-emerald-600 shrink-0" />
              {payInfo.daysAgo} ngày trước
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">
              Lần cuối: {formattedDate} {payInfo.latestPaymentAmount > 0 && `(${formatNumber(payInfo.latestPaymentAmount)})`}
            </span>
          </div>
        );
      }
      case 'oldDebt':
        return (
          <span className="text-xs font-mono font-medium text-muted-foreground">
            {formatNumber(row.oldDebt || 0)}
          </span>
        );
      case 'salesAmount':
        return (
          <span className="text-xs font-mono font-bold text-foreground">
            {formatNumber(row.salesAmount || 0)}
          </span>
        );
      case 'collectedAmount':
        return (
          <span className="text-xs font-mono font-bold text-emerald-600">
            {formatNumber(row.collectedAmount || 0)}
          </span>
        );
      case 'finalDebt': {
        const finalDebt =
          row.finalDebt !== undefined
            ? row.finalDebt
            : (row.oldDebt || 0) + (row.salesAmount || 0) - (row.collectedAmount || 0);
        return (
          <span className={`text-xs font-mono font-extrabold ${finalDebt > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
            {formatNumber(finalDebt)}
          </span>
        );
      }
      case 'currentDebt':
        return (
          <span className={`text-xs font-mono font-bold ${row.currentDebt > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
            {formatNumber(row.currentDebt)}
          </span>
        );
      case 'actions':
        return (
          <div className="flex items-center gap-2">
            {perms.edit && (
              <button
                type="button"
                onClick={() => handleEdit(row)}
                className="p-1 rounded text-primary hover:bg-primary/10 transition-colors"
                title="Chỉnh sửa"
              >
                <SquarePen size={14} />
              </button>
            )}
            {perms.delete && (
              <button
                type="button"
                onClick={() => handleDelete(row)}
                className="p-1 rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                title="Xóa"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  const renderMobileCard = (row: Distributor, selected: boolean) => {
    const finalDebt =
      row.finalDebt !== undefined
        ? row.finalDebt
        : (row.oldDebt || 0) + (row.salesAmount || 0) - (row.collectedAmount || 0);

    const orderInfo = distributorOrderMap.get(row.id);
    const formattedDate = orderInfo?.latestOrderDate
      ? formatDate(normalizeToISODate(orderInfo.latestOrderDate))
      : '';

    return (
      <div
        onClick={() => handleView(row)}
        className={`p-3.5 rounded-xl border space-y-2.5 transition-all cursor-pointer ${
          selected ? 'bg-primary/5 border-primary/40' : 'bg-card border-border hover:shadow-sm'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-muted/60 border border-border">
            {row.code}
          </span>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
              row.status === 'active'
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200'
                : 'bg-muted text-muted-foreground border border-border'
            }`}
          >
            {row.status === 'active' ? 'Hoạt động' : 'Tạm khóa'}
          </span>
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">{row.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{row.representative} • {row.phone}</div>
        </div>

        {/* Tình trạng lên đơn gần nhất */}
        <div className="flex items-center justify-between text-xs pt-1.5 border-t border-border/50">
          <span className="text-muted-foreground text-[11px] flex items-center gap-1">
            <Clock size={11} /> Đơn gần nhất:
          </span>
          {!orderInfo || orderInfo.daysAgo === null ? (
            <span className="text-muted-foreground text-[11px]">Chưa lên đơn</span>
          ) : orderInfo.isOverdue ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300">
              <AlertTriangle size={11} className="text-rose-600" /> {orderInfo.daysAgo} ngày chưa đặt ({formattedDate})
            </span>
          ) : (
            <span className="text-foreground font-medium text-[11px]">
              {orderInfo.daysAgo === 0 ? 'Hôm nay' : `${orderInfo.daysAgo} ngày trước`} ({formattedDate})
            </span>
          )}
        </div>

        {/* Tình trạng trả nợ gần nhất */}
        {(() => {
          const payInfo = distributorPaymentMap.get(row.id);
          const payFormattedDate = payInfo?.latestPaymentDate
            ? formatDate(normalizeToISODate(payInfo.latestPaymentDate))
            : '';
          return (
            <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50">
              <span className="text-muted-foreground text-[11px] flex items-center gap-1">
                <Coins size={11} className="text-amber-500" /> Trả nợ gần nhất:
              </span>
              {!payInfo || payInfo.daysAgo === null || !payInfo.latestPaymentDate ? (
                finalDebt <= 0 ? (
                  <span className="text-muted-foreground text-[11px]">Không nợ</span>
                ) : (
                  <span className="text-amber-600 font-medium text-[11px]">Chưa có thanh toán</span>
                )
              ) : payInfo.isOverdue10 ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300">
                  <AlertTriangle size={11} className="text-rose-600" /> {payInfo.daysAgo} ngày chưa trả ({payFormattedDate})
                </span>
              ) : (
                <span className="text-foreground font-medium text-[11px]">
                  {payInfo.daysAgo === 0 ? 'Hôm nay' : `${payInfo.daysAgo} ngày trước`} ({payFormattedDate})
                </span>
              )}
            </div>
          );
        })()}

        <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono pt-2 border-t border-border/50">
          <div>
            <span className="text-muted-foreground block text-[10px]">Nợ cũ:</span>
            <span className="font-medium text-muted-foreground">{formatNumber(row.oldDebt || 0)}</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">Tiền bán:</span>
            <span className="font-bold text-foreground">{formatNumber(row.salesAmount || 0)}</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">Thu nợ:</span>
            <span className="font-bold text-emerald-600">{formatNumber(row.collectedAmount || 0)}</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">Nợ cuối:</span>
            <span className={`font-extrabold ${finalDebt > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {formatNumber(finalDebt)}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const activeFilterCount =
    (selectedTiers.length > 0 ? 1 : 0) +
    (selectedRegions.length > 0 ? 1 : 0) +
    (selectedStatuses.length > 0 ? 1 : 0) +
    (selectedOrderActivity.length > 0 ? 1 : 0) +
    (quickActivityTab !== 'all' ? 1 : 0) +
    (orderDateStart || orderDateEnd ? 1 : 0);

  const handleClearAllFilters = () => {
    setSelectedTiers([]);
    setSelectedRegions([]);
    setSelectedStatuses([]);
    setSelectedOrderActivity([]);
    setQuickActivityTab('all');
    setOrderDateStart('');
    setOrderDateEnd('');
    setSearchTerm('');
  };

  if (!perms.view) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
        <div className="w-14 h-14 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 flex items-center justify-center mb-4">
          <AlertTriangle size={28} />
        </div>
        <h2 className="text-lg font-bold text-foreground mb-1">Chưa được cấp quyền xem Nhà phân phối</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Tài khoản của bạn hiện chưa được Quản trị viên cấp quyền xem dữ liệu Nhà phân phối (NPP). Vui lòng liên hệ Admin để được phân quyền.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="px-3 sm:px-4 pt-3 pb-1 shrink-0 bg-background">
        <Tabs<Tab>
          tabs={[
            { id: 'danhsach', label: 'Danh sách', icon: List },
            { id: 'thongke', label: 'Thống kê', icon: ChartColumn },
            { id: 'lichsu', label: 'Lịch sử thao tác', icon: History },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
        />
      </div>

      {activeTab === 'lichsu' ? (<ModuleHistory module="npp" />) : activeTab === 'danhsach' ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <ListToolbar
            showBack={true}
            searchPlaceholder="Tìm kiếm . . ."
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            selectedCount={selectedIds.size}
            onClearSelection={() => setSelectedIds(new Set())}
            onDeleteMany={handleDeleteMany}
            columns={columns}
            onToggleColumn={handleToggleColumn}
            onUpdateColumn={handleUpdateColumn}
            onReorderColumns={handleReorderColumns}
            onResetColumns={handleResetColumns}
            activeFilterCount={activeFilterCount}
            onClearAllFilters={handleClearAllFilters}
            actions={
              <div className="flex items-center gap-1.5">
                {perms.delete && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (confirm('Bạn có chắc chắn muốn đặt lại toàn bộ số liệu công nợ của tất cả NPP về 0?')) {
                        clearAllDebtAndOrderData();
                        toast.success('Đã đưa công nợ của tất cả NPP về 0!');
                      }
                    }}
                    className="h-8 gap-1 text-xs text-rose-600 border-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    title="Đặt lại toàn bộ số liệu công nợ về 0"
                  >
                    <RotateCcw size={13} />
                    <span className="hidden sm:inline">Đặt lại nợ về 0</span>
                  </Button>
                )}
                {perms.create && (
                  <Button
                    size="sm"
                    onClick={handleAddNew}
                    className="h-8 gap-1.5 text-xs font-semibold bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                  >
                    <Plus size={14} className="stroke-[2.5px]" />
                    <span>Thêm mới</span>
                  </Button>
                )}
              </div>
            }
            filters={
              <>
                <MultiSelectFilter
                  icon={Clock}
                  placeholder="Lên đơn gần nhất"
                  options={orderActivityOptions}
                  value={selectedOrderActivity}
                  onChange={setSelectedOrderActivity}
                />
                <MultiSelectFilter
                  icon={Trophy}
                  placeholder="Cấp đại lý"
                  options={tierOptions}
                  value={selectedTiers}
                  onChange={setSelectedTiers}
                />
                <MultiSelectFilter
                  icon={MapPin}
                  placeholder="Khu vực"
                  options={regionOptions}
                  value={selectedRegions}
                  onChange={setSelectedRegions}
                />
                <MultiSelectFilter
                  icon={Tag}
                  placeholder="Trạng thái"
                  options={statusOptions}
                  value={selectedStatuses}
                  onChange={setSelectedStatuses}
                />
              </>
            }
          />

          {/* Quick pills bar: Xem nhanh NPP theo tình trạng lên đơn gần nhất */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2 bg-muted/20 border-b border-border/60 text-xs shrink-0">
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 max-w-full">
              <span className="text-muted-foreground font-medium text-[11px] whitespace-nowrap flex items-center gap-1 mr-1">
                <Clock size={12} className="text-primary" />
                Lên đơn gần nhất:
              </span>
              <button
                type="button"
                onClick={() => setQuickActivityTab('all')}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                  quickActivityTab === 'all'
                    ? 'bg-foreground text-background shadow-xs'
                    : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                Tất cả ({orderActivityCounts.total})
              </button>
              <button
                type="button"
                onClick={() => setQuickActivityTab(quickActivityTab === 'overdue' ? 'all' : 'overdue')}
                className={`px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap flex items-center gap-1.5 transition-all ${
                  quickActivityTab === 'overdue'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : orderActivityCounts.overdue > 0
                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-300 dark:border-rose-800 hover:bg-rose-200'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
                title="Xem danh sách nhà phân phối quá 3 ngày chưa đặt hàng"
              >
                <AlertTriangle size={12} className={quickActivityTab === 'overdue' ? 'text-white' : 'text-rose-600'} />
                Quá 3 ngày chưa đặt ({orderActivityCounts.overdue})
              </button>
              <button
                type="button"
                onClick={() => setQuickActivityTab(quickActivityTab === 'over_10_order' ? 'all' : 'over_10_order')}
                className={`px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap flex items-center gap-1.5 transition-all ${
                  quickActivityTab === 'over_10_order'
                    ? 'bg-red-700 text-white shadow-xs'
                    : orderActivityCounts.over_10_order > 0
                    ? 'bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800 hover:bg-rose-100'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
                title="Các NPP có đơn gần nhất cách đây hơn 10 ngày"
              >
                <Clock size={12} className={quickActivityTab === 'over_10_order' ? 'text-white' : 'text-rose-600'} />
                &gt; 10 ngày chưa đặt ({orderActivityCounts.over_10_order})
              </button>
              <button
                type="button"
                onClick={() => setQuickActivityTab(quickActivityTab === 'over_10_debt' ? 'all' : 'over_10_debt')}
                className={`px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap flex items-center gap-1.5 transition-all ${
                  quickActivityTab === 'over_10_debt'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : orderActivityCounts.over_10_debt > 0
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-800 hover:bg-amber-200'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
                title="Các NPP còn công nợ và quá 10 ngày chưa trả nợ"
              >
                <Coins size={12} className={quickActivityTab === 'over_10_debt' ? 'text-white' : 'text-amber-700'} />
                &gt; 10 ngày chưa trả nợ ({orderActivityCounts.over_10_debt})
              </button>
              <button
                type="button"
                onClick={() => setQuickActivityTab(quickActivityTab === 'recent' ? 'all' : 'recent')}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 transition-all ${
                  quickActivityTab === 'recent'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100'
                }`}
              >
                <CheckCircle2 size={12} className={quickActivityTab === 'recent' ? 'text-white' : 'text-emerald-600'} />
                Đã đặt ≤ 3 ngày ({orderActivityCounts.recent})
              </button>
              <button
                type="button"
                onClick={() => setQuickActivityTab(quickActivityTab === 'days_4_7' ? 'all' : 'days_4_7')}
                className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  quickActivityTab === 'days_4_7'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 hover:bg-amber-100'
                }`}
                title="Các NPP có đơn gần nhất cách đây 4 - 7 ngày (1 tuần)"
              >
                4 – 7 ngày ({orderActivityCounts.days_4_7})
              </button>
              <button
                type="button"
                onClick={() => setQuickActivityTab(quickActivityTab === 'days_8_14' ? 'all' : 'days_8_14')}
                className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  quickActivityTab === 'days_8_14'
                    ? 'bg-orange-600 text-white shadow-xs'
                    : 'bg-orange-50 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300 border border-orange-200 dark:border-orange-800/60 hover:bg-orange-100'
                }`}
                title="Các NPP có đơn gần nhất cách đây 8 - 14 ngày (2 tuần)"
              >
                8 – 14 ngày ({orderActivityCounts.days_8_14})
              </button>
              <button
                type="button"
                onClick={() => setQuickActivityTab(quickActivityTab === 'days_15_30' ? 'all' : 'days_15_30')}
                className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  quickActivityTab === 'days_15_30'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'bg-purple-50 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60 hover:bg-purple-100'
                }`}
                title="Các NPP có đơn gần nhất cách đây 15 - 30 ngày (1 tháng)"
              >
                15 – 30 ngày ({orderActivityCounts.days_15_30})
              </button>
              <button
                type="button"
                onClick={() => setQuickActivityTab(quickActivityTab === 'over_30' ? 'all' : 'over_30')}
                className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  quickActivityTab === 'over_30'
                    ? 'bg-red-700 text-white shadow-xs'
                    : 'bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300 border border-red-200 dark:border-red-800/60 hover:bg-red-100'
                }`}
                title="Các NPP có đơn gần nhất cách đây quá 30 ngày"
              >
                &gt; 30 ngày ({orderActivityCounts.over_30})
              </button>
              <button
                type="button"
                onClick={() => setQuickActivityTab(quickActivityTab === 'none' ? 'all' : 'none')}
                className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  quickActivityTab === 'none'
                    ? 'bg-slate-700 text-white shadow-xs'
                    : 'bg-muted/60 text-muted-foreground border border-border/70 hover:bg-muted hover:text-foreground'
                }`}
              >
                Chưa có đơn ({orderActivityCounts.none})
              </button>
            </div>

            {/* Bộ lọc khoảng ngày theo đơn gần nhất */}
            <div className="flex items-center gap-1.5 shrink-0 bg-background/90 px-2 py-1 rounded-lg border border-border/70 shadow-2xs">
              <Calendar size={13} className="text-primary shrink-0" />
              <span className="text-[11px] text-muted-foreground font-medium whitespace-nowrap">Khoảng ngày đơn:</span>
              <input
                type="date"
                value={orderDateStart}
                onChange={(e) => setOrderDateStart(e.target.value)}
                className="h-6 px-1.5 text-xs rounded border border-border bg-card text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                title="Đơn gần nhất từ ngày"
              />
              <span className="text-xs text-muted-foreground">-</span>
              <input
                type="date"
                value={orderDateEnd}
                onChange={(e) => setOrderDateEnd(e.target.value)}
                className="h-6 px-1.5 text-xs rounded border border-border bg-card text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                title="Đơn gần nhất đến ngày"
              />
              {(orderDateStart || orderDateEnd) && (
                <button
                  type="button"
                  onClick={() => {
                    setOrderDateStart('');
                    setOrderDateEnd('');
                  }}
                  className="h-6 px-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded transition-colors"
                  title="Xóa lọc khoảng ngày"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-0">
            <DataTable<Distributor>
              data={filteredData}
              columns={columns}
              selectedIds={selectedIds}
              onToggleSelection={handleToggleSelection}
              onToggleAll={handleToggleAll}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              onResizeColumn={(id, width) => handleUpdateColumn(id, { width })}
              renderCell={renderCell}
              renderMobileCard={renderMobileCard}
              keyExtractor={(r) => r.id}
              onRowClick={handleView}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <NPPStats />
        </div>
      )}

      {isDrawerOpen && (
        <NPPDrawer
          isOpen
          onClose={() => setIsDrawerOpen(false)}
          distributor={selectedDistributor}
          mode={drawerMode}
        />
      )}
    </div>
  );
}
