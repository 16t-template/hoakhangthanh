import type { SheetTable } from './sheetTables';

/**
 * Ghi theo dòng: nhớ "ảnh chụp" nội dung từng dòng trên Google Sheets (theo id ở cột A)
 * kể từ lần tải về / lần ghi gần nhất. Khi web thay đổi dữ liệu, chỉ gửi lên các dòng
 * MỚI / ĐỔI / BỊ XOÁ thay vì ghi lại cả bảng (vài KB thay vì ~10 MB).
 */

/** Cột thay đổi mỗi lần ghi (không dùng để so sánh): DON_HANG cột M "Cập nhật lúc" */
const VOLATILE_COLS: Record<string, number[]> = { DON_HANG: [12] };

/** Chặn xoá hàng loạt bất thường (vd. dữ liệu trên web chưa tải đủ) */
const MASS_DELETE_MIN = 50;
const MASS_DELETE_RATIO = 0.3;

// sheet → (id → nội dung dòng trên sheet)
const snapshots = new Map<string, Map<string, unknown[]>>();
// sheet → các id web đã thật sự tải được (chỉ những id này mới được phép xoá trên sheet).
// Dòng web không đọc được (vd. chi tiết thiếu mã hoa) sẽ được giữ nguyên trên sheet.
const loadedIds = new Map<string, Set<string>>();

function canonNumber(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '';
  return String(Math.round(n * 1000) / 1000);
}

/** Chuẩn hoá 1 ô để so sánh: số dạng "1.550.000" (sheet) và 1550000 (web) là như nhau; 0 = trống */
function norm(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return canonNumber(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  const t = String(v).trim();
  if (!t) return '';
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return canonNumber(Number(t.replace(/\./g, '').replace(',', '.')));
  if (/^-?\d+(,\d+)?$/.test(t)) return canonNumber(Number(t.replace(',', '.')));
  if (/^-?\d+\.\d+$/.test(t)) return canonNumber(Number(t));
  return t;
}

function signature(sheet: string, row: unknown[], width: number): string {
  const skip = VOLATILE_COLS[sheet] || [];
  const out: string[] = [];
  for (let i = 0; i < width; i++) {
    if (skip.includes(i)) continue;
    out.push(norm(row[i]));
  }
  // bỏ các ô trống ở cuối (sheet tự cắt ô trống cuối dòng)
  while (out.length && out[out.length - 1] === '') out.pop();
  return JSON.stringify(out);
}

const idOf = (row: unknown[]) => String(row[0] ?? '').trim();
const isBlankRow = (row: unknown[]) => row.every((c) => c === '' || c === null || c === undefined);

/** Gọi sau khi tải từ sheet: lưu ảnh chụp các sheet có trong lần tải (kể cả sheet trống). */
export function setSnapshotsFromPull(sheetMap: Record<string, unknown[][]>) {
  snapshots.clear();
  loadedIds.clear();
  for (const [sheet, rows] of Object.entries(sheetMap)) {
    const m = new Map<string, unknown[]>();
    for (const r of rows) {
      const id = idOf(r);
      if (id && !m.has(id)) m.set(id, r);
    }
    snapshots.set(sheet, m);
  }
}

export function clearSnapshots() {
  snapshots.clear();
  loadedIds.clear();
}

/** Gọi ngay sau khi tải xong: ghi nhận các id web đã đọc được từ sheet */
export function setLoadedIdsFromTable(table: SheetTable) {
  const sheet = table.range.split('!')[0];
  const set = new Set<string>();
  for (const r of table.values) {
    const id = idOf(r);
    if (id) set.add(id);
  }
  loadedIds.set(sheet, set);
}

export function hasSnapshot(sheet: string) {
  return snapshots.has(sheet);
}

export interface TableDiff {
  sheet: string;
  upserts: unknown[][];
  deletes: string[];
  /** nội dung mới để cập nhật ảnh chụp khi ghi thành công */
  next: Map<string, unknown[]>;
  skippedMassDelete: number;
}

/**
 * So sánh bảng web đang có với ảnh chụp sheet. Trả về null nếu không ghi theo dòng được
 * (chưa có ảnh chụp, hoặc id trống / trùng) → dùng cách ghi cả bảng như cũ.
 */
export function diffTable(table: SheetTable): TableDiff | null {
  const sheet = table.range.split('!')[0];
  const snap = snapshots.get(sheet);
  if (!snap) return null;

  const rows = table.values.filter((r) => !isBlankRow(r));
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const next = new Map<string, unknown[]>();
  const upserts: unknown[][] = [];
  for (const r of rows) {
    const id = idOf(r);
    if (!id || next.has(id)) return null; // id trống / trùng → không xác định được dòng
    next.set(id, r);
    const old = snap.get(id);
    // So theo đúng số cột web ghi lên (cột thừa bên phải trên sheet không tính)
    if (!old || signature(sheet, old, width) !== signature(sheet, r, width)) upserts.push(r);
  }

  const loaded = loadedIds.get(sheet);
  let deletes = [...snap.keys()].filter((id) => !next.has(id) && (!loaded || loaded.has(id)));
  let skippedMassDelete = 0;
  if (deletes.length >= MASS_DELETE_MIN && deletes.length > snap.size * MASS_DELETE_RATIO) {
    // Nghi dữ liệu trên web chưa đầy đủ → không xoá hàng loạt trên sheet
    console.warn(`[rowSync] Bỏ qua xoá ${deletes.length}/${snap.size} dòng ở ${sheet} (nghi dữ liệu web chưa đủ)`);
    skippedMassDelete = deletes.length;
    deletes.forEach((id) => next.set(id, snap.get(id)!));
    deletes = [];
  }
  return { sheet, upserts, deletes, next, skippedMassDelete };
}

/** Ghi thành công → cập nhật ảnh chụp */
export function commitDiff(diff: TableDiff) {
  snapshots.set(diff.sheet, diff.next);
  const loaded = loadedIds.get(diff.sheet);
  if (loaded) {
    diff.upserts.forEach((r) => loaded.add(idOf(r)));
    diff.deletes.forEach((id) => loaded.delete(id));
  }
}

/** Sau khi ghi cả bảng (cách cũ) → ảnh chụp = bảng vừa ghi */
export function setSnapshotFromTable(table: SheetTable) {
  const sheet = table.range.split('!')[0];
  const rows = table.values.filter((r) => !isBlankRow(r));
  const m = new Map<string, unknown[]>();
  for (const r of rows) {
    const id = idOf(r);
    if (id && !m.has(id)) m.set(id, r);
  }
  snapshots.set(sheet, m);
  loadedIds.set(sheet, new Set(m.keys()));
}
