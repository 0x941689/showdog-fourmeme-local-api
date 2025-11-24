import { IncomingMessage } from 'http';
import { promises as fs } from 'fs';
import * as path from 'path';
const LOG_BASE_DIR = path.resolve(process.cwd(), 'logs', 'api');
function sanitize(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}
function deriveEndpoint(req: IncomingMessage | undefined, body: any): string {
    if (body && typeof body.endpoint === 'string' && body.endpoint.trim().length > 0) {
        return body.endpoint.trim();
    }
    try {
        const urlStr = typeof req?.url === 'string' ? req!.url : '';
        if (!urlStr) return 'unknown';
        const pathname = urlStr.split('?')[0].replace(/^\//, '');
        return pathname || 'root';
    }
    catch {
        return 'unknown';
    }
}
export async function logApiResponse(req: IncomingMessage | undefined, status: number, body: any): Promise<void> {
    try {
        const ts = new Date().toISOString();
        const method = req?.method || 'UNKNOWN';
        const url = req?.url || '';
        const ip = (req?.headers?.['x-forwarded-for'] as string) || req?.socket?.remoteAddress || '';
        const endpoint = sanitize(deriveEndpoint(req, body));
        const filePath = path.join(LOG_BASE_DIR, `${endpoint}.log`);
        const line = JSON.stringify({ ts, method, url, ip, status, body });
        await fs.mkdir(LOG_BASE_DIR, { recursive: true });
        await fs.appendFile(filePath, line + '\n', 'utf8');
    }
    catch {
    }
}
