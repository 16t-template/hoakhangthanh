import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  Search,
  Settings,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { useAuthStore, isUserAdmin } from '@/stores/auth';
import {
  DEFAULT_SPREADSHEET_ID,
  parseSpreadsheetId,
  spreadsheetUrlOf,
  useAppSettingsStore,
} from '@/stores/appSettingsStore';
import { reloadFromNewSpreadsheet, useGoogleSheetsStore } from '@/stores/googleSheetsStore';
import { checkGoogleSheetsConnection, type GoogleSheetsStatus } from '@/lib/googleSheetsService';
import { GOOGLE_SHEETS_CONFIG } from '@/config/googleSheetsConfig';

/** Các tab app đọc / ghi. Sheet mới nên có đủ các tab này (dòng 1 là tiêu đề cột). */
const REQUIRED_TABS = [
  'DON_HANG',
  'CHI_TIET_DON_HANG',
  'DANH_SACH_HOA',
  'NHA_PHAN_PHOI',
  'NHA_CUNG_CAP',
  'DON_NHAP_NCC',
  'CONG_NO_NPP',
  'CONG_NO_NCC',
  'THU_CHI',
  'TON_KHO',
  'TON_NGAY',
  'NHAN_VIEN',
];

export default function CaiDatPage() {
  const user = useAuthStore((s) => s.user);
  const savedId = useAppSettingsStore((s) => s.spreadsheetId);
  const setSpreadsheetId = useAppSettingsStore((s) => s.setSpreadsheetId);
  const isSyncing = useGoogleSheetsStore((s) => s.isSyncing);

  const activeId = savedId || DEFAULT_SPREADSHEET_ID;
  const isDefault = !savedId || savedId === DEFAULT_SPREADSHEET_ID;

  const [input, setInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [result, setResult] = useState<(GoogleSheetsStatus & { checkedId: string }) | null>(null);

  const parsedId = useMemo(() => parseSpreadsheetId(input), [input]);
  const serviceEmail = result?.clientEmail || GOOGLE_SHEETS_CONFIG.serviceAccount.clientEmail;

  const missingTabs = useMemo(() => {
    if (!result?.connected) return [];
    const titles = new Set(result.sheets.map((s) => s.title));
    return REQUIRED_TABS.filter((t) => !titles.has(t));
  }, [result]);

  if (!isUserAdmin(user)) {
    return (
      <div className="p-6">
        <div className="max-w-xl mx-auto p-6 rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/30 text-sm flex gap-3">
          <ShieldAlert className="text-rose-600 shrink-0" size={20} />
          <div>
            Module <strong>Cài đặt</strong> chỉ dành cho Quản trị viên (Admin).
          </div>
        </div>
      </div>
    );
  }

  const handleCheck = async (id = parsedId) => {
    if (!id) {
      toast.error('Link hoặc ID Google Sheet không hợp lệ');
      return;
    }
    setChecking(true);
    setResult(null);
    try {
      const info = await checkGoogleSheetsConnection(id);
      setResult({ ...info, checkedId: id });
      if (info.connected) toast.success(`Kết nối được: ${info.title}`);
      else toast.error('Không kết nối được sheet này');
    } finally {
      setChecking(false);
    }
  };

  const applyId = async (id: string, label: string) => {
    setSwitching(true);
    try {
      setSpreadsheetId(id === DEFAULT_SPREADSHEET_ID ? '' : id);
      const ok = await reloadFromNewSpreadsheet();
      if (ok) {
        toast.success(`Đã chuyển sang ${label} và tải dữ liệu về`);
        setInput('');
        setResult(null);
      } else {
        toast.error('Đã lưu ID sheet nhưng chưa tải được dữ liệu. App tạm dừng ghi lên Sheets cho tới khi tải lại được.');
      }
    } finally {
      setSwitching(false);
    }
  };

  const handleSave = async () => {
    if (!result?.connected || result.checkedId !== parsedId) {
      toast.error('Bấm "Kiểm tra" và kết nối thành công trước khi lưu');
      return;
    }
    const warn = missingTabs.length
      ? `\n\nSheet này còn thiếu ${missingTabs.length} tab: ${missingTabs.join(', ')}. Dữ liệu của các tab này sẽ không đồng bộ được.`
      : '';
    if (
      !confirm(
        `Chuyển app sang đọc / ghi Google Sheet "${result.title}"?\n\nApp sẽ tải dữ liệu từ sheet này về. Nếu sheet mới đang trống, dữ liệu hiện có trên máy này sẽ được ghi vào sheet mới ở lần đồng bộ kế tiếp.${warn}`,
      )
    ) {
      return;
    }
    await applyId(parsedId, `sheet "${result.title}"`);
  };

  const handleResetDefault = async () => {
    if (isDefault) return;
    if (!confirm('Quay lại dùng Google Sheet mặc định của hệ thống? App sẽ tải lại dữ liệu từ sheet mặc định.')) return;
    await applyId(DEFAULT_SPREADSHEET_ID, 'sheet mặc định');
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(serviceEmail);
      toast.success('Đã sao chép email');
    } catch {
      toast.error('Không sao chép được, hãy bôi đen và sao chép thủ công');
    }
  };

  const busy = checking || switching || isSyncing;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto bg-background p-3 sm:p-4 space-y-3">
      {/* Tiêu đề */}
      <div className="p-3.5 rounded-xl border border-border bg-card shadow-sm flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-slate-500/10 text-slate-700 dark:text-slate-300">
          <Settings size={24} />
        </div>
        <div>
          <h1 className="text-base sm:text-lg font-bold text-foreground">Cài đặt</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Cấu hình kết nối Google Sheets cho ứng dụng</p>
        </div>
      </div>

      {/* Sheet đang dùng */}
      <section className="p-4 rounded-xl border border-border bg-card shadow-sm space-y-3">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <FileSpreadsheet size={16} className="text-emerald-600" /> Google Sheet đang dùng
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <code className="px-2 py-1 rounded bg-muted border border-border font-mono break-all">{activeId}</code>
          {isDefault ? (
            <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-semibold">
              Mặc định
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-semibold dark:bg-blue-950/50 dark:text-blue-300">
              Đã đổi ở Cài đặt
            </span>
          )}
          <a
            href={spreadsheetUrlOf(activeId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline font-semibold"
          >
            Mở sheet <ExternalLink size={12} />
          </a>
          {!isDefault && (
            <Button size="sm" variant="outline" onClick={handleResetDefault} disabled={busy} className="h-7 text-xs gap-1">
              <RotateCcw size={12} /> Dùng lại sheet mặc định
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Cài đặt này lưu trên trình duyệt của máy đang dùng. Máy / trình duyệt khác cần đặt lại nếu muốn dùng sheet khác mặc định.
        </p>
      </section>

      {/* Đổi sheet */}
      <section className="p-4 rounded-xl border border-border bg-card shadow-sm space-y-3">
        <h2 className="text-sm font-bold text-foreground">Đổi sang Google Sheet khác</h2>

        <div className="rounded-lg border border-amber-200 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-900 p-3 text-xs space-y-2">
          <div className="font-semibold text-amber-900 dark:text-amber-200">Bước 1: Chia sẻ sheet cho app</div>
          <div className="text-amber-900/90 dark:text-amber-100/90">
            Mở Google Sheet → bấm <strong>Chia sẻ</strong> → dán email dưới đây → chọn quyền <strong>Người chỉnh sửa</strong> → Gửi.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="px-2 py-1 rounded bg-background border border-border font-mono break-all">{serviceEmail}</code>
            <Button size="sm" variant="outline" onClick={copyEmail} className="h-7 text-xs gap-1">
              <Copy size={12} /> Sao chép
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground block">
            Bước 2: Dán link hoặc ID Google Sheet
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setResult(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && parsedId && void handleCheck()}
              placeholder="https://docs.google.com/spreadsheets/d/.../edit  hoặc  1AbC...xyz"
              className="flex-1 h-9 px-3 text-xs rounded-lg border border-border bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <Button size="sm" onClick={() => void handleCheck()} disabled={!parsedId || busy} className="h-9 gap-1.5">
              {checking ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Kiểm tra
            </Button>
          </div>
          {input && !parsedId && (
            <p className="text-[11px] text-rose-600">Không đọc được ID từ nội dung này. Hãy dán đúng link Google Sheets.</p>
          )}
          {parsedId && (
            <p className="text-[11px] text-muted-foreground">
              ID: <code className="font-mono">{parsedId}</code>
              {parsedId === activeId && ' (đang dùng)'}
            </p>
          )}
        </div>

        {/* Kết quả kiểm tra */}
        {result && (
          <div
            className={`rounded-lg border p-3 text-xs space-y-2 ${
              result.connected
                ? 'border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/20 dark:border-emerald-900'
                : 'border-rose-200 bg-rose-50/60 dark:bg-rose-950/20 dark:border-rose-900'
            }`}
          >
            {result.connected ? (
              <>
                <div className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 size={14} /> Kết nối được: {result.title} ({result.sheets.length} tab)
                </div>
                {missingTabs.length === 0 ? (
                  <div className="text-emerald-800/90 dark:text-emerald-200/90">Đủ các tab app cần.</div>
                ) : (
                  <div className="text-amber-800 dark:text-amber-200">
                    Còn thiếu {missingTabs.length} tab (tạo thêm trong sheet, dòng 1 là tiêu đề cột):{' '}
                    <strong>{missingTabs.join(', ')}</strong>
                  </div>
                )}
                <Button size="sm" onClick={handleSave} disabled={busy} className="h-8 gap-1.5 mt-1">
                  {switching ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Lưu & dùng sheet này
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5 font-semibold text-rose-700 dark:text-rose-300">
                  <XCircle size={14} /> Không kết nối được sheet này
                </div>
                <div className="text-rose-800/90 dark:text-rose-200/90">
                  Kiểm tra lại link / ID và chắc chắn đã chia sẻ sheet cho email ở Bước 1 với quyền Người chỉnh sửa.
                </div>
                {result.error && (
                  <div className="font-mono text-[10px] text-muted-foreground break-all line-clamp-3">{result.error}</div>
                )}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
