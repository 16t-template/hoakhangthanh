import { pauseModuleAudit } from '@/stores/moduleAuditStore';
import { GOOGLE_SHEETS_CONFIG } from '@/config/googleSheetsConfig';
import { getActiveSpreadsheetId, sheetsRequestHeaders, spreadsheetUrlOf } from '@/stores/appSettingsStore';
import { fromSheetDate } from '@/lib/sheetDate';
import {
  useCashStore,
  useDebtStore,
  useDistributorStore,
  useEmployeeStore,
  useFlowerStore,
  useInventoryStore,
  normalizeOrders,
  useOrderStore,
  useSupplierOrderStore,
  useSupplierStore,
  syncAllOrdersToDebtRecords,
  recalcAllDistributorsDebts,
  recalcAllSuppliersDebts,
} from '@/stores/hoaKhangThanhStore';
import type {
  CashTransaction,
  DebtDailyRecord,
  Distributor,
  Employee,
  Flower,
  InventoryItem,
  Order,
  OrderItem,
  Supplier,
  SupplierOrder,
} from '@/types/hoaKhangThanh';

export interface SheetStatusInfo {
  id: number;
  title: string;
  rowCount: number;
  columnCount: number;
}

export interface GoogleSheetsStatus {
  connected: boolean;
  spreadsheetId: string;
  title: string;
  url: string;
  clientEmail?: string;
  sheets: SheetStatusInfo[];
  error?: string;
}

export interface SyncResult {
  success: boolean;
  totalUpdatedCells?: number;
  updatedSheetsCount?: number;
  timestamp?: string;
  error?: string;
}


/**
 * Chuyển đổi an toàn giá trị số từ ô Google Sheets thành số nguyên / thực
 * Hỗ trợ các định dạng tiền Việt Nam (VD: "11.450.000", "15,570,000", "4.740.000 đ", " 15.000.000 ")
 * Tránh lỗi Number("11.450.000") trả về NaN dẫn tới công nợ cũ bị hiển thị 0
 */
export function parseSheetNumber(val: unknown): number {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const str = String(val).trim();
  if (!str) return 0;

  let cleaned = str.replace(/\s+/g, '').replace(/[₫đVNDvnd$]/g, '');
  if (!cleaned) return 0;

  if (cleaned.includes('.') && !cleaned.includes(',')) {
    if ((cleaned.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(cleaned)) {
      cleaned = cleaned.replace(/\./g, '');
    }
  } else if (cleaned.includes('.') && cleaned.includes(',')) {
    if (cleaned.indexOf('.') < cleaned.indexOf(',')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    if ((cleaned.match(/,/g) || []).length > 1 || /,\d{3}$/.test(cleaned)) {
      cleaned = cleaned.replace(/,/g, '');
    } else {
      cleaned = cleaned.replace(',', '.');
    }
  }

  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

export function isNumericString(val: unknown): boolean {
  if (val === undefined || val === null || val === '') return false;
  if (typeof val === 'number') return !isNaN(val);
  const s = String(val).trim().replace(/\s+/g, '').replace(/[₫đVNDvnd$.,]/g, '');
  return s.length > 0 && !isNaN(Number(s));
}

/**
 * Kiểm tra trạng thái kết nối tới Google Spreadsheet
 */
export async function checkGoogleSheetsConnection(spreadsheetId?: string): Promise<GoogleSheetsStatus> {
  // spreadsheetId: dùng để kiểm tra thử 1 sheet mới ở module Cài đặt trước khi lưu
  const targetId = spreadsheetId || getActiveSpreadsheetId();
  try {
    const res = await fetch('/api/google-sheets/status', { headers: sheetsRequestHeaders({}, targetId) });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return {
        connected: false,
        spreadsheetId: targetId,
        title: GOOGLE_SHEETS_CONFIG.title,
        url: spreadsheetUrlOf(targetId),
        sheets: [],
        error: data.error ? JSON.stringify(data.error) : 'Không thể kết nối Google Sheets',
      };
    }
    return data;
  } catch (err: any) {
    return {
      connected: false,
      spreadsheetId: targetId,
      title: GOOGLE_SHEETS_CONFIG.title,
      url: spreadsheetUrlOf(targetId),
      sheets: [],
      error: err?.message || 'Lỗi mạng khi kiểm tra Google Sheets',
    };
  }
}

export type SyncableModule =
  | 'orders'
  | 'flowers'
  | 'distributors'
  | 'suppliers'
  | 'supplierOrders'
  | 'debtRecords'
  | 'transactions'
  | 'inventory'
  | 'employees';

/**
 * Đẩy dữ liệu từ store trên Web lên Google Sheets (hỗ trợ đồng bộ mục tiêu từng module hoặc toàn bộ 11 sheets)
 */
export async function syncAllToGoogleSheets(modules?: SyncableModule[]): Promise<SyncResult> {
  try {
    const shouldSync = (m: SyncableModule) => !modules || modules.length === 0 || modules.includes(m);

    const payload: Record<string, any> = {};

    if (shouldSync('orders')) {
      payload.orders = useOrderStore.getState().orders;
    }
    if (shouldSync('flowers')) {
      payload.flowers = useFlowerStore.getState().flowers;
    }
    if (shouldSync('distributors')) {
      payload.distributors = useDistributorStore.getState().distributors;
    }
    if (shouldSync('suppliers')) {
      payload.suppliers = useSupplierStore.getState().suppliers;
    }
    if (shouldSync('supplierOrders')) {
      // LOẠI BỎ imageUrl (ảnh base64 nặng hàng megabyte) trước khi gửi lên API để tránh lỗi 413 Request Entity Too Large
      const rawSupplierOrders = useSupplierOrderStore.getState().orders;
      payload.supplierOrders = rawSupplierOrders.map((so) => {
        if (!so.imageUrl) return so;
        const { imageUrl: _, ...cleanOrder } = so;
        return cleanOrder;
      });
    }
    if (shouldSync('debtRecords')) {
      payload.debtRecords = useDebtStore.getState().records;
    }
    if (shouldSync('transactions')) {
      payload.transactions = useCashStore.getState().transactions;
    }
    if (shouldSync('inventory')) {
      payload.inventory = useInventoryStore.getState().inventory;
    }
    if (shouldSync('employees')) {
      payload.employees = useEmployeeStore.getState().employees;
    }

    const res = await fetch('/api/google-sheets/sync-all', {
      method: 'POST',
      headers: sheetsRequestHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let result: any = null;
    try {
      result = JSON.parse(text);
    } catch {
      return {
        success: false,
        error: res.status === 413
          ? 'Dung lượng gửi lên quá lớn (Request Entity Too Large). Hệ thống đã tự động lọc bớt ảnh nặng.'
          : `Máy chủ phản hồi mã ${res.status} (${res.statusText}): ${text.slice(0, 100)}`,
      };
    }

    if (!res.ok || !result.success) {
      return {
        success: false,
        error: result.error
          ? typeof result.error === 'string'
            ? result.error
            : JSON.stringify(result.error)
          : 'Không thể đồng bộ lên Google Sheets',
      };
    }

    return {
      success: true,
      totalUpdatedCells: result.totalUpdatedCells,
      updatedSheetsCount: result.updatedSheetsCount,
      timestamp: result.timestamp,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Lỗi mạng khi đồng bộ Google Sheets',
    };
  }
}

/**
 * Tải toàn bộ dữ liệu từ Google Sheets về cập nhật vào tất cả Store trên web
 */
export async function pullFromGoogleSheets(): Promise<{ success: boolean; message: string }> {
  let resumeAudit: (() => void) | undefined;
  try {
    const res = await fetch('/api/google-sheets/pull-all', { headers: sheetsRequestHeaders() });
    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.error ? JSON.stringify(result.error) : 'Lỗi khi tải từ Google Sheets');
    }

    resumeAudit = pauseModuleAudit();

    const valueRanges: Array<{ range: string; values?: any[][] }> = result.valueRanges || [];

    // Build lookup: title → rows
    const sheetMap: Record<string, any[][]> = {};
    for (const vr of valueRanges) {
      const title = (vr.range || '').split('!')[0].replace(/'/g, '');
      sheetMap[title] = (vr.values || []).filter((r) => r.some((c) => c !== '' && c !== undefined));
    }

    const counts: Record<string, number> = {};

    // --- 1. DANH_SACH_HOA ---
    const flowerRows = sheetMap['DANH_SACH_HOA'] || [];
    if (flowerRows.length > 0) {
      const existingFlowers = useFlowerStore.getState().flowers;
      const existingFlowerMap = new Map(existingFlowers.map((f) => [f.code, f]));
      const existingFlowerNameMap = new Map(existingFlowers.map((f) => [f.name, f]));

      const flowers: Flower[] = flowerRows.filter((r) => r[0] && r[1]).map((r, idx) => {
        const code = String(r[0] || '').trim();
        const name = String(r[1] || '').trim();
        const prev = existingFlowerMap.get(code) || existingFlowerNameMap.get(name);

        const cleanOrigin = (prev?.origin === 'Đà Lạt' || !prev?.origin) ? '' : prev.origin;
        const cleanColor = (prev?.color === 'Đa sắc' || !prev?.color) ? '' : prev.color;
        const cleanStock = (prev?.stock === 100 || prev?.stock === 200 || !prev?.stock) ? 0 : prev.stock;
        const cleanCategory = r[4] ? String(r[4]).trim() : (prev?.category === 'Khác' ? '' : (prev?.category || ''));
        const cleanUnit = r[3] ? String(r[3]).trim() : (prev?.unit || '');

        return {
          id: prev?.id || `hoa-sync-${idx + 1}`,
          code,
          name,
          customName: r[2] ? String(r[2]).trim() : (prev?.customName || ''),
          unit: cleanUnit,
          category: cleanCategory,
          costPrice: prev?.costPrice || 0,
          wholesalePrice: prev?.wholesalePrice || 0,
          stock: cleanStock,
          origin: cleanOrigin,
          color: cleanColor,
          status: (r[5] === 'Tạm hết' ? 'out_of_stock' : (r[5] ? 'active' : (prev?.status || 'active'))) as Flower['status'],
          description: String(r[6] || prev?.description || '').trim(),
        };
      });
      useFlowerStore.setState({ flowers });
      counts['hoa'] = flowers.length;
    }

    // --- 2. NHA_PHAN_PHOI ---
    // Cột: id(mã NPP), Tên, SĐT, Địa chỉ, Công nợ cũ, Tổng tiền mua, Đã thanh toán, Công nợ hiện tại,
    //      Ngày lên đơn gần nhất, Số ngày chưa mua, Cảnh báo nợ, Trạng thái
    // (Sheet không còn cột "Người liên hệ", "Khu vực": giữ giá trị đang có trên web)
    const nppRows = sheetMap['NHA_PHAN_PHOI'] || [];
    if (nppRows.length > 0) {
      const existingNpp = useDistributorStore.getState().distributors;
      const existingNppMap = new Map(existingNpp.map((d) => [d.code, d]));
      const existingNppNameMap = new Map(existingNpp.map((d) => [d.name, d]));

      const distributors: Distributor[] = nppRows.filter((r) => r[0] && r[1]).map((r, idx) => {
        const code = String(r[0] || '').trim();
        const name = String(r[1] || '').trim();
        const prev = existingNppMap.get(code) || existingNppNameMap.get(name);
        const oldDebt = parseSheetNumber(r[4]);
        const totalRevenue = parseSheetNumber(r[5]);
        const collectedAmount = parseSheetNumber(r[6]);
        const currentDebt = parseSheetNumber(r[7]) || (oldDebt + totalRevenue - collectedAmount);

        return {
          id: prev?.id || `npp-sync-${idx + 1}`,
          code,
          name,
          representative: prev?.representative || '',
          phone: String(r[2] || '').trim() || prev?.phone || '',
          email: prev?.email || '',
          address: String(r[3] || '').trim() || prev?.address || '',
          region: prev?.region || 'Miền Nam',
          tier: prev?.tier || 'VIP 1 (Kim Cương)',
          discount: prev?.discount || 0,
          oldDebt,
          totalRevenue,
          salesAmount: totalRevenue,
          collectedAmount,
          currentDebt,
          finalDebt: currentDebt,
          status: 'active' as const,
        };
      });
      useDistributorStore.setState({ distributors });
      counts['npp'] = distributors.length;
    }

    // --- 3. NHA_CUNG_CAP ---
    const nccRows = sheetMap['NHA_CUNG_CAP'] || [];
    if (nccRows.length > 0) {
      const existingNcc = useSupplierStore.getState().suppliers;
      const existingNccMap = new Map(existingNcc.map((s) => [s.code, s]));
      const existingNccNameMap = new Map(existingNcc.map((s) => [s.name, s]));

      const suppliers: Supplier[] = nccRows.filter((r) => r[0] && r[1]).map((r, idx) => {
        const code = String(r[0] || '').trim();
        const name = String(r[1] || '').trim();
        const prev = existingNccMap.get(code) || existingNccNameMap.get(name);
        const oldDebt = parseSheetNumber(r[6]);
        const importAmount = parseSheetNumber(r[7]);
        const paidAmount = parseSheetNumber(r[8]);
        const totalDebt = parseSheetNumber(r[9]) || (oldDebt + importAmount - paidAmount);

        return {
          id: prev?.id || `ncc-sync-${idx + 1}`,
          code,
          name,
          contactPerson: String(r[2] || '').trim() || prev?.contactPerson || '',
          phone: String(r[3] || '').trim() || prev?.phone || '',
          email: prev?.email || '',
          address: String(r[4] || '').trim() || prev?.address || '',
          specialties: r[5] ? String(r[5]).split(',').map((s) => s.trim()) : prev?.specialties || ['Hoa tươi'],
          rating: parseSheetNumber(r[10]) || prev?.rating || 5,
          oldDebt,
          importAmount,
          paidAmount,
          totalDebt,
          finalDebt: totalDebt,
          status: 'active' as const,
        };
      });
      useSupplierStore.setState({ suppliers });
      counts['ncc'] = suppliers.length;
    }

    // --- 4. NHAN_VIEN ---
    // Columns: code, fullName, username, position, department, role, phone, email, joinDate, salary, status
    const nvRows = sheetMap['NHAN_VIEN'] || [];
    if (nvRows.length > 0) {
      const existing = useEmployeeStore.getState().employees;
      const existingMap = new Map(existing.map((e) => [e.code, e]));
      const employees: Employee[] = nvRows.filter((r) => r[0] && r[1]).map((r, idx) => {
        const code = String(r[0] || '').trim();
        const prev = existingMap.get(code);
        return {
          id: prev?.id || `nv-sync-${idx + 1}`,
          code,
          fullName: String(r[1] || '').trim(),
          username: String(r[2] || '').trim() || prev?.username || code.toLowerCase().replace('-', ''),
          position: String(r[3] || '').trim(),
          department: String(r[4] || '').trim(),
          role: (r[5] === 'Quản trị viên' ? 'admin' : 'member') as Employee['role'],
          phone: String(r[6] || '').trim(),
          email: String(r[7] || '').trim(),
          joinDate: fromSheetDate(r[8]),
          salary: parseSheetNumber(r[9]) || 0,
          status: 'active' as Employee['status'],
          password: (r[11] ? String(r[11]).trim() : undefined) || prev?.password || '123456',
        };
      });
      useEmployeeStore.setState({ employees });
      counts['nhan_vien'] = employees.length;
    }

    // --- 5. TON_KHO ---
    // Columns: flowerCode, flowerName, unit, currentStock, minStock, maxStock, costPrice, warning, warehouse, lastImportDate, freshness
    const tonKhoRows = sheetMap['TON_KHO'] || [];
    if (tonKhoRows.length > 0) {
      const inventory: InventoryItem[] = tonKhoRows.filter((r) => r[0] && r[1]).map((r) => {
        const currentStock = parseSheetNumber(r[3]) || 0;
        const minStock = parseSheetNumber(r[4]) || 0;
        const maxStock = parseSheetNumber(r[5]) || 0;
        const status: InventoryItem['status'] =
          currentStock === 0 ? 'out' : currentStock <= minStock ? 'low' : currentStock > maxStock ? 'excess' : 'normal';
        return {
          flowerId: `inv-${String(r[0] || '').trim()}`,
          flowerCode: String(r[0] || '').trim(),
          flowerName: String(r[1] || '').trim(),
          category: 'Hoa tươi',
          unit: String(r[2] || 'cành').trim(),
          warehouse: String(r[8] || 'Kho mát').trim(),
          currentStock,
          minStock,
          maxStock,
          costPrice: parseSheetNumber(r[6]) || 0,
          lastImportDate: fromSheetDate(r[9]),
          shelfLifeDays: 7,
          freshness: String(r[10] || '').trim(),
          status,
        };
      });
      useInventoryStore.setState({ inventory });
      counts['ton_kho'] = inventory.length;
    }

    // --- 6. THU_CHI ---
    // Columns: code, date, type(Thu/Chi), category, amount, partner, paymentMethod, creator, notes
    const thuChiRows = sheetMap['THU_CHI'] || [];
    if (thuChiRows.length > 0) {
      const transactions: CashTransaction[] = thuChiRows.filter((r) => r[0] && r[1]).map((r, idx) => ({
        id: `tc-sync-${idx + 1}`,
        code: String(r[0] || '').trim(),
        date: fromSheetDate(r[1]),
        type: (r[2] === 'Thu' ? 'income' : 'expense') as CashTransaction['type'],
        category: String(r[3] || '').trim(),
        amount: parseSheetNumber(r[4]) || 0,
        partner: String(r[5] || '').trim(),
        paymentMethod: (String(r[6] || 'Tiền mặt').trim()) as CashTransaction['paymentMethod'],
        creator: String(r[7] || '').trim(),
        notes: String(r[8] || '').trim(),
      }));
      useCashStore.setState({ transactions });
      counts['thu_chi'] = transactions.length;
    }

    // --- 7. CONG_NO_NPP & CONG_NO_NCC (Tách riêng 2 sheet độc lập) ---
    // Layout 10 cột: [id, date, partnerName, partnerType(NPP/NCC), type, amount, remainingDebt, referenceCode, creator, notes]
    const congNoNppRows = sheetMap['CONG_NO_NPP'] || [];
    const congNoNccRows = sheetMap['CONG_NO_NCC'] || [];
    const legacyCongNoRows = sheetMap['CONG_NO'] || [];

    const allDistributors = useDistributorStore.getState().distributors;
    const allSuppliers = useSupplierStore.getState().suppliers;

    const parseDebtRows = (rows: any[][], forcePartnerType?: 'npp' | 'ncc') => {
      return rows
        .filter((r) => {
          if (!r[0] || !r[1]) return false;
          const col0 = String(r[0]).trim().toLowerCase();
          const col1 = String(r[1]).trim().toLowerCase();
          if (
            col0 === 'id' ||
            col0 === 'mã công nợ' ||
            col0 === 'mã công nợ (id)' ||
            col0 === 'mã cn' ||
            col0.includes('công nợ') ||
            col0 === 'ngày' ||
            col0 === 'ngày ghi nhận' ||
            col1 === 'khách_hang' ||
            col1 === 'ngày ghi nhận'
          ) {
            return false;
          }
          return true;
        })
        .map((r, idx) => {
          const hasIdCol =
            String(r[3] || '').trim().toUpperCase() === 'NPP' ||
            String(r[3] || '').trim().toUpperCase() === 'NCC' ||
            r.length >= 10;

          const defaultPrefix = forcePartnerType === 'ncc' ? 'CN-NCC' : 'CN-NPP';
          const recordId = hasIdCol
            ? String(r[0] || '').trim() || `${defaultPrefix}-${String(idx + 1).padStart(4, '0')}`
            : `cn-sync-${idx + 1}`;
          const dateStr = hasIdCol ? r[1] : r[0];
          const partnerName = String((hasIdCol ? r[2] : r[1]) || '').trim();
          const partnerTypeRaw = hasIdCol ? r[3] : r[2];
          const isNpp = forcePartnerType
            ? forcePartnerType === 'npp'
            : String(partnerTypeRaw || '').trim().toUpperCase() === 'NPP';
          const partnerType = (isNpp ? 'npp' : 'ncc') as DebtDailyRecord['partnerType'];
          const matchedDist = isNpp
            ? allDistributors.find((d) => d.name?.trim().toLowerCase() === partnerName.toLowerCase() || d.code === partnerName)
            : null;
          const matchedSup = !isNpp
            ? allSuppliers.find((s) => s.name?.trim().toLowerCase() === partnerName.toLowerCase() || s.code === partnerName)
            : null;

          const typeRaw = hasIdCol ? r[4] : r[3];
          const typeStr = String(typeRaw || '').trim().toLowerCase();
          const isThu =
            typeStr === 'thu' ||
            typeStr === 'tiền trả' ||
            typeStr === 'tiền thu' ||
            typeStr.includes('trả') ||
            typeStr.includes('thu');
          const type = (isThu ? 'thu' : 'chi') as DebtDailyRecord['type'];
          const amount = parseSheetNumber(hasIdCol ? r[5] : r[4]) || 0;
          const remDebt = parseSheetNumber(hasIdCol ? r[6] : r[5]) || 0;
          const rawRef = String((hasIdCol ? r[7] : r[6]) || '').trim();
          const creator = String((hasIdCol ? r[8] : r[7]) || '').trim();
          const notes = String((hasIdCol ? r[9] : r[8]) || '').trim();

          const isOrderRef = rawRef.startsWith('DH-') || rawRef.startsWith('PO-');

          return {
            id: recordId,
            date: fromSheetDate(dateStr),
            partnerType,
            partnerId: matchedDist?.id || matchedSup?.id || `partner-sync-${idx + 1}`,
            partnerCode: matchedDist?.code || matchedSup?.code || '',
            partnerName,
            type,
            amount,
            remainingDebt: remDebt,
            finalDebt: remDebt,
            increaseAmount: isThu ? 0 : amount,
            decreaseAmount: isThu ? amount : 0,
            referenceCode: rawRef,
            entryType: (isOrderRef ? 'order' : 'daily') as DebtDailyRecord['entryType'],
            creator,
            notes,
          };
        });
    };

    let allDebtRecords: DebtDailyRecord[] = [];
    if (congNoNppRows.length > 0 || congNoNccRows.length > 0) {
      const nppList = parseDebtRows(congNoNppRows, 'npp');
      const nccList = parseDebtRows(congNoNccRows, 'ncc');
      allDebtRecords = [...nppList, ...nccList];
      if (nppList.length > 0) counts['cong_no_npp'] = nppList.length;
      if (nccList.length > 0) counts['cong_no_ncc'] = nccList.length;
    } else if (legacyCongNoRows.length > 0) {
      allDebtRecords = parseDebtRows(legacyCongNoRows);
      counts['cong_no'] = allDebtRecords.length;
    }

    if (allDebtRecords.length > 0) {
      useDebtStore.setState({ records: allDebtRecords });
    }

    // --- 8. DON_HANG + CHI_TIET_DON_HANG ---
    // Chi tiết hoa được lưu ở sheet riêng. Phải ghép lại theo mã đơn khi tải về;
    // nếu không, việc đăng nhập/đồng bộ xuống sẽ thay toàn bộ items bằng mảng rỗng.
    // Giữ nguyên thứ tự dòng của Google Sheets (hàng cũ ở trên, hàng mới thêm ở dưới cùng)
    const donHangRows = sheetMap['DON_HANG'] || [];
    if (donHangRows.length > 0) {
      const existingOrders = useOrderStore.getState().orders;
      const existingOrderMap = new Map(existingOrders.map((o) => [o.code, o]));
      const flowers = useFlowerStore.getState().flowers;
      const flowerByCode = new Map(flowers.map((flower) => [flower.code.trim().toLowerCase(), flower]));
      const flowerByName = new Map(flowers.map((flower) => [flower.name.trim().toLowerCase(), flower]));
      // Bỏ các dòng trùng hoàn toàn do các lần đồng bộ cũ ghi lặp.
      const seenOrderRows = new Set<string>();
      const uniqueOrderRows = donHangRows.filter((row) => {
        const key = JSON.stringify(row.slice(0, 18));
        if (seenOrderRows.has(key)) return false;
        seenOrderRows.add(key);
        return true;
      });
      const seenDetailRows = new Set<string>();
      const detailRows = (sheetMap['CHI_TIET_DON_HANG'] || []).filter((row) => {
        const key = JSON.stringify(row.slice(0, 13));
        if (seenDetailRows.has(key)) return false;
        seenDetailRows.add(key);
        return true;
      });
      const itemsByOrderCode = new Map<string, OrderItem[]>();

      for (const row of detailRows) {
        if (!row || row.length === 0) continue;

        // Bỏ qua dòng tiêu đề nếu lẫn vào dữ liệu
        const col0 = String(row[0] || '').trim().toLowerCase();
        const col1 = String(row[1] || '').trim().toLowerCase();
        if (
          col0 === 'id' ||
          col0 === 'stt' ||
          col0 === 'id_dong' ||
          col0 === 'id dòng' ||
          col0 === 'id_don_hang' ||
          col0 === 'mã đơn hàng' ||
          col0 === 'ma_don' ||
          col1 === 'id_don_hang' ||
          col1 === 'mã đơn hàng' ||
          col1 === 'ma_don' ||
          col1 === 'ngay' ||
          col1 === 'ngày đặt'
        ) {
          continue;
        }

        // Nhận diện linh hoạt cấu trúc sheet CHI_TIET_DON_HANG:
        // Cấu trúc 11 cột chuẩn mới (theo yêu cầu: bỏ Tên hoa và ĐVT):
        //   r[0]=id (ID từng dòng), r[1]=id_don_hang (Mã đơn), r[2]=Ngày, r[3]=Khách hàng, r[4]=Mã hoa,
        //   r[5]=Giá bán, r[6]=SL, r[7]=TT bán, r[8]=Giá vốn, r[9]=TT vốn, r[10]=Lợi nhuận
        // Cấu trúc 13 cột (có Tên hoa r[11] & ĐVT r[12])
        // Cấu trúc 12 cột cũ:
        //   r[0]=Mã đơn, r[1]=Ngày, r[2]=Khách hàng, r[3]=Mã hoa, r[4]=Giá bán, r[5]=SL, r[6]=TT bán,
        //   r[7]=Giá vốn, r[8]=TT vốn, r[9]=Lợi nhuận, r[10]=Tên hoa, r[11]=ĐVT
        const is11or13Col =
          (isNumericString(row[5]) && isNumericString(row[7])) ||
          (row[2] && (String(row[2]).includes('/') || String(row[2]).includes('-'))) ||
          row.length === 11 ||
          row.length >= 13;

        let rowId = '';
        let orderCode = '';
        let flowerCode = '';
        let flowerName = '';
        let quantity = 0;
        let unit = '';
        let costPrice = 0;
        let unitPrice = 0;
        let importTotal = 0;
        let amount = 0;
        let profit = 0;

        if (is11or13Col) {
          rowId = String(row[0] || '').trim();
          orderCode = String(row[1] || '').trim();
          flowerCode = String(row[4] || '').trim();
          unitPrice = parseSheetNumber(row[5]);
          quantity = parseSheetNumber(row[6]);
          amount = parseSheetNumber(row[7]) || (quantity * unitPrice);
          costPrice = parseSheetNumber(row[8]);
          importTotal = parseSheetNumber(row[9]) || (quantity * costPrice);
          profit = parseSheetNumber(row[10]) || (amount - importTotal);
          flowerName = String(row[11] || '').trim();
          unit = String(row[12] || '').trim();
        } else {
          orderCode = String(row[0] || '').trim();
          const isNewDetailLayout = isNumericString(row[4]) && isNumericString(row[6]);
          if (isNewDetailLayout) {
            flowerCode = String(row[3] || '').trim();
            unitPrice = parseSheetNumber(row[4]);
            quantity = parseSheetNumber(row[5]);
            amount = parseSheetNumber(row[6]) || (quantity * unitPrice);
            costPrice = parseSheetNumber(row[7]);
            importTotal = parseSheetNumber(row[8]) || (quantity * costPrice);
            profit = parseSheetNumber(row[9]) || (amount - importTotal);
            flowerName = String(row[10] || '').trim();
            unit = String(row[11] || '').trim();
          } else {
            flowerCode = String(row[3] || '').trim();
            flowerName = String(row[4] || '').trim();
            quantity = parseSheetNumber(row[5]);
            unit = String(row[6] || '').trim();
            costPrice = parseSheetNumber(row[7]);
            unitPrice = parseSheetNumber(row[8]);
            importTotal = parseSheetNumber(row[9]) || (quantity * costPrice);
            amount = parseSheetNumber(row[10]) || (quantity * unitPrice);
            profit = parseSheetNumber(row[11]) || (amount - importTotal);
          }
        }

        if (!orderCode) continue;

        const matchedFlower =
          flowerByCode.get(flowerCode.toLowerCase()) ||
          (flowerName ? flowerByName.get(flowerName.toLowerCase()) : null) ||
          flowerByName.get(flowerCode.toLowerCase());
        const previousItem = existingOrderMap.get(orderCode)?.items.find((item) =>
          (flowerCode && item.flowerCode.trim().toLowerCase() === flowerCode.toLowerCase()) ||
          (flowerName && item.flowerName.trim().toLowerCase() === flowerName.toLowerCase()) ||
          (flowerCode && item.flowerName.trim().toLowerCase() === flowerCode.toLowerCase()),
        );

        const finalFlowerName = flowerName || matchedFlower?.name || previousItem?.flowerName || flowerCode;
        if (!flowerCode && !finalFlowerName) continue;

        const finalUnit = unit || matchedFlower?.unit || previousItem?.unit || 'Cành';

        const currentItems = itemsByOrderCode.get(orderCode) || [];
        const item: OrderItem = {
          id: rowId || previousItem?.id || `${orderCode}-${currentItems.length + 1}`,
          flowerId: matchedFlower?.id || previousItem?.flowerId || `hoa-sheet-${flowerCode || finalFlowerName}`,
          flowerCode: flowerCode || matchedFlower?.code || '',
          flowerName: finalFlowerName,
          quantity,
          unit: finalUnit,
          costPrice,
          unitPrice,
          importTotal,
          amount,
          profit,
        };
        currentItems.push(item);
        itemsByOrderCode.set(orderCode, currentItems);
      }

      const orders = normalizeOrders(uniqueOrderRows.filter((r) => {
        if (!r[0] || !r[1]) return false;
        const col0 = String(r[0]).trim().toLowerCase();
        const col1 = String(r[1]).trim().toLowerCase();
        if (col0 === 'id' || col0 === 'mã đơn hàng' || col0 === 'ma_don' || col1 === 'ngay' || col1 === 'ngày đặt') {
          return false;
        }
        return true;
      }).map((r, idx): Order => {
        const code = String(r[0] || '').trim();
        const prev = existingOrderMap.get(code);
        const sheetItems = itemsByOrderCode.get(code);

        // Nhận diện chính xác các cấu trúc sheet DON_HANG:
        // Layout 13 cột (hiện tại, bỏ cả "Trạng thái đơn" & "Trạng thái thanh toán"):
        //   r[0]=id, r[1]=Ngày, r[2]=NPP/Khách, r[3]=Thành tiền hoa, r[4]=Cước, r[5]=Trừ hàng, r[6]=Tổng tiền,
        //   r[7]=Nợ cũ, r[8]=Thanh toán, r[9]=Người tạo, r[10]=SL hoa, r[11]=Ghi chú, r[12]=Cập nhật lúc
        //
        // Layout 0: Chuẩn 15 cột (bản trước) (bỏ "Đã thanh toán" & "Còn nợ đơn")
        //   r[0]=id, r[1]=Ngày, r[2]=NPP/Khách, r[3]=Thành tiền hoa, r[4]=Cước, r[5]=Trừ hàng, r[6]=Tổng tiền,
        //   r[7]=Nợ cũ, r[8]=Thanh toán, r[9]=Trạng thái, r[10]=Trạng thái thanh toán, r[11]=Người tạo,
        //   r[12]=SL hoa, r[13]=Ghi chú, r[14]=Cập nhật lúc
        //
        // Layout 1: Chuẩn 17 cột (bản trước) (Đã bỏ SĐT/Địa chỉ, cột Số lượng hoa r[14] sau Người tạo đơn r[13])
        //   r[0]=Mã ĐH, r[1]=Ngày, r[2]=NPP/Khách, r[3]=Thành tiền hoa, r[4]=Cước, r[5]=Trừ hàng, r[6]=Tổng tiền,
        //   r[7]=Nợ cũ, r[8]=Thanh toán, r[9]=Đã thanh toán, r[10]=Còn nợ, r[11]=Trạng thái, r[12]=Trạng thái thanh toán,
        //   r[13]=Người tạo, r[14]=SL hoa, r[15]=Ghi chú, r[16]=Cập nhật lúc
        //
        // Layout 2: Dòng 7 cột (các đơn cũ trên Google Sheets)
        //   r[0]=id, r[1]=ngay, r[2]=khach_hang, r[3]=thanh_tien, r[4]=cuoc_xe, r[5]=tru_hang, r[6]=tong_tien
        //
        // Layout 3: Bản cũ 19 cột (có SĐT r[3] & Địa chỉ r[4])
        //   r[0]=Mã, r[1]=Ngày, r[2]=Khách, r[3]=SĐT, r[4]=Địa chỉ, r[5]=SL hoa, r[6]=Thành tiền, r[7]=Cước, r[8]=Trừ hàng...

        const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid'];
        const ORDER_STATUSES = ['nhap', 'cho_xac_nhan', 'da_xac_nhan', 'dang_giao', 'hoan_thanh', 'huy', 'pending', 'processing', 'delivering', 'completed', 'cancelled'];
        const isStandard15Cols =
          r.length >= 10 &&
          (PAYMENT_STATUSES.includes(String(r[10] || '').trim().toLowerCase()) ||
            ORDER_STATUSES.includes(String(r[9] || '').trim().toLowerCase()));

        // 13 cột: cột cuối (r[12]) là thời điểm cập nhật "dd/mm/yyyy hh:mm:ss"
        const isStandard13Cols =
          !isStandard15Cols &&
          r.length >= 13 &&
          r.length <= 13 &&
          /^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}/.test(String(r[12] || '').trim());

        const isStandard17Cols =
          !isStandard15Cols &&
          !isStandard13Cols &&
          r.length >= 14 && (
            ['unpaid', 'partial', 'paid'].includes(String(r[12] || '').trim().toLowerCase()) ||
            ['nhap', 'cho_xac_nhan', 'da_xac_nhan', 'dang_giao', 'hoan_thanh', 'huy'].includes(String(r[11] || '').trim().toLowerCase()) ||
            (r.length >= 15 && isNumericString(r[14]) && !isNumericString(r[13]))
          );

        const hasPhoneAddress =
          !isStandard15Cols &&
          !isStandard13Cols &&
          !isStandard17Cols &&
          r.length >= 18 &&
          (!isNumericString(r[3]) || !isNumericString(r[4])) &&
          isNumericString(r[5]);

        let totalQuantity = 0;
        let itemsSubtotal = 0;
        let shippingFee = 0;
        let discount = 0;
        let totalAmount = 0;
        let oldDebt = 0;
        let totalPayment = 0;
        let paidAmount = 0;
        let debtAmount = 0;
        let status: Order['status'] = 'da_xac_nhan';
        let paymentStatus: Order['paymentStatus'] = 'unpaid';
        let creator = '';
        let notes = '';

        if (isStandard13Cols) {
          itemsSubtotal = parseSheetNumber(r[3]) || prev?.itemsSubtotal || 0;
          shippingFee = parseSheetNumber(r[4]) || prev?.shippingFee || 0;
          discount = parseSheetNumber(r[5]) || prev?.discount || 0;
          totalAmount = parseSheetNumber(r[6]) || prev?.totalAmount || 0;
          oldDebt = parseSheetNumber(r[7]) || prev?.oldDebt || 0;
          totalPayment = parseSheetNumber(r[8]) || prev?.totalPayment || 0;
          // Không còn trạng thái trên sheet / web: giữ giá trị ẩn cũ (mặc định là đơn hợp lệ)
          status = (prev?.status || 'da_xac_nhan') as Order['status'];
          paymentStatus = (prev?.paymentStatus || 'unpaid') as Order['paymentStatus'];
          creator = String(r[9] || '').trim() || prev?.creator || '';
          totalQuantity = parseSheetNumber(r[10]) || prev?.totalQuantity || 0;
          notes = String(r[11] || '').trim() || prev?.notes || '';
        } else if (isStandard15Cols) {
          itemsSubtotal = parseSheetNumber(r[3]) || prev?.itemsSubtotal || 0;
          shippingFee = parseSheetNumber(r[4]) || prev?.shippingFee || 0;
          discount = parseSheetNumber(r[5]) || prev?.discount || 0;
          totalAmount = parseSheetNumber(r[6]) || prev?.totalAmount || 0;
          oldDebt = parseSheetNumber(r[7]) || prev?.oldDebt || 0;
          totalPayment = parseSheetNumber(r[8]) || prev?.totalPayment || 0;
          status = (String(r[9] || prev?.status || 'da_xac_nhan').trim()) as Order['status'];
          paymentStatus = (String(r[10] || prev?.paymentStatus || 'unpaid').trim()) as Order['paymentStatus'];
          creator = String(r[11] || '').trim() || prev?.creator || '';
          totalQuantity = parseSheetNumber(r[12]) || prev?.totalQuantity || 0;
          notes = String(r[13] || '').trim() || prev?.notes || '';
        } else if (isStandard17Cols) {
          itemsSubtotal = parseSheetNumber(r[3]) || prev?.itemsSubtotal || 0;
          shippingFee = parseSheetNumber(r[4]) || prev?.shippingFee || 0;
          discount = parseSheetNumber(r[5]) || prev?.discount || 0;
          totalAmount = parseSheetNumber(r[6]) || prev?.totalAmount || 0;
          oldDebt = parseSheetNumber(r[7]) || prev?.oldDebt || 0;
          totalPayment = parseSheetNumber(r[8]) || prev?.totalPayment || 0;
          paidAmount = parseSheetNumber(r[9]) || prev?.paidAmount || 0;
          debtAmount = parseSheetNumber(r[10]) || prev?.debtAmount || 0;
          status = (String(r[11] || prev?.status || 'da_xac_nhan').trim()) as Order['status'];
          paymentStatus = (String(r[12] || prev?.paymentStatus || 'unpaid').trim()) as Order['paymentStatus'];
          creator = String(r[13] || '').trim() || prev?.creator || '';
          totalQuantity = parseSheetNumber(r[14]) || prev?.totalQuantity || 0;
          notes = String(r[15] || '').trim() || prev?.notes || '';
        } else if (hasPhoneAddress) {
          totalQuantity = parseSheetNumber(r[5]) || prev?.totalQuantity || 0;
          itemsSubtotal = parseSheetNumber(r[6]) || prev?.itemsSubtotal || 0;
          shippingFee = parseSheetNumber(r[7]) || prev?.shippingFee || 0;
          discount = parseSheetNumber(r[8]) || prev?.discount || 0;
          totalAmount = parseSheetNumber(r[9]) || prev?.totalAmount || 0;
          oldDebt = parseSheetNumber(r[10]) || prev?.oldDebt || 0;
          totalPayment = parseSheetNumber(r[11]) || prev?.totalPayment || 0;
          paidAmount = parseSheetNumber(r[12]) || prev?.paidAmount || 0;
          debtAmount = parseSheetNumber(r[13]) || prev?.debtAmount || 0;
          status = (String(r[14] || prev?.status || 'da_xac_nhan').trim()) as Order['status'];
          paymentStatus = (String(r[15] || prev?.paymentStatus || 'unpaid').trim()) as Order['paymentStatus'];
          creator = String(r[16] || '').trim() || prev?.creator || '';
          notes = String(r[17] || '').trim() || prev?.notes || '';
        } else {
          // Layout ngắn (7 cột): id, ngay, khach, thanh_tien, cuoc_xe, tru_hang, tong_tien
          itemsSubtotal = parseSheetNumber(r[3]) || prev?.itemsSubtotal || 0;
          shippingFee = parseSheetNumber(r[4]) || prev?.shippingFee || 0;
          discount = parseSheetNumber(r[5]) || prev?.discount || 0;
          totalAmount = parseSheetNumber(r[6]) || prev?.totalAmount || (itemsSubtotal + shippingFee - discount);
          status = prev?.status || 'da_xac_nhan';
          paymentStatus = prev?.paymentStatus || 'unpaid';
          creator = prev?.creator || '';
          notes = String(r[7] || prev?.notes || '').trim();
        }

        // Bỏ "Đã thanh toán" khỏi hệ thống: khách trả tiền ghi bằng phiếu thu ở module Công nợ.
        // Còn nợ đơn = Thanh toán (web tự tính, không lưu trên sheet).
        paidAmount = 0;
        debtAmount = totalPayment || totalAmount + oldDebt;

        // Tự động tính tổng số lượng hoa từ các dòng chi tiết nếu đơn chưa có số lượng
        const totalQtyFromItems = sheetItems?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;
        if (!totalQuantity && totalQtyFromItems > 0) {
          totalQuantity = totalQtyFromItems;
        }

        return {
          id: prev?.id || `dh-sync-${idx + 1}`,
          code,
          orderDate: fromSheetDate(r[1]),
          distributorName: String(r[2] || '').trim(),
          phone: hasPhoneAddress ? String(r[3] || '').trim() : (prev?.phone || ''),
          address: hasPhoneAddress ? String(r[4] || '').trim() : (prev?.address || ''),
          totalQuantity,
          itemsSubtotal,
          shippingFee,
          discount,
          totalAmount,
          oldDebt,
          totalPayment,
          paidAmount,
          debtAmount,
          status,
          paymentStatus,
          creator,
          notes,
          // Ưu tiên chi tiết từ Sheets; chỉ giữ dữ liệu cục bộ khi sheet chưa có dòng chi tiết.
          items: sheetItems?.length ? sheetItems : (prev?.items || []),
          updatedAt: prev?.updatedAt,
        };
      }));
      useOrderStore.setState({ orders });
      counts['don_hang'] = orders.length;
    }

    // --- 9. DON_NHAP_NCC ---
    const donNhapRows = sheetMap['DON_NHAP_NCC'] || [];
    if (donNhapRows.length > 0) {
      const existingSupplierOrders = useSupplierOrderStore.getState().orders;
      const existingSupplierOrderMap = new Map(existingSupplierOrders.map((o) => [o.code, o]));
      const supplierOrders: SupplierOrder[] = donNhapRows.filter((r) => r[0] && r[1]).map((r, idx) => {
        const code = String(r[0] || '').trim();
        const prev = existingSupplierOrderMap.get(code);
        return {
          id: prev?.id || `po-sync-${idx + 1}`,
          code,
          orderDate: fromSheetDate(r[1]),
          supplierName: String(r[2] || '').trim(),
          totalQuantity: parseSheetNumber(r[3]) || prev?.totalQuantity || 0,
          itemsSubtotal: parseSheetNumber(r[4]) || prev?.itemsSubtotal || 0,
          shippingFee: parseSheetNumber(r[5]) || prev?.shippingFee || 0,
          discount: 0,
          totalAmount: parseSheetNumber(r[6]) || prev?.totalAmount || 0,
          paidAmount: parseSheetNumber(r[7]) || prev?.paidAmount || 0,
          debtAmount: parseSheetNumber(r[8]) || prev?.debtAmount || 0,
          status: (String(r[9] || prev?.status || 'nhap').trim()) as SupplierOrder['status'],
          paymentStatus: 'unpaid' as SupplierOrder['paymentStatus'],
          creator: String(r[10] || '').trim() || prev?.creator || '',
          notes: String(r[11] || '').trim() || prev?.notes || '',
          items: prev?.items || [],
        };
      });
      useSupplierOrderStore.setState({ orders: supplierOrders });
      counts['don_nhap_ncc'] = supplierOrders.length;
    }

    // Tự động đồng bộ toàn bộ đơn hàng vào sổ công nợ (có đơn thì có công nợ)
    syncAllOrdersToDebtRecords();

    // Tự động tính toán lại toàn bộ doanh số bán hoa, công nợ cũ, đã trả, nợ cuối cho NPP & NCC
    recalcAllDistributorsDebts();
    recalcAllSuppliersDebts();

    const parts = [
      counts['hoa'] ? `${counts['hoa']} loại hoa` : '',
      counts['npp'] ? `${counts['npp']} NPP` : '',
      counts['ncc'] ? `${counts['ncc']} NCC` : '',
      counts['nhan_vien'] ? `${counts['nhan_vien']} nhân viên` : '',
      counts['ton_kho'] ? `${counts['ton_kho']} mặt hàng tồn kho` : '',
      counts['thu_chi'] ? `${counts['thu_chi']} thu chi` : '',
      counts['cong_no_npp'] ? `${counts['cong_no_npp']} công nợ NPP` : '',
      counts['cong_no_ncc'] ? `${counts['cong_no_ncc']} công nợ NCC` : '',
      counts['cong_no'] ? `${counts['cong_no']} công nợ` : '',
      counts['don_hang'] ? `${counts['don_hang']} đơn hàng` : '',
      counts['don_nhap_ncc'] ? `${counts['don_nhap_ncc']} đơn nhập NCC` : '',
    ].filter(Boolean);

    return {
      success: true,
      message: parts.length > 0
        ? `Đã tải từ GG Sheets: ${parts.join(', ')}`
        : 'Kết nối thành công nhưng GG Sheets chưa có dữ liệu',
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || 'Lỗi khi tải từ Google Sheets',
    };
  } finally {
    resumeAudit?.();
  }
}
