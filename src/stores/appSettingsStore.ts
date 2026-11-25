import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { GOOGLE_SHEETS_CONFIG } from '@/config/googleSheetsConfig';

/**
 * Cài đặt ứng dụng (module Cài đặt). Lưu trên trình duyệt của máy đang dùng.
 * - spreadsheetId: ID Google Sheet app đọc/ghi. Để trống = dùng ID mặc định của hệ thống.
 */
interface AppSettingsState {
  spreadsheetId: string;
  setSpreadsheetId: (id: string) => void;
}

export const useAppSettingsStore = create<AppSettingsState>()(
  persist(
    (set) => ({
      spreadsheetId: '',
      setSpreadsheetId: (id) => set({ spreadsheetId: id.trim() }),
    }),
    { name: 'hkt-app-settings' },
  ),
);

/** Lấy ID sheet từ link Google Sheets hoặc từ chính ID dán vào. Trả về '' nếu không hợp lệ. */
export function parseSpreadsheetId(input: string): string {
  const s = (input || '').trim();
  const fromUrl = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})/);
  if (fromUrl) return fromUrl[1];
  return /^[A-Za-z0-9_-]{20,100}$/.test(s) ? s : '';
}

export const DEFAULT_SPREADSHEET_ID = GOOGLE_SHEETS_CONFIG.spreadsheetId;

/** ID sheet đang dùng: ID đặt ở Cài đặt, không có thì ID mặc định */
export function getActiveSpreadsheetId(): string {
  return useAppSettingsStore.getState().spreadsheetId || DEFAULT_SPREADSHEET_ID;
}

export function spreadsheetUrlOf(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

/** Header gửi kèm mọi lần gọi /api/google-sheets/* để server dùng đúng sheet */
export function sheetsRequestHeaders(extra: Record<string, string> = {}, spreadsheetId?: string): Record<string, string> {
  return { ...extra, 'X-Spreadsheet-Id': spreadsheetId || getActiveSpreadsheetId() };
}
