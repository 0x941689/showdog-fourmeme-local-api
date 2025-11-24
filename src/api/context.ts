import { ethers } from 'ethers';
import { OptimizedTokenInfoAggregator } from '../chains/bsc/trading/optimized-aggregator';
import { FourememeTrader } from '../chains/bsc/trading/trader';
import { PancakeV2Trader } from '../chains/bsc/trading/pancake-v2';
import { EVM_RPC, pickRpcUrl } from '../config/rpc';
import { loadWalletsFromEnv } from '../config/env';
type WalletsConfig = {
    wallets: {
        id: number;
        name?: string;
        privateKey: string;
    }[];
};
export let walletCfg: WalletsConfig = loadWalletsFromEnv();
const bscRpcPick = (() => {
    const cfg = EVM_RPC['bsc'];
    if (!cfg)
        throw new Error('未找到 BSC 的 RPC 配置（src/config/rpc.ts）');
    return pickRpcUrl(cfg);
})();
const RPC_URL = bscRpcPick.url;
const USE_WS = bscRpcPick.isWs;
export const currentRpc = { url: RPC_URL, isWs: USE_WS } as const;
function wrapProviderWithLogging(p: any): any {
    const wrap = (target: any) => new Proxy(target, {
        get(obj, prop) {
            const v = (obj as any)[prop];
            if (typeof v !== 'function')
                return v;
            return async (...args: any[]) => {
                const started = Date.now();
                try {
                    const r = await v.apply(obj, args);
                    const cost = Date.now() - started;
                    const method = String(prop);
                    if (!/^(send|call|perform|_.*)$/.test(method)) {
                        const ts = new Date().toISOString();
                    }
                    return r;
                }
                catch (err: any) {
                    const cost = Date.now() - started;
                    const ts = new Date().toISOString();
                    throw err;
                }
            };
        }
    });
    return wrap(p);
}
export let provider: any = USE_WS
    ? new ethers.providers.WebSocketProvider(RPC_URL)
    : new ethers.providers.StaticJsonRpcProvider(RPC_URL);
provider = wrapProviderWithLogging(provider);
export let aggregator: OptimizedTokenInfoAggregator = new OptimizedTokenInfoAggregator(provider);
export function getTraderById(id?: number): FourememeTrader {
    if (id === undefined || id === null || !Number.isFinite(Number(id))) {
        throw new Error('缺少或无效的 walletId：必须显式传入有效数字');
    }
    const i = Number(id);
    const w = walletCfg.wallets.find(w => w.id === i);
    if (!w)
        throw new Error(`钱包不存在：id=${i}`);
    return new FourememeTrader(provider as any, w.privateKey);
}
export function getPancakeTraderById(id?: number): PancakeV2Trader {
    if (id === undefined || id === null || !Number.isFinite(Number(id))) {
        throw new Error('缺少或无效的 walletId：必须显式传入有效数字');
    }
    const i = Number(id);
    const w = walletCfg.wallets.find(w => w.id === i);
    if (!w)
        throw new Error(`钱包不存在：id=${i}`);
    return new PancakeV2Trader(provider as any, w.privateKey);
}
let wsKeepAliveTimer: NodeJS.Timeout | null = null;
let wsPongTimeoutTimer: NodeJS.Timeout | null = null;
let wsBlockStallTimer: NodeJS.Timeout | null = null;
let wsReconnectTimer: NodeJS.Timeout | null = null;
let wsRestarting = false;
let reconnectAttempts = 0;
let reconnectDelayMs = 2000;
let lastBlockTs = 0;
let lastPongTs = 0;
const KEEP_ALIVE_INTERVAL_MS = 30000;
const PONG_TIMEOUT_MS = 15000;
const BLOCK_STALL_THRESHOLD_MS = 60000;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_MULTIPLIER = 1.5;
function clearTimers() {
    if (wsKeepAliveTimer) {
        clearInterval(wsKeepAliveTimer);
        wsKeepAliveTimer = null;
    }
    if (wsPongTimeoutTimer) {
        clearTimeout(wsPongTimeoutTimer);
        wsPongTimeoutTimer = null;
    }
    if (wsBlockStallTimer) {
        clearTimeout(wsBlockStallTimer);
        wsBlockStallTimer = null;
    }
    if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
    }
}
function setupWsEventListeners() {
    const ws: any = (provider as any)._websocket;
    if (!ws)
        return;
    try {
        (provider as any).on?.('block', () => { lastBlockTs = Date.now(); });
    }
    catch { }
    ws.on('open', () => { lastPongTs = Date.now(); });
    ws.on('pong', () => { lastPongTs = Date.now(); });
    ws.on('close', () => {
        console.warn('[WS] 连接已关闭，计划进行重连...');
        scheduleReconnect('ws-close');
    });
    ws.on('error', (err: any) => {
        console.warn('[WS] 错误：', err?.message || String(err));
        scheduleReconnect('ws-error');
    });
}
function scheduleReconnect(reason: string) {
    if (wsRestarting)
        return;
    clearTimers();
    const delay = Math.min(reconnectDelayMs * Math.pow(RECONNECT_MULTIPLIER, reconnectAttempts), RECONNECT_MAX_DELAY_MS);
    reconnectAttempts += 1;
    const translateReason = (r: string) => {
        switch (r) {
            case 'ws-close': return 'WS 连接关闭';
            case 'ws-error': return 'WS 错误';
            case 'heartbeat-timeout': return '心跳超时';
            case 'rpc-ping-failed': return 'RPC 心跳失败';
            case 'ping-exception': return 'Ping 异常';
            case 'block-stall': return '长时间未产生区块';
            default: return r;
        }
    };
    console.warn(`[WS] 计划在 ${Math.round(delay)} 毫秒后重启 Provider，原因：${translateReason(reason)}（第 ${reconnectAttempts} 次尝试）`);
    wsReconnectTimer = setTimeout(() => { void restartProvider(reason); }, delay);
}
export function startWsKeepAlive() {
    if (!(provider instanceof ethers.providers.WebSocketProvider))
        return;
    clearTimers();
    setupWsEventListeners();
    const ws: any = (provider as any)._websocket;
    wsKeepAliveTimer = setInterval(() => {
        try {
            if (ws?.ping) {
                ws.ping();
                if (wsPongTimeoutTimer)
                    clearTimeout(wsPongTimeoutTimer);
                wsPongTimeoutTimer = setTimeout(() => {
                    const sincePong = Date.now() - lastPongTs;
                    if (sincePong > PONG_TIMEOUT_MS * 2) {
                        console.warn('[WS] 心跳超时；终止套接字以触发重连');
                        try {
                            ws.terminate();
                        }
                        catch { }
                        scheduleReconnect('heartbeat-timeout');
                    }
                }, PONG_TIMEOUT_MS);
            }
            else {
                const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('RPC 心跳超时')), PONG_TIMEOUT_MS));
                Promise.race([(provider as any).getBlockNumber(), timeout])
                    .then(() => { lastBlockTs = Date.now(); })
                    .catch(() => { scheduleReconnect('rpc-ping-failed'); });
            }
        }
        catch (e: any) {
            console.warn('[WS] Ping 异常：', e?.message || String(e));
            scheduleReconnect('ping-exception');
        }
    }, KEEP_ALIVE_INTERVAL_MS);
    wsBlockStallTimer = setInterval(() => {
        if (Date.now() - lastBlockTs > BLOCK_STALL_THRESHOLD_MS) {
            console.warn('[WS] 长时间未产生区块；计划重连');
            scheduleReconnect('block-stall');
        }
    }, Math.max(KEEP_ALIVE_INTERVAL_MS, 20000));
}
export function stopWsKeepAlive() {
    clearTimers();
}
export async function restartProvider(reason: string) {
    if (wsRestarting)
        return;
    wsRestarting = true;
    try {
        stopWsKeepAlive();
        try {
            (provider as any)?._websocket?.terminate?.();
        }
        catch { }
        try {
            (provider as any)?.destroy?.();
        }
        catch { }
        provider = USE_WS
            ? new ethers.providers.WebSocketProvider(RPC_URL)
            : new ethers.providers.StaticJsonRpcProvider(RPC_URL);
        provider = wrapProviderWithLogging(provider);
        aggregator = new OptimizedTokenInfoAggregator(provider);
        if (USE_WS)
            startWsKeepAlive();
        reconnectAttempts = 0;
        reconnectDelayMs = 2000;
    }
    catch (e: any) {
        console.error('[Provider] 重启失败：', e?.message || String(e));
    }
    finally {
        wsRestarting = false;
    }
}
