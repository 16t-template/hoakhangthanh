import type { IncomingMessage, ServerResponse } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { applySpreadsheetOverride, handleSheetsApi, resolveSheetsConfig, type SheetsEnv } from './sheetsCore.js';

/**
 * Adapter Node (Vite dev server + Vercel) cho lõi sheetsCore.
 * Cloudflare Pages dùng functions/api/google-sheets/[[path]].ts với cùng lõi.
 */
export async function googleSheetsHandler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  // Body có thể được nén gzip (header X-Body-Encoding: gzip) để giảm dung lượng gửi lên
  const isGzip = String(req.headers['x-body-encoding'] || '').toLowerCase() === 'gzip';
  const parseBuffer = (buf: Buffer): unknown => {
    const text = (isGzip ? gunzipSync(buf) : buf).toString('utf8');
    return text ? JSON.parse(text) : {};
  };
  const readJson = async (): Promise<unknown> => {
    if (req.body !== undefined) {
      if (Buffer.isBuffer(req.body)) return parseBuffer(req.body);
      return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        try {
          resolve(parseBuffer(Buffer.concat(chunks)));
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  };

  const pathname = (req.url || '').split('?')[0];
  const result = await handleSheetsApi(
    req.method || 'GET',
    pathname,
    readJson,
    // ID Google Sheet chọn ở module Cài đặt (header X-Spreadsheet-Id), không thì dùng ID mặc định
    applySpreadsheetOverride(resolveSheetsConfig(process.env as SheetsEnv), String(req.headers['x-spreadsheet-id'] || '')),
  );

  res.statusCode = result.status;
  res.end(JSON.stringify(result.body));
}
