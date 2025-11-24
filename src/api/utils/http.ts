import { IncomingMessage, ServerResponse } from 'http';
import { logApiResponse } from './logger';
export async function parseJsonBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => {
            data += chunk;
            if (data.length > 1e6) {
                reject(new Error('请求体过大（Payload too large）'));
                try {
                    (req as any).destroy?.();
                }
                catch { }
            }
        });
        req.on('end', () => {
            try {
                resolve(data ? JSON.parse(data) : {});
            }
            catch (e) {
                reject(new Error('JSON 格式无效（Invalid JSON）'));
            }
        });
        req.on('error', reject);
    });
}
export function sendJson(res: ServerResponse, status: number, body: any) {
    const payload = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(payload);
    try {
        const req: IncomingMessage | undefined = (res as any)._req;
        void logApiResponse(req, status, body);
    }
    catch {
    }
}
export function parseQueryParams(req: IncomingMessage): Record<string, string> {
    try {
        const urlStr: string | undefined = (req as any).url;
        if (!urlStr || typeof urlStr !== 'string') return {};
        const qIndex = urlStr.indexOf('?');
        if (qIndex < 0) return {};
        const search = urlStr.slice(qIndex + 1);
        const params: Record<string, string> = {};
        const sp = new URLSearchParams(search);
        sp.forEach((v, k) => { params[k] = v; });
        return params;
    }
    catch {
        return {};
    }
}
export function errorResponse(code: string, message: string, extra: Record<string, any> = {}) {
    return { error: code, message, ...extra };
}
