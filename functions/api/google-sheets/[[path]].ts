/**
 * Cloudflare Pages Function: /api/google-sheets/status | pull-all | sync-all
 * Biến môi trường (GOOGLE_PRIVATE_KEY, GOOGLE_CLIENT_EMAIL, VITE_GOOGLE_SPREADSHEET_ID...)
 * khai báo trong Cloudflare → Workers & Pages → (project) → Settings → Variables and Secrets.
 */
import { applySpreadsheetOverride, handleSheetsApi, resolveSheetsConfig, type SheetsEnv } from '../../../src/server/sheetsCore';

interface PagesContext {
  request: Request;
  env: SheetsEnv;
}

export const onRequest = async ({ request, env }: PagesContext): Promise<Response> => {
  const url = new URL(request.url);
  const result = await handleSheetsApi(request.method, url.pathname, () => request.json(), applySpreadsheetOverride(resolveSheetsConfig(env), request.headers.get('X-Spreadsheet-Id')));
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
