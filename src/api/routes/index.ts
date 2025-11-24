import { IncomingMessage, ServerResponse } from 'http';
import { parseQueryParams, parseJsonBody, sendJson, errorResponse } from '../utils/http';
import { handleBuy } from './bsc/buy';
import { handleSell } from './bsc/sell';
import { handleQuoteBuy, handleQuoteSell } from './bsc/quote';
import { handleSwapBuy, handleSwapSell } from './bsc/swap';
import { handleBalances } from './bsc/balances';
import { handleTxStatus } from './bsc/tx';
function getChain(req: IncomingMessage, body: any): string | undefined {
    const q = parseQueryParams(req);
    const chain = (body?.chain ?? q.chain ?? '').toString().trim().toLowerCase();
    return chain || undefined;
}
export async function route(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const urlStr = req.url;
    if (!urlStr || String(urlStr).trim() === '') {
        sendJson(res, 400, errorResponse('MISSING_URL', '请求缺少 URL'));
        return true;
    }
    const pathname = urlStr.split('?')[0];
    let body: any = (req as any)._parsedBody;
    if (!body && req.method === 'POST') {
        try {
            body = await parseJsonBody(req);
            (req as any)._parsedBody = body;
        }
        catch (e: any) {
            sendJson(res, 400, errorResponse('INVALID_JSON', '请求体必须为合法 JSON', { detail: e?.message || String(e) }));
            return true;
        }
    }
    const chain = getChain(req, body);
    const isBsc = chain === 'bsc';
    if (pathname === '/buy') {
        if (!chain) {
            sendJson(res, 400, errorResponse('MISSING_CHAIN', '缺少 chain 参数'));
            return true;
        }
        if (isBsc)
            return await handleBuy(req, res), true;
        sendJson(res, 400, errorResponse('UNSUPPORTED_CHAIN', '不支持的链', { chain }));
        return true;
    }
    if (pathname === '/sell') {
        if (!chain) {
            sendJson(res, 400, errorResponse('MISSING_CHAIN', '缺少 chain 参数'));
            return true;
        }
        if (isBsc)
            return await handleSell(req, res), true;
        sendJson(res, 400, errorResponse('UNSUPPORTED_CHAIN', '不支持的链', { chain }));
        return true;
    }
    if (pathname === '/quote/buy') {
        if (!chain) {
            sendJson(res, 400, errorResponse('MISSING_CHAIN', '缺少 chain 参数'));
            return true;
        }
        if (isBsc)
            return await handleQuoteBuy(req, res), true;
        sendJson(res, 400, errorResponse('UNSUPPORTED_CHAIN', '不支持的链', { chain }));
        return true;
    }
    if (pathname === '/quote/sell') {
        if (!chain) {
            sendJson(res, 400, errorResponse('MISSING_CHAIN', '缺少 chain 参数'));
            return true;
        }
        if (isBsc)
            return await handleQuoteSell(req, res), true;
        sendJson(res, 400, errorResponse('UNSUPPORTED_CHAIN', '不支持的链', { chain }));
        return true;
    }
    if (pathname === '/quote') {
        if (!chain) {
            sendJson(res, 400, errorResponse('MISSING_CHAIN', '缺少 chain 参数'));
            return true;
        }
        if (isBsc) {
            const body = (req as any)._parsedBody ?? {};
            const sideRaw = String((body as any).side ?? '').trim().toLowerCase();
            const hasBuyParams = (body as any).bnb_cost !== undefined;
            const hasSellParams = (body as any).amount !== undefined || (body as any).amountWei !== undefined || (body as any).percent !== undefined;
            if (sideRaw === 'buy' || (hasBuyParams && !hasSellParams))
                return await handleQuoteBuy(req, res), true;
            if (sideRaw === 'sell' || (hasSellParams && !hasBuyParams))
                return await handleQuoteSell(req, res), true;
            return sendJson(res, 400, errorResponse('AMBIGUOUS_QUOTE', '请指定 side=buy|sell 或提供明确的买入/卖出参数')),
                true;
        }
        sendJson(res, 400, errorResponse('UNSUPPORTED_CHAIN', '不支持的链', { chain }));
        return true;
    }
    if (pathname === '/swap/buy') {
        if (!chain) {
            sendJson(res, 400, errorResponse('MISSING_CHAIN', '缺少 chain 参数'));
            return true;
        }
        if (isBsc)
            return await handleSwapBuy(req, res), true;
        sendJson(res, 400, errorResponse('UNSUPPORTED_CHAIN', '不支持的链', { chain }));
        return true;
    }
    if (pathname === '/swap/sell') {
        if (!chain) {
            sendJson(res, 400, errorResponse('MISSING_CHAIN', '缺少 chain 参数'));
            return true;
        }
        if (isBsc)
            return await handleSwapSell(req, res), true;
        sendJson(res, 400, errorResponse('UNSUPPORTED_CHAIN', '不支持的链', { chain }));
        return true;
    }
    if (pathname === '/swap') {
        if (!chain) {
            sendJson(res, 400, errorResponse('MISSING_CHAIN', '缺少 chain 参数'));
            return true;
        }
        if (isBsc) {
            const body = (req as any)._parsedBody ?? {};
            const side = String((body as any).side ?? '').trim().toLowerCase();
            if (side === 'buy')
                return await handleSwapBuy(req, res), true;
            if (side === 'sell')
                return await handleSwapSell(req, res), true;
            return sendJson(res, 400, errorResponse('MISSING_SIDE', '缺少 side=buy|sell 参数')),
                true;
        }
        sendJson(res, 400, errorResponse('UNSUPPORTED_CHAIN', '不支持的链', { chain }));
        return true;
    }
    if (pathname === '/balances') {
        if (!chain) {
            sendJson(res, 400, errorResponse('MISSING_CHAIN', '缺少 chain 参数'));
            return true;
        }
        if (isBsc)
            return await handleBalances(req, res), true;
        sendJson(res, 400, errorResponse('UNSUPPORTED_CHAIN', '不支持的链', { chain }));
        return true;
    }
    if (pathname === '/tx/status') {
        if (!chain) {
            sendJson(res, 400, errorResponse('MISSING_CHAIN', '缺少 chain 参数'));
            return true;
        }
        if (isBsc)
            return await handleTxStatus(req, res), true;
        sendJson(res, 400, errorResponse('UNSUPPORTED_CHAIN', '不支持的链', { chain }));
        return true;
    }
    return false;
}
