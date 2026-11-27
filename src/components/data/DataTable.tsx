import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Pin, Sigma } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MAX_COLUMN_WIDTH, type ColumnDef, type SortDirection, type SortState } from '@/stores/createListStore';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { parseDateTimestamp } from '@/lib/format';

export const PAGE_SIZES = [20, 50, 100, 200, 500];
export const PAGE_SIZE_ACCENTS = ['border-l-emerald-400', 'border-l-sky-400', 'border-l-violet-400', 'border-l-amber-400', 'border-l-rose-400', 'border-l-fuchsia-400'];
const CHECK_COL = 44;
const ACTION_COL = 80;
const DEFAULT_COL = 120;

export function columnStyle(col: Pick<ColumnDef, 'minWidth' | 'maxWidth' | 'width'>): CSSProperties {
  const style: CSSProperties = {};
  if (col.width != null) {
    style.width = col.width;
    style.minWidth = col.minWidth ? Math.min(col.width, col.minWidth) : col.width;
    style.maxWidth = col.maxWidth ? Math.max(col.width, col.maxWidth) : Math.max(col.width, MAX_COLUMN_WIDTH);
  } else {
    if (col.minWidth != null) style.minWidth = col.minWidth;
    style.maxWidth = col.maxWidth ?? MAX_COLUMN_WIDTH;
  }
  return style;
}

export function PageSizeSelect({
  value,
  onChange,
  totalRecords,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  totalRecords?: number;
  perPageLabel?: string;
  allLabel?: string;
  compact?: boolean;
  className?: string;
}) {
  const options = totalRecords && totalRecords > 500 && !PAGE_SIZES.includes(totalRecords)
    ? [...PAGE_SIZES, totalRecords]
    : PAGE_SIZES;

  return (
    <div className={cn('relative inline-flex items-center', className)}>
      <select
        value={value}
        aria-label="Cỡ trang"
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-7 pl-2.5 pr-6 text-xs font-medium rounded-md border border-border/80 bg-card text-foreground cursor-pointer hover:bg-muted/50 focus:outline-none focus:ring-1 focus:ring-primary/40 appearance-none shadow-2xs"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {totalRecords && opt === totalRecords && totalRecords > 500 ? `Tất cả (${totalRecords} dòng)` : `${opt} dòng`}
          </option>
        ))}
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute right-2 text-muted-foreground stroke-[2.5px]" />
    </div>
  );
}

export function getPaginationPages(currentPage: number, totalPages: number): (number | '...')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, '...', totalPages];
  }
  if (currentPage >= totalPages - 3) {
    return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
}

export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  selectedCount = 0,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
  selectedCount?: number;
  className?: string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pages = useMemo(() => getPaginationPages(page, pageCount), [page, pageCount]);
  const from = Math.min((page - 1) * pageSize + 1, total);
  const to = Math.min(page * pageSize, total);

  if (total <= 0) return null;

  return (
    <div className={cn("border-t border-border bg-card md:bg-muted/5 px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0 select-none", className)}>
      {/* Bên trái: Thông tin hiển thị dòng & Cỡ trang */}
      <div className="flex items-center flex-wrap gap-2 sm:gap-3 text-xs text-muted-foreground min-w-0">
        <div className="flex items-center gap-1.5 tabular-nums">
          <span className="text-primary font-bold text-sm leading-none">•</span>
          <span>Hiển thị</span>
          <span className="font-semibold text-foreground">{from} - {to}</span>
          <span className="text-muted-foreground/60">/</span>
          <span className="font-semibold text-foreground">{total}</span>
          <span>dòng</span>
        </div>

        {selectedCount > 0 && (
          <>
            <span className="text-primary font-medium hidden sm:inline">· {selectedCount} đã chọn</span>
            <span className="sm:hidden inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full bg-primary/15 text-primary text-xs font-bold tabular-nums">
              {selectedCount}✓
            </span>
          </>
        )}

        <div className="h-4 w-[1px] bg-border mx-1 hidden sm:block" />

        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground whitespace-nowrap">Cỡ trang:</span>
          <PageSizeSelect value={pageSize} onChange={onPageSizeChange} totalRecords={total} />
        </div>
      </div>

      {/* Bên phải: Phân trang dạng button group như ảnh 3 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground hidden sm:inline">Trang</span>
        <div className="inline-flex items-center rounded-lg border border-border/80 bg-card overflow-hidden shadow-2xs divide-x divide-border/60">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(1)}
            className="h-7 px-2 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Trang đầu"
          >
            <ChevronsLeft size={13} />
          </button>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="h-7 px-2 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Trang trước"
          >
            <ChevronLeft size={13} />
          </button>

          {pages.map((p, idx) => {
            if (p === '...') {
              return (
                <span key={`dots-${idx}`} className="h-7 px-2 flex items-center justify-center text-xs text-muted-foreground/60 select-none">
                  ...
                </span>
              );
            }
            const isCurrent = p === page;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p as number)}
                className={cn(
                  'h-7 min-w-[28px] px-2.5 flex items-center justify-center text-xs transition-colors',
                  isCurrent
                    ? 'font-bold text-primary bg-primary/10 select-none'
                    : 'font-medium text-foreground/80 hover:text-foreground hover:bg-muted/50'
                )}
              >
                {p}
              </button>
            );
          })}

          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
            className="h-7 px-2 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Trang sau"
          >
            <ChevronRight size={13} />
          </button>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => onPageChange(pageCount)}
            className="h-7 px-2 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Trang cuối"
          >
            <ChevronsRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef[];
  isLoading?: boolean;
  selectedIds: Set<string>;
  onToggleSelection: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  sort?: SortState;
  defaultSort?: SortState;
  onSort?: (column: string | null, direction: SortDirection) => void;
  renderCell: (columnId: string, row: T) => ReactNode;
  renderMobileCard: (row: T, selected: boolean) => ReactNode;
  onRowClick?: (row: T) => void;
  keyExtractor: (row: T) => string;
  density?: 'compact' | 'default' | 'comfortable';
  onResizeColumn?: (id: string, width: number) => void;
  stickyLeftCount?: number;
  loadingText?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  renderSummaryRow?: (columnId: string, data: T[]) => ReactNode;
  hideActions?: boolean;
  showIndex?: boolean;
}

/** Bảng dữ liệu dùng chung (desktop: bảng có cột dính; mobile: danh sách thẻ). */

function getRowValue(row: any, colId: string): any {
  if (!row || typeof row !== 'object') return '';
  if (row[colId] !== undefined && row[colId] !== null) return row[colId];

  switch (colId) {
    case 'partner':
      return row.distributorName || row.partnerName || row.supplierName || row.partner || '';
    case 'debt':
    case 'oldDebt':
      return row.oldDebt ?? row.totalDebt ?? row.currentDebt ?? 0;
    case 'totalPayment':
      return row.totalPayment ?? ((row.totalAmount || 0) + (row.oldDebt || 0));
    case 'salesAmount':
      return row.salesAmount ?? row.totalRevenue ?? 0;
    case 'collectedAmount':
      return row.collectedAmount ?? 0;
    case 'importAmount':
      return row.importAmount ?? 0;
    case 'paidAmount':
      return row.paidAmount ?? 0;
    case 'finalDebt':
      if (row.finalDebt !== undefined) return row.finalDebt;
      if (row.totalDebt !== undefined) return row.totalDebt;
      if (row.currentDebt !== undefined) return row.currentDebt;
      return (row.oldDebt || 0) + (row.salesAmount || row.totalRevenue || row.importAmount || 0) - (row.collectedAmount || row.paidAmount || 0);
    case 'orderDate':
    case 'deliveryDate':
    case 'date':
      return row.orderDate || row.date || row.joinDate || '';
    case 'lastOrder':
      return row.lastOrderDate || '';
    case 'code':
    case 'flowerCode':
      return row.code || row.flowerCode || '';
    case 'name':
    case 'flowerName':
    case 'fullName':
      return row.name || row.flowerName || row.fullName || '';
    case 'totalQuantity':
    case 'stock':
    case 'currentStock':
      return row.totalQuantity ?? row.stock ?? row.currentStock ?? 0;
    case 'totalAmount':
    case 'amount':
      return row.totalAmount ?? row.amount ?? 0;
    case 'itemsSubtotal':
      return row.itemsSubtotal ?? 0;
    case 'shippingFee':
      return row.shippingFee ?? 0;
    case 'discount':
      return row.discount ?? 0;
    case 'salary':
      return row.salary ?? 0;
    case 'remainingDebt':
      return row.remainingDebt ?? row.finalDebt ?? 0;
    default:
      return row[colId] ?? '';
  }
}

function compareValues(a: any, b: any): number {
  if (a === b) return 0;
  if (a === undefined || a === null || a === '') return 1;
  if (b === undefined || b === null || b === '') return -1;

  // Kiểm tra ngày trước (hỗ trợ YYYY-MM-DD, DD/MM/YYYY, ISO...)
  const timeA = parseDateTimestamp(a);
  const timeB = parseDateTimestamp(b);
  if (timeA !== null && timeB !== null) {
    return timeA - timeB;
  }

  const numA = typeof a === 'number' ? a : (typeof a === 'string' && /^-?\d+(\.\d+)?$/.test(a.trim()) ? parseFloat(a) : NaN);
  const numB = typeof b === 'number' ? b : (typeof b === 'string' && /^-?\d+(\.\d+)?$/.test(b.trim()) ? parseFloat(b) : NaN);

  if (!isNaN(numA) && !isNaN(numB)) {
    return numA - numB;
  }

  const strA = String(a).trim();
  const strB = String(b).trim();

  return strA.localeCompare(strB, 'vi', { numeric: true, sensitivity: 'base' });
}

export function DataTable<T>({
  data,
  columns,
  isLoading,
  selectedIds,
  onToggleSelection,
  onToggleAll,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  sort,
  defaultSort,
  onSort,
  renderCell,
  renderMobileCard,
  onRowClick,
  keyExtractor,
  density = 'default',
  onResizeColumn,
  stickyLeftCount = 1,
  loadingText = 'Đang tải dữ liệu',
  emptyTitle,
  emptyDescription,
  emptyAction,
  renderSummaryRow,
  hideActions,
  showIndex,
}: DataTableProps<T>) {
  const hasActions = hideActions !== undefined ? !hideActions : columns.some((c) => c.id === 'actions');
  const visible = useMemo(() => [...columns].filter((c) => c.visible).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [columns]);
  const hasExplicitPinned = useMemo(() => columns.some((c) => c.pinned === true), [columns]);

  // Gom các cột được ghim (pinned) sang phía bên trái
  const dataCols = useMemo(() => {
    const cols = visible.filter((c) => c.id !== 'actions');
    const pinned: ColumnDef[] = [];
    const unpinned: ColumnDef[] = [];
    cols.forEach((c, i) => {
      const isPinned = c.pinned === true || (!hasExplicitPinned && i < stickyLeftCount && c.pinned !== false);
      if (isPinned) {
        pinned.push({ ...c, pinned: true });
      } else {
        unpinned.push(c);
      }
    });
    return [...pinned, ...unpinned];
  }, [visible, hasExplicitPinned, stickyLeftCount]);

  const tableMinWidth = useMemo(
    () => CHECK_COL + dataCols.reduce((sum, c) => sum + (c.width ?? c.minWidth ?? DEFAULT_COL), 0) + (hasActions ? ACTION_COL : 0),
    [dataCols],
  );

  const stickyLeftMap = useMemo(() => {
    const map = new Map<string, number>();
    let left = CHECK_COL - 1;
    for (const c of dataCols) {
      if (c.pinned) {
        map.set(c.id, left);
        left += c.width ?? c.minWidth ?? DEFAULT_COL;
      }
    }
    return map;
  }, [dataCols]);

  const [internalSort, setInternalSort] = useState<SortState>(
    defaultSort || { column: null, direction: null },
  );
  const activeSort = sort ?? internalSort;

  const sortedData = useMemo(() => {
    if (!activeSort.column || !activeSort.direction) return data;
    const colId = activeSort.column;
    const dir = activeSort.direction;

    return [...data].sort((a, b) => {
      const valA = getRowValue(a, colId);
      const valB = getRowValue(b, colId);
      const isAEmpty = valA === undefined || valA === null || valA === '';
      const isBEmpty = valB === undefined || valB === null || valB === '';
      if (isAEmpty && isBEmpty) return 0;
      if (isAEmpty) return 1;
      if (isBEmpty) return -1;
      const res = compareValues(valA, valB);
      return dir === 'asc' ? res : -res;
    });
  }, [data, activeSort]);

  const total = sortedData.length;
  const pageRows = useMemo(() => {
    if (sortedData.length <= pageSize && page === 1) {
      return sortedData;
    }
    return sortedData.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
  }, [sortedData, page, pageSize]);
  const pageIds = pageRows.map(keyExtractor);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const someChecked = pageIds.some((id) => selectedIds.has(id)) && !allChecked;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [shadows, setShadows] = useState({ left: false, right: false });
  const updateShadows = useCallback(() => {
    const el = scrollRef.current;
    if (el) setShadows({ left: el.scrollLeft > 2, right: el.scrollLeft < el.scrollWidth - el.clientWidth - 2 });
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateShadows();
    el.addEventListener('scroll', updateShadows, { passive: true });
    const ro = new ResizeObserver(updateShadows);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateShadows);
      ro.disconnect();
    };
  }, [updateShadows, isLoading]);


  const cycleSort = useCallback(
    (id: string) => {
      let nextDir: SortDirection = 'desc';
      if (activeSort.column === id) {
        if (activeSort.direction === 'desc') nextDir = 'asc';
        else if (activeSort.direction === 'asc') nextDir = null;
        else nextDir = 'desc';
      } else {
        nextDir = 'desc';
      }

      const nextCol = nextDir === null ? null : id;
      if (onSort) {
        onSort(nextCol, nextDir);
      } else {
        setInternalSort({ column: nextCol, direction: nextDir });
        onPageChange?.(1);
      }
    },
    [onSort, activeSort, onPageChange],
  );

  const resizing = useRef<{ colId: string; startX: number; startW: number } | null>(null);
  const startResize = useCallback(
    (e: React.MouseEvent, colId: string, startW: number) => {
      e.preventDefault();
      e.stopPropagation();
      resizing.current = { colId, startX: e.clientX, startW };
      const onMove = (ev: MouseEvent) => {
        if (!resizing.current) return;
        onResizeColumn?.(resizing.current.colId, Math.max(resizing.current.startW + ev.clientX - resizing.current.startX, 50));
      };
      const onUp = () => {
        resizing.current = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [onResizeColumn],
  );

  const py = density === 'compact' ? 'py-1.5' : density === 'comfortable' ? 'py-3' : 'py-2';

  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-card overflow-hidden" aria-live="polite" aria-busy="true" aria-label={loadingText}>
        <div className="shrink-0 py-3 px-3 sm:px-4 border-b border-border/50 bg-muted/20">
          <Spinner text={loadingText} centered />
        </div>
        <div className="hidden md:block flex-1 min-h-0 overflow-hidden">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="w-[44px] px-3 py-2 border-b border-border">
                  <div className="w-4 h-4 bg-muted rounded animate-pulse" />
                </th>
                {dataCols.map((c) => (
                  <th key={c.id} className="px-4 py-2 border-b border-border min-w-0" style={columnStyle(c)}>
                    <div className="h-3 w-16 bg-muted rounded animate-pulse" />
                  </th>
                ))}
                <th className="w-[80px] px-3 py-2 border-b border-border">
                  <div className="h-3 w-12 bg-muted rounded animate-pulse mx-auto" />
                </th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, r) => (
                <tr key={r} className="[&>td]:border-b [&>td]:border-border">
                  <td className="px-3 py-2.5">
                    <div className="w-4 h-4 bg-muted/60 rounded animate-pulse" />
                  </td>
                  {dataCols.map((c) => (
                    <td key={c.id} className="px-4 py-2.5">
                      <div className="space-y-1.5">
                        <div className={cn('h-3 bg-muted/60 rounded animate-pulse', r % 2 === 0 ? 'w-3/4' : 'w-1/2')} />
                        {c.id === 'ho_ten' && <div className="h-2.5 w-1/3 bg-muted/40 rounded animate-pulse" />}
                      </div>
                    </td>
                  ))}
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1 justify-center">
                      {[1, 2, 3].map((k) => (
                        <div key={k} className="w-6 h-6 bg-muted/40 rounded animate-pulse" />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="md:hidden flex-1 space-y-3 px-3 pt-1 overflow-hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-card rounded-xl border border-border p-3.5 animate-pulse">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-11 h-11 rounded-lg bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-2/3 bg-muted rounded" />
                  <div className="h-2.5 w-1/3 bg-muted/60 rounded" />
                </div>
              </div>
              <div className="h-12 bg-muted/30 rounded-lg" />
            </div>
          ))}
        </div>
        <div className="border-t border-border bg-card px-3 py-1.5 flex items-center justify-between shrink-0">
          <div className="h-3 w-24 bg-muted rounded animate-pulse" />
          <div className="h-7 w-28 bg-muted rounded animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      <div className="hidden md:block flex-1 min-h-0 relative">
        <div
          className={cn(
            'absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-card/80 to-transparent z-[4] pointer-events-none transition-opacity',
            shadows.left ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div
          className={cn(
            'absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-card/80 to-transparent z-[4] pointer-events-none transition-opacity',
            shadows.right ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div ref={scrollRef} className="h-full overflow-auto custom-scrollbar" style={{ overscrollBehavior: 'contain' }}>
          <table className="text-sm text-left border-separate border-spacing-0" style={{ minWidth: tableMinWidth, width: '100%' }}>
            <thead className="sticky top-0 z-[2]">
              {renderSummaryRow && (
                <tr className="bg-muted/60 border-b border-border/80">
                  <th
                    className="sticky left-0 z-[3] px-3 py-1.5 border-b border-r border-border/80 text-center text-xs font-medium bg-muted border-l-2 border-l-primary/50 text-muted-foreground"
                    style={{ width: CHECK_COL, minWidth: CHECK_COL, maxWidth: CHECK_COL }}
                  >
                    <div className="flex items-center justify-center gap-1">
                      <Sigma size={12} className="opacity-70 shrink-0" aria-hidden />
                      <span className="tabular-nums">{data.length > 0 ? data.length : '—'}</span>
                    </div>
                  </th>
                  {dataCols.map((c) => {
                    const isSticky = stickyLeftMap.has(c.id);
                    const style: CSSProperties = columnStyle(c);
                    if (isSticky) style.left = stickyLeftMap.get(c.id);
                    const align = c.align || 'left';
                    const justifyClass = align === 'center' ? 'justify-center text-center' : align === 'right' ? 'justify-end text-right' : 'justify-start text-left';
                    return (
                      <th
                        key={c.id}
                        className={cn(
                          'px-4 py-1.5 text-xs font-medium text-muted-foreground border-b border-border/80 whitespace-nowrap',
                          isSticky && 'sticky z-[3] bg-muted border-r border-border/80',
                        )}
                        style={style}
                      >
                        <div className={cn('min-w-0 overflow-hidden text-ellipsis flex items-center', justifyClass)}>
                          {renderSummaryRow(c.id, data)}
                        </div>
                      </th>
                    );
                  })}
                  {hasActions && (
                    <th className="sticky right-0 z-[3] px-3 py-1.5 bg-muted border-b border-l border-border/80 text-center" style={{ width: ACTION_COL }}>
                      {renderSummaryRow('actions', data)}
                    </th>
                  )}
                </tr>
              )}
              <tr className="bg-muted border-b border-border">
                <th
                  className="sticky left-0 z-[3] px-2 py-2 bg-muted border-b border-r border-border text-center text-xs font-semibold text-foreground/70"
                  style={{ width: CHECK_COL, minWidth: CHECK_COL, maxWidth: CHECK_COL }}
                >
                  {showIndex ? (
                    <span>STT</span>
                  ) : (
                    <div className="flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={(el) => {
                          if (el) el.indeterminate = someChecked;
                        }}
                        onChange={() => onToggleAll(pageIds)}
                        className="w-4 h-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer accent-primary transition-all"
                      />
                    </div>
                  )}
                </th>
                {dataCols.map((c) => {
                  const isSticky = stickyLeftMap.has(c.id);
                  const sorted = activeSort.column === c.id;
                  const sortable = c.id !== 'actions';
                  const style: CSSProperties = columnStyle(c);
                  if (isSticky) style.left = stickyLeftMap.get(c.id);
                  const align = c.align || 'left';
                  const justifyClass = align === 'center' ? 'justify-center text-center' : align === 'right' ? 'justify-end text-right' : 'justify-start text-left';

                  return (
                    <th
                      key={c.id}
                      onClick={() => sortable && cycleSort(c.id)}
                      title={sortable ? `Bấm để sắp xếp theo ${c.label} (Lớn ➔ Bé / Bé ➔ Lớn)` : undefined}
                      className={cn(
                        'px-4 py-2 font-semibold text-foreground/80 border-b border-border text-xs whitespace-nowrap transition-colors select-none relative',
                        isSticky && 'sticky z-[3] bg-muted border-r border-border shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]',
                        sortable && 'cursor-pointer hover:bg-muted/80 hover:text-foreground group',
                      )}
                      style={style}
                    >
                      <div className={cn('flex items-center gap-1.5', justifyClass)}>
                        <span>{c.label}</span>
                        {c.pinned && (
                          <Pin size={11} className="text-amber-500 fill-amber-500/40 rotate-45 shrink-0" />
                        )}
                        {sortable && (
                          <span
                            className={cn(
                              'inline-flex items-center justify-center p-0.5 rounded transition-all',
                              sorted
                                ? 'opacity-100 bg-primary/10 text-primary font-bold'
                                : 'opacity-0 group-hover:opacity-60 text-muted-foreground',
                            )}
                          >
                            {sorted && activeSort.direction === 'desc' ? (
                              <ArrowDown size={13} className="text-primary stroke-[2.5]" />
                            ) : sorted && activeSort.direction === 'asc' ? (
                              <ArrowUp size={13} className="text-primary stroke-[2.5]" />
                            ) : (
                              <ArrowDown size={11} className="opacity-50" />
                            )}
                          </span>
                        )}
                      </div>
                      {onResizeColumn && (
                        <div
                          role="separator"
                          aria-orientation="vertical"
                          onMouseDown={(e) => {
                            const th = e.currentTarget.parentElement;
                            startResize(e, c.id, th?.offsetWidth ?? c.minWidth ?? 100);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize z-10 group/handle hover:bg-primary/30 active:bg-primary/50 transition-colors"
                        >
                          <div className="absolute right-[2px] top-1/2 -translate-y-1/2 w-[1px] h-3.5 bg-border group-hover/handle:bg-primary/60 transition-colors" />
                        </div>
                      )}
                    </th>
                  );
                })}
                {hasActions && (
                  <th
                    className="sticky right-0 z-[3] px-3 py-2 bg-muted border-b border-l border-border text-center font-semibold text-foreground/80 text-xs"
                    style={{ width: ACTION_COL }}
                  >
                    Thao tác
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td colSpan={dataCols.length + 1 + (hasActions ? 1 : 0)} className="py-16 text-center bg-card">
                    <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
                  </td>
                </tr>
              ) : (
                pageRows.map((row, index) => {
                  const id = keyExtractor(row);
                  const selected = selectedIds.has(id);
                  const rowCls = selected ? 'bg-primary/[0.03] hover:bg-primary/[0.06]' : 'bg-card even:bg-muted/15 hover:bg-accent transition-all duration-150';
                  const stickyCls = selected ? 'bg-accent group-hover:bg-accent' : 'bg-card group-hover:bg-accent transition-all duration-150';
                  return (
                    <tr key={id} onClick={() => onRowClick?.(row)} className={`group cursor-pointer ${rowCls} [&>td]:border-b [&>td]:border-border`}>
                      <td
                        className={`sticky left-0 z-[1] px-2 ${py} border-r border-border text-center ${stickyCls}`}
                        style={{ width: CHECK_COL, minWidth: CHECK_COL, maxWidth: CHECK_COL }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {showIndex ? (
                          <span className="text-xs font-medium text-muted-foreground tabular-nums">
                            {(page - 1) * pageSize + index + 1}
                          </span>
                        ) : (
                          <div className="flex items-center justify-center">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => onToggleSelection(id)}
                              className="w-4 h-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer accent-primary transition-all"
                            />
                          </div>
                        )}
                      </td>
                      {dataCols.map((c) => {
                        const isSticky = stickyLeftMap.has(c.id);
                        const style: CSSProperties = columnStyle(c);
                        if (isSticky) style.left = stickyLeftMap.get(c.id);
                        const align = c.align || 'left';
                        const isWrap = c.wrap === true;
                        const alignClass = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';

                        return (
                          <td
                            key={c.id}
                            className={cn(
                              `px-4 ${py}`,
                              alignClass,
                              isSticky && `sticky z-[1] border-r border-border/60 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] ${stickyCls}`,
                            )}
                            style={style}
                          >
                            <div
                              className={cn(
                                'min-w-0 max-w-full',
                                isWrap ? 'whitespace-normal break-words line-clamp-none' : 'whitespace-nowrap overflow-hidden text-ellipsis',
                                align === 'center' && 'mx-auto flex justify-center items-center',
                                align === 'right' && 'ml-auto flex justify-end items-center',
                              )}
                            >
                              {renderCell(c.id, row)}
                            </div>
                          </td>
                        );
                      })}
                      {hasActions && (
                        <td className={`sticky right-0 z-[1] px-2 ${py} border-l border-border/50 text-center ${stickyCls}`} onClick={(e) => e.stopPropagation()}>
                          {renderCell('actions', row)}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="md:hidden flex-1 min-h-0 space-y-3 overflow-y-auto pb-3 px-3 pt-1">
        {data.length === 0 ? (
          <div className="py-12">
            <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
          </div>
        ) : (
          pageRows.map((row) => {
            const id = keyExtractor(row);
            return (
              <div key={id} className="transition-all active:scale-[0.98]">
                {renderMobileCard(row, selectedIds.has(id))}
              </div>
            );
          })
        )}
      </div>

      <TablePagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        selectedCount={selectedIds.size}
      />
    </div>
  );
}
