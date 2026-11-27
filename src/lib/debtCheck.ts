import type { DebtDailyRecord, Order } from '@/types/hoaKhangThanh';
import { getOrderTotal, useDebtStore } from '@/stores/hoaKhangThanhStore';

export interface OverdueDebtRecord {
  id: string;
  code: string;
  orderDate: string;
  daysAgo: number;
  totalAmount: number;
  allocatedPayment: number;
  remainingDebt: number;
}

export interface CustomerOverdueCheckResult {
  hasOverdueUnpaidDebt: boolean;
  overdueOrders: OverdueDebtRecord[];
  totalOverdueDebt: number;
  totalPastPaid: number;
  totalPastOrdersAmount: number;
  totalOverdueOrdersDebt: number;
  earliestUnpaidOrder?: OverdueDebtRecord;
}

/**
 * Phân tích chuỗi ngày hỗ trợ cả ISO (YYYY-MM-DD) và chuẩn Việt Nam (DD/MM/YYYY).
 */
function parseDateClean(str: string): Date | null {
  if (!str) return null;
  const trimmed = str.trim();
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      return new Date(year, month, day);
    }
  }
  const iso = trimmed.split('T')[0];
  const parts = iso.split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    return new Date(year, month, day);
  }
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Tính số ngày cách biệt giữa 2 ngày (chỉ tính theo ngày, loại bỏ giờ phút).
 */
export function getDaysDifference(dateStr: string, asOfDateStr?: string): number {
  if (!dateStr) return 0;
  const d1 = parseDateClean(dateStr);
  const d2 = asOfDateStr ? parseDateClean(asOfDateStr) : new Date();
  if (!d1 || !d2) return 0;
  const d1Utc = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const d2Utc = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
  return Math.floor((d2Utc - d1Utc) / (1000 * 60 * 60 * 24));
}

// ---------- Chỉ mục có bộ nhớ đệm (dựng lại khi mảng dữ liệu đổi) ----------
// Trước đây mỗi khách hàng lại duyệt TOÀN BỘ đơn + sổ công nợ → trang Đơn hàng đứng 1–2 giây.
type IdxMaps = { byId: Map<string, number[]>; byName: Map<string, number[]> };
const lower = (v?: string) => (v ? v.trim().toLowerCase() : '');
function addIdx(m: Map<string, number[]>, k: string, i: number) {
  if (!k) return;
  const list = m.get(k);
  if (list) list.push(i);
  else m.set(k, [i]);
}
const orderIdxCache = new WeakMap<Order[], IdxMaps>();
function orderIdx(orders: Order[]): IdxMaps {
  let idx = orderIdxCache.get(orders);
  if (!idx) {
    idx = { byId: new Map(), byName: new Map() };
    orders.forEach((o, i) => {
      addIdx(idx!.byId, o.distributorId || '', i);
      addIdx(idx!.byName, lower(o.distributorName), i);
    });
    orderIdxCache.set(orders, idx);
  }
  return idx;
}
const nppDebtIdxCache = new WeakMap<DebtDailyRecord[], IdxMaps>();
function nppDebtIdx(records: DebtDailyRecord[]): IdxMaps {
  let idx = nppDebtIdxCache.get(records);
  if (!idx) {
    idx = { byId: new Map(), byName: new Map() };
    records.forEach((r, i) => {
      if (r.partnerType !== 'npp') return;
      addIdx(idx!.byId, r.partnerId || '', i);
      addIdx(idx!.byName, lower(r.partnerName), i);
    });
    nppDebtIdxCache.set(records, idx);
  }
  return idx;
}
/** Lấy các phần tử theo chỉ số (hợp 2 danh sách), giữ đúng thứ tự gốc trong mảng */
function pickByIdx<T>(arr: T[], a?: number[], b?: number[]): T[] {
  if (!a?.length && !b?.length) return [];
  const set = new Set<number>([...(a || []), ...(b || [])]);
  return Array.from(set)
    .sort((x, y) => x - y)
    .map((i) => arr[i]);
}

/**
 * Kiểm tra công nợ quá hạn 4 ngày của khách hàng theo nguyên tắc FIFO (Khoản nợ cũ nhất trả trước).
 *
 * Quy tắc do người dùng yêu cầu:
 * - Xét các đơn hàng / khoản nợ đã tạo >= 4 ngày trước.
 * - Tổng số tiền khách đã thanh toán qua mọi kênh (gồm cả trả trực tiếp trên đơn và tiền thu nợ từ sổ công nợ)
 *   được phân bổ lần lượt từ đơn cũ nhất đến đơn mới nhất (FIFO).
 * - Nếu Tổng tiền khách đã trả >= Tổng nợ của các đơn cũ sau 4 ngày (ví dụ nợ sau 4 ngày có 12tr, khách trả 15tr > 12tr)
 *   => ĐÃ ĐỦ, KHÔNG BÁO LÀ CHƯA TRẢ NỢ (OK).
 * - Nếu Tổng tiền khách trả không đủ bù đắp các đơn đã quá 4 ngày (thiếu tiền)
 *   => Báo là CHƯA TRẢ NỢ (QUÁ 4 NGÀY).
 */
export function checkCustomerOverdueDebt(
  customerId: string,
  customerName: string,
  allOrders: Order[],
  currentOrderId?: string,
  asOfDateStr?: string,
  debtRecords?: DebtDailyRecord[],
): CustomerOverdueCheckResult {
  if (!customerId && !customerName) {
    return {
      hasOverdueUnpaidDebt: false,
      overdueOrders: [],
      totalOverdueDebt: 0,
      totalPastPaid: 0,
      totalPastOrdersAmount: 0,
      totalOverdueOrdersDebt: 0,
    };
  }

  const cleanName = customerName.trim().toLowerCase();

  // 1. Các đơn hàng trước đó của khách hàng này (loại trừ đơn hàng đang tạo / sửa hiện tại) — tra chỉ mục
  const oIdx = orderIdx(allOrders);
  const pastOrders = pickByIdx(
    allOrders,
    customerId ? oIdx.byId.get(customerId) : undefined,
    cleanName ? oIdx.byName.get(cleanName) : undefined,
  ).filter((o) => !(currentOrderId && o.id === currentOrderId));

  // Lấy các bản ghi công nợ từ useDebtStore
  const allDebtRecords =
    debtRecords ||
    (typeof window !== 'undefined' ? useDebtStore.getState().records : []);

  // Sổ công nợ NPP của khách hàng này (tra chỉ mục: theo id hoặc tên)
  const dIdx = nppDebtIdx(allDebtRecords);
  const customerRecords = pickByIdx(
    allDebtRecords,
    customerId ? dIdx.byId.get(customerId) : undefined,
    cleanName ? dIdx.byName.get(cleanName) : undefined,
  );

  // Tìm các chứng từ thanh toán (Phiếu thu / Thu nợ) của khách hàng từ sổ công nợ
  const orderCodes = new Set(pastOrders.map((o) => o.code));
  const orderByCode = new Map<string, Order>();
  pastOrders.forEach((o) => {
    if (o.code && !orderByCode.has(o.code)) orderByCode.set(o.code, o);
  });
  const debtStorePayments = customerRecords.filter((r) => {

    // Khoản thanh toán: có type === 'thu' hoặc decreaseAmount > 0
    const isThu = r.type === 'thu' || (r.decreaseAmount !== undefined && r.decreaseAmount > 0);
    if (!isThu) return false;

    // Tránh tính 2 lần nếu chứng từ tham chiếu đến đơn hàng đã có sẵn paidAmount > 0
    if (r.referenceCode && orderCodes.has(r.referenceCode)) {
      const linkedOrder = orderByCode.get(r.referenceCode);
      if (linkedOrder && (linkedOrder.paidAmount || 0) > 0) {
        return false;
      }
    }
    return true;
  });

  const totalPastPaidFromOrders = pastOrders.reduce((sum, o) => sum + (o.paidAmount || 0), 0);
  const totalDebtStorePayments = debtStorePayments.reduce((sum, r) => {
    const amt = r.amount !== undefined ? r.amount : (r.decreaseAmount || 0);
    return sum + (amt || 0);
  }, 0);

  // Tổng tiền khách đã thanh toán qua mọi kênh (Đơn hàng + Thu nợ từ sổ công nợ)
  const totalPastPaid = totalPastPaidFromOrders + totalDebtStorePayments;
  const totalPastOrdersAmount = pastOrders.reduce((sum, o) => sum + getOrderTotal(o), 0);

  // 2. Tìm thêm các khoản nợ thủ công (nếu có trong useDebtStore với type === 'chi' không thuộc đơn hàng nào)
  const manualDebtRecords = customerRecords.filter((r) => {

    const isDebt = r.type === 'chi' || (r.increaseAmount !== undefined && r.increaseAmount > 0);
    if (!isDebt) return false;
    if (r.referenceCode && orderCodes.has(r.referenceCode)) return false;
    if (r.id?.startsWith('debt-dh-') || r.id?.startsWith('debt-order-')) return false;
    return true;
  });

  // Hợp nhất danh sách các nghĩa vụ nợ (Đơn hàng + Bán nợ thủ công)
  type DebtItem = {
    id: string;
    code: string;
    orderDate: string;
    totalAmount: number;
  };

  const allDebtItems: DebtItem[] = [
    ...pastOrders.map((o) => ({
      id: o.id,
      code: o.code,
      orderDate: o.orderDate,
      totalAmount: getOrderTotal(o),
    })),
    ...manualDebtRecords.map((r) => ({
      id: r.id,
      code: r.referenceCode || `CN-${r.id.slice(-6)}`,
      orderDate: r.date,
      totalAmount: r.amount !== undefined ? r.amount : (r.increaseAmount || 0),
    })),
  ];

  if (allDebtItems.length === 0) {
    return {
      hasOverdueUnpaidDebt: false,
      overdueOrders: [],
      totalOverdueDebt: 0,
      totalPastPaid,
      totalPastOrdersAmount,
      totalOverdueOrdersDebt: 0,
    };
  }

  // Sắp xếp theo thời gian tăng dần (cũ nhất đứng trước -> mới nhất đứng sau)
  const sortedDebtItems = [...allDebtItems].sort((a, b) => {
    const da = parseDateClean(a.orderDate || '')?.getTime() || 0;
    const db = parseDateClean(b.orderDate || '')?.getTime() || 0;
    if (da !== db) return da - db;
    return (a.code || '').localeCompare(b.code || '');
  });

  // 3. Phân bổ tiền thanh toán theo thứ tự FIFO (từ khoản cũ nhất đến khoản mới nhất)
  let paymentPool = totalPastPaid;
  const overdueOrders: OverdueDebtRecord[] = [];
  let totalOverdueOrdersDebt = 0;

  for (const item of sortedDebtItems) {
    const itemAmount = item.totalAmount || 0;
    const daysAgo = getDaysDifference(item.orderDate, asOfDateStr);

    if (daysAgo >= 4) {
      totalOverdueOrdersDebt += itemAmount;
    }

    const allocated = Math.min(itemAmount, paymentPool);
    const remaining = Math.max(0, itemAmount - allocated);
    paymentPool = Math.max(0, paymentPool - itemAmount);

    // Nếu đơn hàng / chứng từ nợ đã qua >= 4 ngày và vẫn còn số tiền nợ chưa được thanh toán
    if (daysAgo >= 4 && remaining > 0) {
      overdueOrders.push({
        id: item.id,
        code: item.code,
        orderDate: item.orderDate,
        daysAgo,
        totalAmount: itemAmount,
        allocatedPayment: allocated,
        remainingDebt: remaining,
      });
    }
  }

  const hasOverdueUnpaidDebt = overdueOrders.length > 0;
  const totalOverdueDebt = overdueOrders.reduce((sum, o) => sum + o.remainingDebt, 0);

  return {
    hasOverdueUnpaidDebt,
    overdueOrders,
    totalOverdueDebt,
    totalPastPaid,
    totalPastOrdersAmount,
    totalOverdueOrdersDebt,
    earliestUnpaidOrder: overdueOrders[0],
  };
}
