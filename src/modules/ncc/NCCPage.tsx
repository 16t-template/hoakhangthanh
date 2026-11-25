import { History } from 'lucide-react';
import { ModuleHistory } from '@/components/data/ModuleHistory';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Calendar,
  ChartColumn,
  CheckCircle2,
  Clock,
  List,
  MapPin,
  Plus,
  Receipt,
  RotateCcw,
  SquarePen,
  Star,
  Tag,
  Trash2,
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
  calculateSupplierFinancials,
  clearAllDebtAndOrderData,
  normalizeToISODate,
  useDebtStore,
  useSupplierOrderStore,
  useSupplierStore,
} from '@/stores/hoaKhangThanhStore';
import type { Supplier, SupplierOrder } from '@/types/hoaKhangThanh';
import { getDaysDifference } from '@/lib/debtCheck';
import { formatDate } from '@/lib/format';
import { NCCDrawer } from './NCCDrawer';
import { NCCStats } from './NCCStats';

type Tab = 'danhsach' | 'thongke' | 'lichsu';

const INITIAL_COLUMNS: ColumnDef[] = [
  { id: 'code', label: 'Mã NCC', visible: true, minWidth: 95, width: 105, order: 0 },
  { id: 'name', label: 'Tên Nhà Cung Cấp', visible: true, minWidth: 180, width: 220, order: 1 },
  { id: 'contactPerson', label: 'Người đại diện', visible: true, minWidth: 120, width: 130, order: 2 },
  { id: 'phone', label: 'Số điện thoại', visible: true, minWidth: 110, width: 120, order: 3 },
  { id: 'lastOrder', label: 'Đơn gần nhất', visible: true, minWidth: 150, width: 165, order: 4 },
  { id: 'oldDebt', label: 'Công nợ cũ', visible: true, minWidth: 115, width: 125, order: 5 },
  { id: 'importAmount', label: 'Tiền mua hàng', visible: true, minWidth: 125, width: 135, order: 6 },
  { id: 'paidAmount', label: 'Tiền trả nợ', visible: true, minWidth: 120, width: 130, order: 7 },
  { id: 'finalDebt', label: 'Công nợ cuối', visible: true, minWidth: 125, width: 135, order: 8 },
  { id: 'status', label: 'Trạng thái', visible: true, minWidth: 105, width: 115, order: 9 },
  { id: 'actions', label: 'Thao tác', visible: true, minWidth: 80, width: 85, order: 10 },
  { id: 'address', label: 'Khu vực / Địa chỉ', visible: false, minWidth: 160, width: 200, order: 11 },
  { id: 'specialties', label: 'Hoa chủ lực', visible: false, minWidth: 150, width: 170, order: 12 },
  { id: 'rating', label: 'Đánh giá', visible: false, minWidth: 85, width: 95, order: 13 },
];

export default function NCCPage() {
  const perms = useUserPermissions('ncc');
  const navigate = useNavigate();
  const { suppliers, deleteSupplier } = useSupplierStore();
  const { records: debtRecords } = useDebtStore();
  const { orders: supplierOrders } = useSupplierOrderStore();

  const [activeTab, setActiveTab] = useState<Tab>('danhsach');
  const [searchTerm, setSearchTerm] = useState('');

  // Filters
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedOrderActivity, setSelectedOrderActivity] = useState<string[]>([]);
  const [quickActivityTab, setQuickActivityTab] = useState<'all' | 'overdue' | 'recent' | 'days_4_7' | 'days_8_14' | 'days_15_30' | 'over_30' | 'none'>('all');
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
  } = useColumnSettings('ncc_v2', INITIAL_COLUMNS);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Drawer
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit' | 'view'>('create');
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);

  // Theo dõi đơn nhập gần nhất của từng NCC (Đếm số ngày & kiểm tra quá 3 ngày chưa nhập thêm)
  const supplierOrderMap = useMemo(() => {
    const map = new Map<
      string,
      {
        latestOrder: SupplierOrder | null;
        latestOrderDate: string | null;
        daysAgo: number | null;
        isOverdue: boolean;
        orderCount: number;
      }
    >();

    suppliers.forEach((s) => {
      const matching = supplierOrders.filter((o) => {
        const matchId = o.supplierId === s.id;
        const matchName =
          o.supplierName &&
          (o.supplierName.toLowerCase() === s.name.toLowerCase() ||
            s.name.toLowerCase().includes(o.supplierName.toLowerCase()) ||
            o.supplierName.toLowerCase().includes(s.name.toLowerCase()));
        const matchPhone =
          o.phone &&
          s.phone &&
          o.phone.replace(/\s+/g, '') === s.phone.replace(/\s+/g, '');
        return matchId || matchName || matchPhone;
      });

      const validOrders = matching.filter((o) => o.status !== 'huy');
      const targetOrders = validOrders.length > 0 ? validOrders : matching;

      if (targetOrders.length === 0) {
        map.set(s.id, {
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

      map.set(s.id, {
        latestOrder: latest,
        latestOrderDate: latest.orderDate,
        daysAgo: days,
        isOverdue,
        orderCount: matching.length,
      });
    });

    return map;
  }, [suppliers, supplierOrders]);

  // Đồng bộ và tính toán chính xác tiền nhập hoa, tiền trả, công nợ cuối cho từng NCC từ sổ công nợ & đơn nhập
  const enrichedSuppliers = useMemo(() => {
    return suppliers.map((s) => {
      const fin = calculateSupplierFinancials(s, debtRecords, supplierOrders);
      const orderInfo = supplierOrderMap.get(s.id);
      return {
        ...s,
        oldDebt: fin.oldDebt,
        importAmount: fin.importAmount,
        paidAmount: fin.paidAmount,
        finalDebt: fin.finalDebt,
        totalDebt: fin.totalDebt,
        lastOrderDate: orderInfo?.latestOrderDate ? normalizeToISODate(orderInfo.latestOrderDate) : '',
        daysSinceLastOrder: orderInfo?.daysAgo ?? undefined,
      };
    });
  }, [suppliers, debtRecords, supplierOrders, supplierOrderMap]);

  // Thống kê nhanh số lượng NCC theo tình trạng đơn nhập gần nhất
  const orderActivityCounts = useMemo(() => {
    let overdue = 0;
    let recent = 0;
    let days_4_7 = 0;
    let days_8_14 = 0;
    let days_15_30 = 0;
    let over_30 = 0;
    let none = 0;

    suppliers.forEach((s) => {
      const info = supplierOrderMap.get(s.id);
      const days = info?.daysAgo ?? null;
      if (days === null) {
        none++;
      } else {
        if (days <= 3) recent++;
        if (days > 3) overdue++;
        if (days >= 4 && days <= 7) days_4_7++;
        else if (days >= 8 && days <= 14) days_8_14++;
        else if (days >= 15 && days <= 30) days_15_30++;
        else if (days > 30) over_30++;
      }
    });

    return {
      overdue,
      recent,
      days_4_7,
      days_8_14,
      days_15_30,
      over_30,
      none,
      total: suppliers.length,
    };
  }, [suppliers, supplierOrderMap]);

  const statusOptions: FilterOption[] = useMemo(() => {
    const map: Record<string, number> = {};
    enrichedSuppliers.forEach((s) => {
      map[s.status] = (map[s.status] || 0) + 1;
    });
    return [
      { label: 'Đang hợp tác', value: 'active', count: map['active'] || 0 },
      { label: 'Tạm ngưng', value: 'inactive', count: map['inactive'] || 0 },
    ];
  }, [enrichedSuppliers]);

  const regionOptions: FilterOption[] = [
    { label: 'Lâm Đồng / Đà Lạt', value: 'Lâm Đồng' },
    { label: 'Hà Nội', value: 'Hà Nội' },
    { label: 'Đồng Tháp', value: 'Đồng Tháp' },
    { label: 'TP. Hồ Chí Minh', value: 'Hồ Chí Minh' },
  ];

  const orderActivityOptions: FilterOption[] = useMemo(() => {
    return [
      { label: '⚠️ Quá 3 ngày chưa nhập', value: 'overdue', count: orderActivityCounts.overdue },
      { label: 'Đã nhập gần đây (≤ 3 ngày)', value: 'recent', count: orderActivityCounts.recent },
      { label: '4 – 7 ngày chưa nhập (1 tuần)', value: 'days_4_7', count: orderActivityCounts.days_4_7 },
      { label: '8 – 14 ngày chưa nhập (2 tuần)', value: 'days_8_14', count: orderActivityCounts.days_8_14 },
      { label: '15 – 30 ngày chưa nhập (1 tháng)', value: 'days_15_30', count: orderActivityCounts.days_15_30 },
      { label: 'Quá 30 ngày chưa nhập (> 1 tháng)', value: 'over_30', count: orderActivityCounts.over_30 },
      { label: 'Chưa có đơn nhập', value: 'none', count: orderActivityCounts.none },
    ];
  }, [orderActivityCounts]);

  const filteredData = useMemo(() => {
    return enrichedSuppliers.filter((s) => {
      const q = searchTerm.toLowerCase();
      const matchSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        s.contactPerson.toLowerCase().includes(q) ||
        s.address.toLowerCase().includes(q) ||
        s.phone.includes(q);

      const matchStatus = selectedStatuses.length === 0 || selectedStatuses.includes(s.status);
      const matchRegion =
        selectedRegions.length === 0 ||
        selectedRegions.some((r) => s.address.toLowerCase().includes(r.toLowerCase()));

      const info = supplierOrderMap.get(s.id);
      const days = info?.daysAgo ?? null;
      const hasOrder = days !== null && Boolean(info?.latestOrderDate);

      // Match quick tab
      let matchQuickTab = true;
      if (quickActivityTab === 'overdue') matchQuickTab = days !== null && days > 3;
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

      return matchSearch && matchStatus && matchRegion && matchActivity && matchQuickTab && matchDateRange;
    });
  }, [
    enrichedSuppliers,
    searchTerm,
    selectedStatuses,
    selectedRegions,
    selectedOrderActivity,
    quickActivityTab,
    orderDateStart,
    orderDateEnd,
    supplierOrderMap,
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
      toast.error('Bạn không có quyền xóa nhà cung cấp!');
      return;
    }
    if (confirm(`Bạn có chắc muốn xóa ${selectedIds.size} nhà cung cấp đã chọn?`)) {
      selectedIds.forEach((id) => deleteSupplier(id));
      setSelectedIds(new Set());
      toast.success('Đã xóa các nhà cung cấp đã chọn');
    }
  };

  const handleAddNew = () => {
    if (!perms.create) {
      toast.error('Bạn không có quyền thêm mới nhà cung cấp!');
      return;
    }
    setSelectedSupplier(null);
    setDrawerMode('create');
    setIsDrawerOpen(true);
  };

  const handleEdit = (s: Supplier) => {
    if (!perms.edit) {
      toast.error('Bạn không có quyền chỉnh sửa nhà cung cấp!');
      return;
    }
    setSelectedSupplier(s);
    setDrawerMode('edit');
    setIsDrawerOpen(true);
  };

  const handleView = (s: Supplier) => {
    setSelectedSupplier(s);
    setDrawerMode('view');
    setIsDrawerOpen(true);
  };

  const handleDelete = (s: Supplier) => {
    if (!perms.delete) {
      toast.error('Bạn không có quyền xóa nhà cung cấp!');
      return;
    }
    if (confirm(`Bạn có chắc muốn xóa nhà cung cấp "${s.name}"?`)) {
      deleteSupplier(s.id);
      toast.success(`Đã xóa nhà cung cấp ${s.name}`);
    }
  };

  const formatNumber = (num: number) => {
    return (num || 0).toLocaleString('vi-VN');
  };

  const renderCell = (columnId: string, row: Supplier) => {
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
      case 'contactPerson':
        return <span className="text-xs font-medium text-foreground">{row.contactPerson}</span>;
      case 'phone':
        return (
          <a href={`tel:${row.phone}`} className="text-xs text-primary hover:underline font-medium">
            {row.phone}
          </a>
        );
      case 'lastOrder': {
        const orderInfo = supplierOrderMap.get(row.id);
        if (!orderInfo || orderInfo.daysAgo === null || !orderInfo.latestOrder) {
          return (
            <span className="text-xs text-muted-foreground/70 italic flex items-center gap-1">
              <Clock size={11} className="text-muted-foreground/60 shrink-0" />
              Chưa nhập hàng
            </span>
          );
        }

        const formattedDate = formatDate(normalizeToISODate(orderInfo.latestOrderDate || ''));

        if (orderInfo.isOverdue) {
          return (
            <div className="flex flex-col gap-0.5">
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300 dark:border-rose-800 w-fit shadow-2xs"
                title={`Đã ${orderInfo.daysAgo} ngày chưa nhập hàng từ NCC (Quá hạn 3 ngày)`}
              >
                <AlertTriangle size={11} className="text-rose-600 shrink-0" />
                {orderInfo.daysAgo} ngày chưa nhập
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
      case 'oldDebt':
        return (
          <span className="text-xs font-mono font-medium text-muted-foreground">
            {formatNumber(row.oldDebt || 0)}
          </span>
        );
      case 'importAmount':
        return (
          <span className="text-xs font-mono font-bold text-foreground">
            {formatNumber(row.importAmount || 0)}
          </span>
        );
      case 'paidAmount':
        return (
          <span className="text-xs font-mono font-bold text-emerald-600">
            {formatNumber(row.paidAmount || 0)}
          </span>
        );
      case 'finalDebt': {
        const finalDebt =
          row.finalDebt !== undefined
            ? row.finalDebt
            : (row.oldDebt || 0) + (row.importAmount || 0) - (row.paidAmount || 0);
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/cong-no-ncc?nccId=${row.id}`);
            }}
            className="group inline-flex items-center gap-1 hover:underline text-left cursor-pointer"
            title="Nhấn để xem sổ chi tiết công nợ của NCC này"
          >
            <span className={`text-xs font-mono font-extrabold ${finalDebt > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {formatNumber(finalDebt)}
            </span>
          </button>
        );
      }
      case 'address':
        return <span className="text-xs text-muted-foreground truncate max-w-[180px]">{row.address}</span>;
      case 'specialties':
        return (
          <span className="text-xs text-muted-foreground truncate max-w-[160px]">
            {row.specialties.join(', ')}
          </span>
        );
      case 'rating':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-500">
            <Star size={12} className="fill-amber-500" />
            {row.rating}
          </span>
        );
      case 'totalDebt':
        return (
          <span className={`text-xs font-mono font-bold ${row.totalDebt > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
            {formatNumber(row.totalDebt)}
          </span>
        );
      case 'status':
        return (
          <span
            className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
              row.status === 'active'
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                : 'bg-muted text-muted-foreground border-border'
            }`}
          >
            {row.status === 'active' ? 'Đang hợp tác' : 'Tạm ngưng'}
          </span>
        );
      case 'actions':
        return (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigate(`/cong-no-ncc?nccId=${row.id}`)}
              className="p-1 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
              title="Xem sổ công nợ NCC này"
            >
              <Receipt size={14} />
            </button>
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

  const renderMobileCard = (row: Supplier, selected: boolean) => {
    const finalDebt =
      row.finalDebt !== undefined
        ? row.finalDebt
        : (row.oldDebt || 0) + (row.importAmount || 0) - (row.paidAmount || 0);

    const orderInfo = supplierOrderMap.get(row.id);
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
            {row.status === 'active' ? 'Đang hợp tác' : 'Tạm ngưng'}
          </span>
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">{row.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{row.contactPerson} • {row.phone}</div>
        </div>

        {/* Tình trạng đơn nhập gần nhất */}
        <div className="flex items-center justify-between text-xs pt-1.5 border-t border-border/50">
          <span className="text-muted-foreground text-[11px] flex items-center gap-1">
            <Clock size={11} /> Đơn gần nhất:
          </span>
          {!orderInfo || orderInfo.daysAgo === null ? (
            <span className="text-muted-foreground text-[11px]">Chưa nhập hàng</span>
          ) : orderInfo.isOverdue ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300">
              <AlertTriangle size={11} className="text-rose-600" /> {orderInfo.daysAgo} ngày chưa nhập ({formattedDate})
            </span>
          ) : (
            <span className="text-foreground font-medium text-[11px]">
              {orderInfo.daysAgo === 0 ? 'Hôm nay' : `${orderInfo.daysAgo} ngày trước`} ({formattedDate})
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono pt-2 border-t border-border/50">
          <div>
            <span className="text-muted-foreground block text-[10px]">Nợ cũ:</span>
            <span className="font-medium text-muted-foreground">{formatNumber(row.oldDebt || 0)}</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">Tiền nhập:</span>
            <span className="font-bold text-foreground">{formatNumber(row.importAmount || 0)}</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">Đã trả:</span>
            <span className="font-bold text-emerald-600">{formatNumber(row.paidAmount || 0)}</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">Nợ cuối:</span>
            <span className={`font-extrabold ${finalDebt > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {formatNumber(finalDebt)}
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/cong-no-ncc?nccId=${row.id}`);
            }}
            className="text-[11px] font-semibold text-emerald-600 hover:underline flex items-center gap-1"
          >
            <Receipt size={12} /> Xem sổ công nợ NCC
          </button>
        </div>
      </div>
    );
  };

  const activeFilterCount =
    (selectedStatuses.length > 0 ? 1 : 0) +
    (selectedRegions.length > 0 ? 1 : 0) +
    (selectedOrderActivity.length > 0 ? 1 : 0) +
    (quickActivityTab !== 'all' ? 1 : 0) +
    (orderDateStart || orderDateEnd ? 1 : 0);

  const handleClearAllFilters = () => {
    setSelectedStatuses([]);
    setSelectedRegions([]);
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
        <h2 className="text-lg font-bold text-foreground mb-1">Chưa được cấp quyền xem Nhà cung cấp</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Tài khoản của bạn hiện chưa được Quản trị viên cấp quyền xem dữ liệu Nhà cung cấp (NCC). Vui lòng liên hệ Admin để được phân quyền.
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

      {activeTab === 'lichsu' ? (<ModuleHistory module="ncc" />) : activeTab === 'danhsach' ? (
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
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => navigate('/cong-no-ncc')}
                  className="h-8 gap-1 text-xs text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                  title="Chuyển sang module Sổ công nợ NCC"
                >
                  <Receipt size={13} />
                  <span className="hidden sm:inline">Sổ công nợ NCC</span>
                </Button>
                {perms.delete && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (confirm('Bạn có chắc chắn muốn đặt lại toàn bộ số liệu công nợ của tất cả NCC về 0?')) {
                        clearAllDebtAndOrderData();
                        toast.success('Đã đưa công nợ của tất cả NCC về 0!');
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
                  placeholder="Đơn nhập gần nhất"
                  options={orderActivityOptions}
                  value={selectedOrderActivity}
                  onChange={setSelectedOrderActivity}
                />
                <MultiSelectFilter
                  icon={Tag}
                  placeholder="Trạng thái"
                  options={statusOptions}
                  value={selectedStatuses}
                  onChange={setSelectedStatuses}
                />
                <MultiSelectFilter
                  icon={MapPin}
                  placeholder="Khu vực"
                  options={regionOptions}
                  value={selectedRegions}
                  onChange={setSelectedRegions}
                />
              </>
            }
          />

          {/* Quick pills bar: Xem nhanh NCC theo đơn nhập gần nhất */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2 bg-muted/20 border-b border-border/60 text-xs shrink-0">
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 max-w-full">
              <span className="text-muted-foreground font-medium text-[11px] whitespace-nowrap flex items-center gap-1 mr-1">
                <Clock size={12} className="text-primary" />
                Đơn nhập gần nhất:
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
                title="Xem danh sách nhà cung cấp quá 3 ngày chưa nhập thêm hàng"
              >
                <AlertTriangle size={12} className={quickActivityTab === 'overdue' ? 'text-white' : 'text-rose-600'} />
                Quá 3 ngày chưa nhập ({orderActivityCounts.overdue})
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
                Đã nhập ≤ 3 ngày ({orderActivityCounts.recent})
              </button>
              <button
                type="button"
                onClick={() => setQuickActivityTab(quickActivityTab === 'days_4_7' ? 'all' : 'days_4_7')}
                className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  quickActivityTab === 'days_4_7'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 hover:bg-amber-100'
                }`}
                title="Các NCC có đơn gần nhất cách đây 4 - 7 ngày (1 tuần)"
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
                title="Các NCC có đơn gần nhất cách đây 8 - 14 ngày (2 tuần)"
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
                title="Các NCC có đơn gần nhất cách đây 15 - 30 ngày (1 tháng)"
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
                title="Các NCC có đơn gần nhất cách đây quá 30 ngày"
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
                title="Đơn nhập gần nhất từ ngày"
              />
              <span className="text-xs text-muted-foreground">-</span>
              <input
                type="date"
                value={orderDateEnd}
                onChange={(e) => setOrderDateEnd(e.target.value)}
                className="h-6 px-1.5 text-xs rounded border border-border bg-card text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                title="Đơn nhập gần nhất đến ngày"
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
            <DataTable<Supplier>
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
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <NCCStats />
        </div>
      )}

      {isDrawerOpen && (
        <NCCDrawer
          isOpen
          onClose={() => setIsDrawerOpen(false)}
          supplier={selectedSupplier}
          mode={drawerMode}
        />
      )}
    </div>
  );
}
