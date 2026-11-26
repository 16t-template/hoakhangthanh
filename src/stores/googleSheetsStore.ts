import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  checkGoogleSheetsConnection,
  pullFromGoogleSheets,
  syncAllToGoogleSheets,
  takeModulesToSeedAfterPull,
  type GoogleSheetsStatus,
  type SyncableModule,
} from '@/lib/googleSheetsService';
import {
  useCashStore,
  useDebtStore,
  useInventoryStore,
  useEmployeeStore,
  useSupplierOrderStore,
  useDistributorStore,
  useFlowerStore,
  useOrderStore,
  useSupplierStore,
} from '@/stores/hoaKhangThanhStore';
import { useDailyStockReconcileStore } from '@/stores/dailyStockReconcileStore';
import { toast } from 'sonner';

export interface SyncLogEntry {
  id: string;
  time: string;
  type: 'push' | 'pull' | 'check';
  status: 'success' | 'error';
  message: string;
}

interface GoogleSheetsState {
  isConnected: boolean;
  isChecking: boolean;
  isSyncing: boolean;
  lastSyncTime: string | null;
  autoSync: boolean;
  sheetInfo: GoogleSheetsStatus | null;
  syncLogs: SyncLogEntry[];

  // Actions
  checkStatus: () => Promise<void>;
  syncToSheets: (isBackground?: boolean, modules?: SyncableModule[]) => Promise<boolean>;
  pullFromSheets: () => Promise<boolean>;
  setAutoSync: (enabled: boolean) => void;
  clearLogs: () => void;
}

export const useGoogleSheetsStore = create<GoogleSheetsState>()(
  persist(
    (set, get) => ({
      isConnected: false, // Set only after a successful connection check or sync
      isChecking: false,
      isSyncing: false,
      lastSyncTime: null,
      autoSync: true, // Auto-sync enabled by default
      sheetInfo: null,
      syncLogs: [],

      checkStatus: async () => {
        set({ isChecking: true });
        try {
          const info = await checkGoogleSheetsConnection();
          set({
            isConnected: info.connected,
            sheetInfo: info,
            isChecking: false,
          });
        } catch {
          set({ isChecking: false });
        }
      },

      syncToSheets: async (isBackground = false, modules?: SyncableModule[]) => {
        if (get().isSyncing) {
          // Đang gửi dở: ghi nhớ để gửi tiếp ngay sau lượt hiện tại (không bỏ mất module của lần gọi này)
          (modules && modules.length > 0 ? modules : ALL_MODULES).forEach((m) => pendingModules.add(m));
          hasPendingSync = true;
          return false;
        }
        set({ isSyncing: true });

        const now = new Date();
        const timeStr = now.toLocaleTimeString('vi-VN') + ' ' + now.toLocaleDateString('vi-VN');

        try {
          const result = await syncAllToGoogleSheets(modules);
          if (result.success) {
            syncRetryAttempt = 0;
            set((state) => ({
              isSyncing: false,
              isConnected: true,
              lastSyncTime: timeStr,
              syncLogs: [
                {
                  id: `log-${Date.now()}`,
                  time: timeStr,
                  type: 'push',
                  status: 'success',
                  message: `Đã đồng bộ ${result.updatedSheetsCount || 1} sheets (${result.totalUpdatedCells || 0} ô dữ liệu) lên Google Sheets`,
                },
                ...state.syncLogs.slice(0, 49),
              ],
            }));
            if (!isBackground) {
              toast.success('Đã đồng bộ dữ liệu lên Google Sheets thành công!');
            }
            return true;
          } else {
            set((state) => ({
              isSyncing: false,
              syncLogs: [
                {
                  id: `log-${Date.now()}`,
                  time: timeStr,
                  type: 'push',
                  status: 'error',
                  message: result.error || 'Lỗi khi đồng bộ lên Google Sheets',
                },
                ...state.syncLogs.slice(0, 49),
              ],
            }));
            toast.error(`Đồng bộ thất bại: ${result.error}. Sẽ tự gửi lại...`);
            scheduleSyncRetry(modules);
            return false;
          }
        } catch (err: any) {
          set((state) => ({
            isSyncing: false,
            syncLogs: [
              {
                id: `log-${Date.now()}`,
                time: timeStr,
                type: 'push',
                status: 'error',
                message: err?.message || 'Lỗi kết nối khi đồng bộ',
              },
              ...state.syncLogs.slice(0, 49),
            ],
          }));
          toast.error(`Lỗi: ${err?.message}. Sẽ tự gửi lại...`);
          scheduleSyncRetry(modules);
          return false;
        } finally {
          set({ isSyncing: false });
          // Nếu có thay đổi mới phát sinh trong lúc đang đồng bộ, thực hiện tiếp ngay lập tức
          if (hasPendingSync) {
            hasPendingSync = false;
            const nextMods = Array.from(pendingModules);
            pendingModules.clear();
            setTimeout(() => {
              void get().syncToSheets(true, nextMods.length > 0 ? nextMods : undefined);
            }, 80);
          }
        }
      },

      pullFromSheets: async () => {
        if (get().isSyncing) return false;
        set({ isSyncing: true });

        const now = new Date();
        const timeStr = now.toLocaleTimeString('vi-VN') + ' ' + now.toLocaleDateString('vi-VN');

        try {
          const result = await pullFromGoogleSheets();
          if (result.success) {
            set((state) => ({
              isSyncing: false,
              isConnected: true,
              lastSyncTime: timeStr,
              syncLogs: [
                {
                  id: `log-${Date.now()}`,
                  time: timeStr,
                  type: 'pull',
                  status: 'success',
                  message: result.message,
                },
                ...state.syncLogs.slice(0, 49),
              ],
            }));
            toast.success(result.message);
            return true;
          } else {
            set((state) => ({
              isSyncing: false,
              syncLogs: [
                {
                  id: `log-${Date.now()}`,
                  time: timeStr,
                  type: 'pull',
                  status: 'error',
                  message: result.message,
                },
                ...state.syncLogs.slice(0, 49),
              ],
            }));
            toast.error(result.message);
            return false;
          }
        } catch (err: any) {
          set({ isSyncing: false });
          toast.error(`Lỗi tải dữ liệu: ${err?.message}`);
          return false;
        }
      },

      setAutoSync: (enabled) => set({ autoSync: enabled }),
      clearLogs: () => set({ syncLogs: [] }),
    }),
    {
      name: 'hkt-google-sheets-storage',
      partialize: (state) => ({
        autoSync: state.autoSync,
        lastSyncTime: state.lastSyncTime,
        syncLogs: state.syncLogs.slice(0, 20),
      }),
    }
  )
);

let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let isInitialized = false;
let applyingRemoteData = false;
let initialPullDone = false;
const pendingModules = new Set<SyncableModule>();
let hasPendingSync = false;

const ALL_MODULES: SyncableModule[] = [
  'orders', 'flowers', 'distributors', 'suppliers', 'supplierOrders',
  'debtRecords', 'transactions', 'inventory', 'employees', 'dailyStock',
];

/**
 * Gửi lên Google Sheets bị lỗi (mạng, Google giới hạn số lần đọc/ghi mỗi phút, lỗi 5xx...)
 * → tự gửi lại các module đó sau 10s, 20s, 40s... (tối đa 5 phút) cho tới khi thành công,
 * để dữ liệu vừa thêm/sửa trên web không bị "kẹt" mà không lên sheet.
 */
let syncRetryAttempt = 0;
let syncRetryTimer: ReturnType<typeof setTimeout> | null = null;
const retryModules = new Set<SyncableModule>();
function scheduleSyncRetry(modules?: SyncableModule[]) {
  (modules && modules.length > 0 ? modules : ALL_MODULES).forEach((m) => retryModules.add(m));
  if (syncRetryTimer) return;
  const delay = Math.min(10000 * 2 ** syncRetryAttempt, 5 * 60 * 1000);
  syncRetryAttempt += 1;
  syncRetryTimer = setTimeout(() => {
    syncRetryTimer = null;
    const mods = Array.from(retryModules);
    retryModules.clear();
    if (!initialPullDone) return; // đang tải lại từ sheet (vd. đổi sheet) thì không gửi dữ liệu cũ
    void useGoogleSheetsStore.getState().syncToSheets(true, mods);
  }, delay);
}

/**
 * Kích hoạt đồng bộ ngay lập tức cho các module cụ thể mà không cần chờ debounce
 */
export function triggerImmediateSync(modules?: SyncableModule[]) {
  if (modules) {
    modules.forEach((m) => pendingModules.add(m));
  }
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = null;
  }
  const { autoSync, syncToSheets, isSyncing } = useGoogleSheetsStore.getState();
  if (!autoSync) return;
  if (isSyncing) {
    hasPendingSync = true;
    return;
  }
  const mods = Array.from(pendingModules);
  pendingModules.clear();
  void syncToSheets(true, mods.length > 0 ? mods : undefined);
}

/**
 * Tự động đồng bộ lên Google Sheets mỗi khi có thay đổi dữ liệu đơn hàng, hoa, NPP, NCC, thu chi
 */
export function initGoogleSheetsAutoSync() {
  if (typeof window === 'undefined' || isInitialized) return;
  isInitialized = true;

  const handleStoreChange = (mod?: SyncableModule) => {
    if (applyingRemoteData) return;
    // Google Sheets là chuẩn: chưa tải xong dữ liệu từ Sheets thì KHÔNG đẩy dữ liệu cũ trên web lên
    // (tránh làm sống lại các dòng vừa xóa trên Sheets).
    if (!initialPullDone) return;
    if (mod) pendingModules.add(mod);

    const { autoSync, syncToSheets, isSyncing } = useGoogleSheetsStore.getState();
    if (!autoSync) return;

    if (isSyncing) {
      hasPendingSync = true;
      return;
    }

    if (syncDebounceTimer) {
      clearTimeout(syncDebounceTimer);
    }

    // Debounce ngắn (400ms) để gom các thao tác liên tiếp nhưng vẫn ghi lên Sheets cực nhanh
    syncDebounceTimer = setTimeout(() => {
      syncDebounceTimer = null;
      const mods = Array.from(pendingModules);
      pendingModules.clear();
      if (useGoogleSheetsStore.getState().autoSync) {
        void syncToSheets(true, mods.length > 0 ? mods : undefined);
      }
    }, 400);
  };

  _startSubscriptions(handleStoreChange);

  // Mở web: tải dữ liệu từ Google Sheets TRƯỚC (Sheets là chuẩn), tải xong mới cho phép tự đẩy lên.
  // Tải lỗi (mất mạng, Cloudflare quá hạn mức...) thì thử lại THƯA DẦN: 30s, 1, 2, 4, 8 phút... tối đa 15 phút
  // (không gọi dồn dập làm vượt hạn mức). Trong lúc đó không đẩy dữ liệu cũ lên.
  let retryCount = 0;
  const refreshFromSheets = async () => {
    const { autoSync, pullFromSheets } = useGoogleSheetsStore.getState();
    if (!autoSync) {
      initialPullDone = true;
      return;
    }
    applyingRemoteData = true;
    let ok = false;
    try {
      ok = Boolean(await pullFromSheets());
    } catch {
      ok = false;
    } finally {
      applyingRemoteData = false;
    }
    if (ok) {
      initialPullDone = true;
      retryCount = 0;
      const seed = takeModulesToSeedAfterPull();
      if (seed.length > 0) void useGoogleSheetsStore.getState().syncToSheets(true, seed);
    } else {
      const delay = Math.min(30000 * 2 ** retryCount, 15 * 60 * 1000);
      retryCount += 1;
      window.setTimeout(() => void refreshFromSheets(), delay);
    }
  };

  void refreshFromSheets();
}

/**
 * Đổi sang Google Sheet khác (module Cài đặt): CHẶN ghi lên, tải dữ liệu của sheet mới về trước,
 * tải xong mới cho ghi lại — tránh ghi dữ liệu của sheet cũ đè lên sheet mới.
 * Trả về true nếu tải về thành công.
 */
export async function reloadFromNewSpreadsheet(): Promise<boolean> {
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = null;
  }
  pendingModules.clear();
  hasPendingSync = false;
  initialPullDone = false;
  // Huỷ lượt gửi lại đang chờ: dữ liệu đó thuộc sheet cũ
  if (syncRetryTimer) {
    clearTimeout(syncRetryTimer);
    syncRetryTimer = null;
  }
  retryModules.clear();
  syncRetryAttempt = 0;

  // Đợi lượt đồng bộ đang chạy (nếu có) xong, tối đa 60 giây
  for (let i = 0; i < 120 && useGoogleSheetsStore.getState().isSyncing; i++) {
    await new Promise((r) => setTimeout(r, 500));
  }

  applyingRemoteData = true;
  let ok = false;
  try {
    ok = Boolean(await useGoogleSheetsStore.getState().pullFromSheets());
  } catch {
    ok = false;
  } finally {
    applyingRemoteData = false;
  }
  // Tải lỗi thì vẫn chặn ghi lên cho tới khi tải lại thành công (mở lại web hoặc bấm Tải về)
  initialPullDone = ok;
  // Sheet mới: không tự đẩy dữ liệu Tồn ngày của sheet cũ sang
  takeModulesToSeedAfterPull();
  if (ok) void useGoogleSheetsStore.getState().checkStatus();
  return ok;
}

function _startSubscriptions(handleStoreChange: (mod?: SyncableModule) => void) {
  useOrderStore.subscribe(() => handleStoreChange('orders'));
  useFlowerStore.subscribe(() => handleStoreChange('flowers'));
  useDistributorStore.subscribe(() => handleStoreChange('distributors'));
  useSupplierStore.subscribe(() => handleStoreChange('suppliers'));
  useCashStore.subscribe(() => handleStoreChange('transactions'));
  useDebtStore.subscribe(() => handleStoreChange('debtRecords'));
  useInventoryStore.subscribe(() => handleStoreChange('inventory'));
  useEmployeeStore.subscribe(() => handleStoreChange('employees'));
  useSupplierOrderStore.subscribe(() => handleStoreChange('supplierOrders'));
  useDailyStockReconcileStore.subscribe(() => handleStoreChange('dailyStock'));
  // Lịch sử thao tác chỉ lưu trên web → thay đổi lịch sử không cần đẩy lên Google Sheets
  // Lịch sử thao tác chỉ lưu trên web → thay đổi lịch sử không cần đẩy lên Google Sheets
}

