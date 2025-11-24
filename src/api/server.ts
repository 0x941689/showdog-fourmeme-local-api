import { createServer, IncomingMessage, ServerResponse } from 'http';
import { route } from './routes';
import { currentRpc, startWsKeepAlive } from './context';
import { sendJson } from './utils/http';
import { printStartupBanner } from './utils/startup-info';

const rawPort = process.env.PORT;
if (!rawPort || String(rawPort).trim() === '') {
    throw new Error('缺少必填环境变量 PORT：请在 .env 中设置服务端口');
}
const PORT_NUM = Number(String(rawPort).trim());
if (!Number.isFinite(PORT_NUM) || PORT_NUM <= 0 || PORT_NUM >= 65536 || !Number.isInteger(PORT_NUM)) {
    throw new Error(`PORT 非法：必须为 1-65535 的整数；当前值：${rawPort}`);
}
const PORT = PORT_NUM;
const rawHost = process.env.HOST;
if (!rawHost || String(rawHost).trim() === '') {
    throw new Error('缺少必填环境变量 HOST：请在 .env 中设置服务绑定地址（如 127.0.0.1 或 0.0.0.0）');
}
const HOST_CANDIDATE = String(rawHost).trim();
function isValidIpv4Literal(ip: string): boolean {
    const parts = ip.split('.');
    if (parts.length !== 4) return false;
    return parts.every(p => { if (!/^\d+$/.test(p)) return false; const n = Number(p); return Number.isFinite(n) && n >= 0 && n <= 255; });
}
if (!isValidIpv4Literal(HOST_CANDIDATE)) {
    throw new Error(`HOST 非法：仅支持 IPv4 地址（如 127.0.0.1/0.0.0.0）；当前值：${HOST_CANDIDATE}`);
}
const HOST = HOST_CANDIDATE;

const rawWhitelistEnv = process.env.API_WHITELIST;
if (!rawWhitelistEnv || String(rawWhitelistEnv).trim() === '') {
    throw new Error('缺少必填环境变量 API_WHITELIST：请在 .env 中配置允许的 IPv4 地址或 CIDR 网段');
}
const rawWhitelist = String(rawWhitelistEnv).trim();
const WHITELIST_RULES = rawWhitelist.split(',').map(s => s.trim()).filter(Boolean);

function normalizeToIpv4(ip: string): string {
    const s = String(ip || '').trim();
    if (!s) return '';
    if (s.startsWith('::ffff:')) return s.slice(7);
    return s;
}
function isValidIpv4(ip: string): boolean {
    const parts = ip.split('.');
    if (parts.length !== 4) return false;
    return parts.every(p => {
        if (!/^\d+$/.test(p)) return false;
        const n = Number(p);
        return Number.isFinite(n) && n >= 0 && n <= 255;
    });
}
function ipv4ToInt(ip: string): number {
    const parts = ip.split('.').map(n => Number(n));
    if (parts.length !== 4 || parts.some(n => !Number.isFinite(n) || n < 0 || n > 255)) return -1;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}
function matchIpv4OrCidr(rule: string, ip: string): boolean {
    const rr = String(rule || '').trim();
    if (!rr) return false;
    if (rr.includes('/')) {
        const [base, prefixStr] = rr.split('/');
        const baseV4 = normalizeToIpv4(base);
        if (!isValidIpv4(baseV4)) return false;
        const prefix = Number(prefixStr);
        if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return false;
        const ipInt = ipv4ToInt(ip);
        const baseInt = ipv4ToInt(baseV4);
        if (ipInt < 0 || baseInt < 0) return false;
        const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
        return ((ipInt & mask) >>> 0) === ((baseInt & mask) >>> 0);
    }
    const r4 = normalizeToIpv4(rr);
    return isValidIpv4(r4) && ip === r4;
}
function validateWhitelistOrThrow(rules: string[]): void {
    for (const r of rules) {
        const rr = String(r || '').trim();
        if (!rr) throw new Error('API_WHITELIST 中存在空条目');
        if (rr.includes('/')) {
            const [base, prefixStr] = rr.split('/');
            const baseV4 = normalizeToIpv4(base);
            const prefix = Number(prefixStr);
            if (!isValidIpv4(baseV4) || !Number.isFinite(prefix) || prefix < 0 || prefix > 32) {
                throw new Error(`API_WHITELIST 条目非法（CIDR）：${rr}；示例：192.168.0.0/16`);
            }
        }
        else {
            const v4 = normalizeToIpv4(rr);
            if (!isValidIpv4(v4)) {
                throw new Error(`API_WHITELIST 条目非法（IPv4）：${rr}；示例：127.0.0.1 或 10.0.0.5`);
            }
        }
    }
}
validateWhitelistOrThrow(WHITELIST_RULES);
function getRequestIp(req: IncomingMessage): string {
    const xf = String((req.headers['x-forwarded-for'] as string) || '').split(',')[0].trim();
    const ra = (req.socket as any)?.remoteAddress || '';
    const ipCandidate = xf || ra;
    const v4 = normalizeToIpv4(ipCandidate);
    return isValidIpv4(v4) ? v4 : '';
}
function isIpAllowed(req: IncomingMessage): boolean {
    const ip = getRequestIp(req);
    if (!ip) return false;
    for (const rule of WHITELIST_RULES) {
        if (matchIpv4OrCidr(rule, ip)) return true;
    }
    return false;
}
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
        (res as any)._req = req;
        if (!isIpAllowed(req)) {
            sendJson(res, 403, { error: 'FORBIDDEN', reason: '来源 IP 不在白名单', ip: getRequestIp(req) });
            return;
        }
        const handled = await route(req, res);
        if (!handled) {
            sendJson(res, 404, { error: 'NOT_FOUND', path: req.url || '/', method: req.method });
        }
    }
    catch (err: any) {
        sendJson(res, 500, { error: 'INTERNAL_ERROR', detail: err?.message || String(err) });
    }
});
server.listen(PORT, HOST, async () => {
    try {
        if (currentRpc.isWs)
            startWsKeepAlive();
    }
    catch { }
    
    await printStartupBanner(PORT, HOST, WHITELIST_RULES);
});
