import { IncomingMessage, ServerResponse } from 'http';
import { ethers } from 'ethers';
import { parseJsonBody, parseQueryParams, sendJson, errorResponse } from '../../utils/http';
import { clampDp, getMarketCapStyle, formatMarketCapWithUnit, formatUnitsTruncDp, formatEtherHuman, formatUnitsHuman, normalizeFormatted, STATUS_NAMES, } from '../../utils/format';
import { provider, walletCfg, getTraderById } from '../../context';
import { WBNB } from '../../../chains/bsc';
import { quoteBuy, quoteSell } from '../../../chains/bsc/quote/internal';
import { prepareBuyDualAllowanceMulticall, prepareSellDualAllowanceMulticall, prepareSellDualPercentageMulticall } from '../../../chains/bsc/quote/context';
function applyZeroOverride(side: 'buy' | 'sell', body: any): any {
    const out = { ...body };
    if (side === 'buy') {
        out.bnb_cost = '0';
        out.bnb_cost_wei = '0';
        out.token_amount = '0';
        out.min_token_amount = '0';
        out.token_amount_wei = '0';
        out.min_token_amount_wei = '0';
    }
    else {
        out.token_amount = '0';
        out.token_amount_wei = '0';
        out.bnb_cost = '0';
        out.bnb_cost_wei = '0';
        out.min_bnb_amount = '0';
        out.min_bnb_amount_wei = '0';
    }
    return out;
}
export async function handleQuoteBuy(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = req.method === 'GET' ? parseQueryParams(req) : ((req as any)._parsedBody ?? await parseJsonBody(req));
        const token = String((body as any).token || '').trim();
        const walletId = (body as any).walletId !== undefined ? Number((body as any).walletId) : undefined;
        const poolDp = clampDp((body as any).pool_dp);
        const mcStyle = getMarketCapStyle(body);
        if (!ethers.utils.isAddress(token)) {
            return sendJson(res, 400, errorResponse('INVALID_TOKEN_ADDRESS', '无效代币地址', { endpoint: 'quote/buy', token }));
        }
        const bnbStrRaw = String((body as any).bnb_cost || '').trim();
        const slippage = (body as any).slippage !== undefined ? Number((body as any).slippage) : 2;
        if (!bnbStrRaw || isNaN(Number(bnbStrRaw))) {
            return sendJson(res, 400, errorResponse('INVALID_BNB_COST', '无效 bnb_cost 数值', { endpoint: 'quote/buy', token, bnb_cost: bnbStrRaw }));
        }
        const bnbNum = Number(bnbStrRaw);
        if (bnbNum < 0) {
            return sendJson(res, 400, errorResponse('INVALID_BNB_COST', 'bnb_cost 不可为负数', { endpoint: 'quote/buy', token, bnb_cost: bnbStrRaw }));
        }
        const shouldOverrideZero = bnbNum === 0;
        const bnbForQuote = shouldOverrideZero ? ethers.utils.parseEther('1') : ethers.utils.parseEther(bnbStrRaw);
        if (isNaN(slippage) || slippage < 0 || slippage > 100) {
            return sendJson(res, 400, errorResponse('INVALID_SLIPPAGE', '无效滑点范围（0-100）', { endpoint: 'quote/buy', token, slippage }));
        }
        const ownerOpt = (body as any).walletId !== undefined ? getTraderById(walletId).address() : undefined;
        const hasReqNonce = (body as any).nonce !== undefined;
        const providedNonce = hasReqNonce ? Number((body as any).nonce) : null;
        const quotePromise = ownerOpt
            ? prepareBuyDualAllowanceMulticall(provider as any, token, ownerOpt, bnbForQuote, slippage)
            : quoteBuy(provider, token, bnbForQuote, slippage, undefined);
        const noncePromise = hasReqNonce
            ? Promise.resolve(providedNonce)
            : (ownerOpt ? (provider as any).getTransactionCount(ownerOpt, 'pending') : Promise.resolve(null));
        const [r, nonceVal] = await Promise.all([quotePromise, noncePromise]);
        const pendingNonce = hasReqNonce ? providedNonce : (nonceVal !== null && nonceVal !== undefined ? Number(nonceVal) : null);
        const info = (r as any).info;
        const decimals = Number(info.basicInfo.decimals || 18);
        const isXMode = !!info.poolInfo.isXMode;
        const isFour = !!info.basicInfo.isFourMemeToken;
        const status = Number(info.platformInfo.tradingStatus);
        const statusName = STATUS_NAMES[status] || '未知状态';
        const market = status === 1 ? 'internal' : status === 2 ? 'external' : 'none';
        const isBnbQuote = String(info.platformInfo.quote || '').toLowerCase() === ethers.constants.AddressZero.toLowerCase();
        const platform_code = isFour ? 1 : 0;
        const market_code = status;
        const tokenAmountBn = (r as any).tokenAmount;
        const minTokenAmountBn = (r as any).minTokenAmount;
        const pricePerToken = (r as any).pricePerToken;
        const allowanceFourmeme = (r as any).allowanceFourmeme;
        const allowanceRouter = (r as any).allowanceRouter;
        const quoteDpBase = Number(info.basicInfo.decimals || 18);
        const quoteDpQuote = Number(info.poolInfo.quoteDecimals || 18);
        const tokenUsdPriceBn: ethers.BigNumber | undefined = (r as any).tokenUsdPrice;
        const totalSupplyBn: ethers.BigNumber | undefined = info.basicInfo.totalSupply;
        const marketCapStr = (tokenUsdPriceBn && totalSupplyBn)
            ? formatMarketCapWithUnit(tokenUsdPriceBn.mul(totalSupplyBn).div(ethers.BigNumber.from(10).pow(quoteDpBase)), mcStyle)
            : null;
        let poolBaseBn = info.poolInfo.poolTokenBalance;
        let poolQuoteBn = info.poolInfo.poolQuoteBalance;
        if (market === 'external') {
            const tokenLc = token.toLowerCase();
            const v2Pair = info.poolInfo?.v2TokenQuotePair;
            const v2WbnbPair = info.poolInfo?.v2WbnbQuotePair;
            const tryMapFromPair = (pair: any) => {
                if (!pair || !pair.pair || pair.pair === ethers.constants.AddressZero)
                    return false;
                const r0Addr = String(pair.reserve0?.token || '').toLowerCase();
                const r1Addr = String(pair.reserve1?.token || '').toLowerCase();
                if (r0Addr === tokenLc) {
                    poolBaseBn = pair.reserve0?.reserve || poolBaseBn;
                    poolQuoteBn = pair.reserve1?.reserve || poolQuoteBn;
                    return true;
                }
                if (r1Addr === tokenLc) {
                    poolBaseBn = pair.reserve1?.reserve || poolBaseBn;
                    poolQuoteBn = pair.reserve0?.reserve || poolQuoteBn;
                    return true;
                }
                return false;
            };
            if (!tryMapFromPair(v2Pair))
                tryMapFromPair(v2WbnbPair);
        }
        const quoteAddrRaw = String(info.platformInfo.quote || '').trim();
        const quoteAddrNorm = (!ethers.utils.isAddress(quoteAddrRaw) || quoteAddrRaw === ethers.constants.AddressZero)
            ? WBNB
            : quoteAddrRaw;
        const useThreePath = market === 'external' && quoteAddrNorm.toLowerCase() !== WBNB.toLowerCase();
        const pathBuy = useThreePath ? [WBNB, quoteAddrNorm, token] : [WBNB, token];
        const body200 = {
            side: 'buy',
            chain: 'bsc',
            token,
            mode: isXMode ? 'xmode' : 'normal',
            market,
            is_bnb_quote: isBnbQuote,
            platform_code,
            market_code,
            status_name: statusName,
            quotetoken_address: quoteAddrNorm || null,
            use_three_path: useThreePath ? 1 : 0,
            path_buy: pathBuy,
            basetoken_symbol: info.basicInfo.symbol,
            quotetoken_symbol: info.poolInfo.quoteSymbol,
            basetoken_decimals: quoteDpBase,
            quotetoken_decimals: quoteDpQuote,
            token_amount: ethers.utils.formatUnits(tokenAmountBn, decimals),
            min_token_amount: ethers.utils.formatUnits(minTokenAmountBn, decimals),
            token_amount_wei: tokenAmountBn?.toString?.() ?? null,
            min_token_amount_wei: minTokenAmountBn?.toString?.() ?? null,
            bnb_cost: shouldOverrideZero ? '0' : ethers.utils.formatEther(bnbForQuote),
            bnb_cost_wei: shouldOverrideZero ? '0' : bnbForQuote.toString(),
            price_per_token: String(pricePerToken),
            walletId: walletId !== undefined && Number.isFinite(walletId) ? walletId : null,
            wallet_address: ownerOpt || null,
            nonce: pendingNonce !== null ? pendingNonce : undefined,
            bnb_usd_price: (r as any).bnbUsdPrice ? ethers.utils.formatUnits((r as any).bnbUsdPrice, 18) : null,
            token_usd_price: (r as any).tokenUsdPrice ? ethers.utils.formatUnits((r as any).tokenUsdPrice, 18) : null,
            market_cap: marketCapStr,
            basetoken_balance: formatUnitsTruncDp(poolBaseBn, decimals, poolDp),
            quotetoken_balance: formatUnitsTruncDp(poolQuoteBn, quoteDpQuote, poolDp),
            wallet_bnb_balance: ownerOpt && (r as any).bnbBalance ? formatEtherHuman((r as any).bnbBalance) : null,
            wallet_token_balance: ownerOpt && (r as any).tokenBalance ? formatUnitsHuman((r as any).tokenBalance, decimals) : null,
            allowance_fourmeme: ownerOpt && allowanceFourmeme !== undefined ? normalizeFormatted(ethers.utils.formatUnits(allowanceFourmeme, decimals)) : null,
            allowance_router: ownerOpt && allowanceRouter !== undefined ? normalizeFormatted(ethers.utils.formatUnits(allowanceRouter, decimals)) : null,
        };
        const ok = isFour && (status === 1 || status === 2);
        if (!ok) {
            const body400 = { ...body200, token_amount: null, min_token_amount: null, token_amount_wei: null, min_token_amount_wei: null, bnb_cost: null, bnb_cost_wei: null, price_per_token: null };
            return sendJson(res, 400, { error: 'QUOTE_UNAVAILABLE', message: '当前代币不支持买入报价', ...body400 });
        }
        return sendJson(res, 200, shouldOverrideZero ? applyZeroOverride('buy', body200) : body200);
    }
    catch (err: any) {
        return sendJson(res, 500, errorResponse('INTERNAL_ERROR', '服务端异常', { endpoint: 'quote/buy', detail: err?.message || String(err) }));
    }
}
export async function handleQuoteSell(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = req.method === 'GET' ? parseQueryParams(req) : ((req as any)._parsedBody ?? await parseJsonBody(req));
        const token = String((body as any).token || '').trim();
        const walletIdRaw = (body as any).walletId;
        if (walletIdRaw === undefined) {
            return sendJson(res, 400, errorResponse('MISSING_WALLET_ID', '缺少必填参数 walletId', { endpoint: 'quote/sell' }));
        }
        const walletId = Number(walletIdRaw);
        if (!Number.isFinite(walletId)) {
            return sendJson(res, 400, errorResponse('INVALID_WALLET_ID', 'walletId 必须为有效数字', { endpoint: 'quote/sell', walletId: walletIdRaw }));
        }
        if (!walletCfg.wallets.find(w => w.id === walletId)) {
            return sendJson(res, 400, errorResponse('WALLET_NOT_FOUND', '指定钱包不存在', { endpoint: 'quote/sell', walletId }));
        }
        const poolDp = clampDp((body as any).pool_dp);
        const mcStyle = getMarketCapStyle(body);
        if (!ethers.utils.isAddress(token)) {
            return sendJson(res, 400, errorResponse('INVALID_TOKEN_ADDRESS', '无效代币地址', { endpoint: 'quote/sell', token }));
        }
        const trader = getTraderById(walletId);
        const owner = trader.address();
        const hasReqNonce = (body as any).nonce !== undefined;
        const providedNonce = hasReqNonce ? Number((body as any).nonce) : null;
        const percentStr = (body as any).percent !== undefined ? String((body as any).percent).trim() : '';
        if (percentStr) {
            const percentNum = Number(percentStr);
            if (isNaN(percentNum) || percentNum <= 0 || percentNum > 100) {
                return sendJson(res, 400, errorResponse('INVALID_PERCENT', 'percent 必须为 (0,100] 的数字', { endpoint: 'quote/sell', token, percent: percentStr }));
            }
            const [r, nonceVal2] = await Promise.all([
                prepareSellDualPercentageMulticall(provider as any, token, owner, percentNum),
                (hasReqNonce ? Promise.resolve(providedNonce) : (provider as any).getTransactionCount(owner, 'pending')),
            ]);
            const pendingNonce2 = hasReqNonce ? providedNonce : (nonceVal2 !== null && nonceVal2 !== undefined ? Number(nonceVal2) : null);
            const info = (r as any).info;
            const decimals = Number(info.basicInfo.decimals || 18);
            const isXMode = !!info.poolInfo.isXMode;
            const isFour = !!info.basicInfo.isFourMemeToken;
            const status = Number(info.platformInfo.tradingStatus);
            const statusName = STATUS_NAMES[status] || '未知状态';
            const market = status === 1 ? 'internal' : status === 2 ? 'external' : 'none';
            const isBnbQuote = String(info.platformInfo.quote || '').toLowerCase() === ethers.constants.AddressZero.toLowerCase();
            const platform_code = isFour ? 1 : 0;
            const market_code = status;
            const quoteDpBase = Number(info.basicInfo.decimals || 18);
            const quoteDpQuote = Number(info.poolInfo.quoteDecimals || 18);
            const tokenUsdPriceBn: ethers.BigNumber | undefined = (r as any).tokenUsdPrice;
            const totalSupplyBn: ethers.BigNumber | undefined = info.basicInfo.totalSupply;
            const marketCapStr = (tokenUsdPriceBn && totalSupplyBn)
                ? formatMarketCapWithUnit(tokenUsdPriceBn.mul(totalSupplyBn).div(ethers.BigNumber.from(10).pow(quoteDpBase)), mcStyle)
                : null;
            const slipBps2 = Math.max(0, Math.min(10000, Math.round(Number((body as any).slippage ?? 2) * 100)));
            const minFundsBn2 = (r as any).bnbAmount ? (r as any).bnbAmount.mul(10000 - slipBps2).div(10000) : null;
            const quoteAddrRaw = String(info.platformInfo.quote || '').trim();
            const quoteAddrNorm = (!ethers.utils.isAddress(quoteAddrRaw) || quoteAddrRaw === ethers.constants.AddressZero)
                ? WBNB
                : quoteAddrRaw;
            const useThreePath = market === 'external' && quoteAddrNorm.toLowerCase() !== WBNB.toLowerCase();
            const pathSell = useThreePath ? [token, quoteAddrNorm, WBNB] : [token, WBNB];
            const body200 = {
                side: 'sell', chain: 'bsc', token, mode: isXMode ? 'xmode' : 'normal', market,
                is_bnb_quote: isBnbQuote,
                platform_code, market_code, status_name: statusName,
                basetoken_symbol: info.basicInfo.symbol,
                quotetoken_symbol: info.poolInfo.quoteSymbol,
                basetoken_decimals: quoteDpBase,
                quotetoken_decimals: quoteDpQuote,
                quotetoken_address: quoteAddrNorm || null,
                use_three_path: useThreePath ? 1 : 0,
                path_sell: pathSell,
                token_amount: ethers.utils.formatUnits((r as any).tokenAmount, decimals),
                token_amount_wei: (r as any).tokenAmount?.toString?.() ?? null,
                bnb_cost: ethers.utils.formatEther((r as any).bnbAmount),
                bnb_cost_wei: (r as any).bnbAmount?.toString?.() ?? null,
                min_bnb_amount: minFundsBn2 ? ethers.utils.formatEther(minFundsBn2) : null,
                min_bnb_amount_wei: minFundsBn2 ? minFundsBn2.toString() : null,
                price_per_token: String((r as any).pricePerToken),
                walletId,
                percent: percentNum,
                wallet_address: owner,
                nonce: pendingNonce2 !== null ? pendingNonce2 : undefined,
                bnb_usd_price: (r as any).bnbUsdPrice ? ethers.utils.formatUnits((r as any).bnbUsdPrice, 18) : null,
                token_usd_price: (r as any).tokenUsdPrice ? ethers.utils.formatUnits((r as any).tokenUsdPrice, 18) : null,
                market_cap: marketCapStr,
                basetoken_balance: formatUnitsTruncDp((() => {
                    const tokenLc = token.toLowerCase();
                    let baseBn = info.poolInfo.poolTokenBalance;
                    let quoteBn = info.poolInfo.poolQuoteBalance;
                    if (market === 'external') {
                        const pair = info.poolInfo?.v2TokenQuotePair;
                        const pair2 = info.poolInfo?.v2WbnbQuotePair;
                        const map = (p: any) => {
                            if (!p || !p.pair || p.pair === ethers.constants.AddressZero)
                                return false;
                            const r0 = String(p.reserve0?.token || '').toLowerCase();
                            const r1 = String(p.reserve1?.token || '').toLowerCase();
                            if (r0 === tokenLc) {
                                baseBn = p.reserve0?.reserve || baseBn;
                                quoteBn = p.reserve1?.reserve || quoteBn;
                                return true;
                            }
                            if (r1 === tokenLc) {
                                baseBn = p.reserve1?.reserve || baseBn;
                                quoteBn = p.reserve0?.reserve || quoteBn;
                                return true;
                            }
                            return false;
                        };
                        if (!map(pair))
                            map(pair2);
                    }
                    return baseBn;
                })(), decimals, poolDp),
                quotetoken_balance: formatUnitsTruncDp((() => {
                    const tokenLc = token.toLowerCase();
                    let baseBn = info.poolInfo.poolTokenBalance;
                    let quoteBn = info.poolInfo.poolQuoteBalance;
                    if (market === 'external') {
                        const pair = info.poolInfo?.v2TokenQuotePair;
                        const pair2 = info.poolInfo?.v2WbnbQuotePair;
                        const map = (p: any) => {
                            if (!p || !p.pair || p.pair === ethers.constants.AddressZero)
                                return false;
                            const r0 = String(p.reserve0?.token || '').toLowerCase();
                            const r1 = String(p.reserve1?.token || '').toLowerCase();
                            if (r0 === tokenLc) {
                                baseBn = p.reserve0?.reserve || baseBn;
                                quoteBn = p.reserve1?.reserve || quoteBn;
                                return true;
                            }
                            if (r1 === tokenLc) {
                                baseBn = p.reserve1?.reserve || baseBn;
                                quoteBn = p.reserve0?.reserve || quoteBn;
                                return true;
                            }
                            return false;
                        };
                        if (!map(pair))
                            map(pair2);
                    }
                    return quoteBn;
                })(), quoteDpQuote, poolDp),
                wallet_bnb_balance: (r as any).bnbBalance ? formatEtherHuman((r as any).bnbBalance) : null,
                wallet_token_balance: (r as any).tokenBalance ? formatUnitsHuman((r as any).tokenBalance, decimals) : null,
                allowance_fourmeme: normalizeFormatted(ethers.utils.formatUnits((r as any).allowanceFourmeme || ethers.constants.Zero, decimals)),
                allowance_router: normalizeFormatted(ethers.utils.formatUnits((r as any).allowanceRouter || ethers.constants.Zero, decimals)),
            };
            const ok = isFour && (status === 1 || status === 2);
            return ok ? sendJson(res, 200, body200) : sendJson(res, 400, { error: 'QUOTE_UNAVAILABLE', message: '当前代币不支持卖出报价', ...body200, bnb_cost: null, bnb_cost_wei: null, min_bnb_amount: null, min_bnb_amount_wei: null, price_per_token: null });
        }
        let tokenAmtInput: ethers.BigNumber;
        const amountWeiStr2 = String((body as any).amountWei || '').trim();
        if (!amountWeiStr2) {
            const amountStr = String((body as any).amount || '').trim();
            if (amountStr) {
                const amtNum = Number(amountStr);
                if (isNaN(amtNum)) {
                    return sendJson(res, 400, errorResponse('INVALID_AMOUNT', '无效 amount 数值', { endpoint: 'quote/sell', token, amount: amountStr }));
                }
                if (amtNum < 0) {
                    return sendJson(res, 400, errorResponse('INVALID_AMOUNT', 'amount 不可为负数', { endpoint: 'quote/sell', token, amount: amountStr }));
                }
                const dpRaw = (body as any).basetoken_decimals;
                if (dpRaw === undefined) {
                    return sendJson(res, 400, errorResponse('MISSING_BASETOKEN_DECIMALS', '缺少必填参数 basetoken_decimals', { endpoint: 'quote/sell', token, amount: amountStr }));
                }
                const dpNum = Number(dpRaw);
                if (!Number.isFinite(dpNum)) {
                    return sendJson(res, 400, errorResponse('INVALID_BASETOKEN_DECIMALS', 'basetoken_decimals 必须为有效数字', { endpoint: 'quote/sell', token, basetoken_decimals: dpRaw }));
                }
                const dpClamped = clampDp(dpNum);
                try {
                    tokenAmtInput = ethers.utils.parseUnits(amountStr, dpClamped);
                }
                catch {
                    return sendJson(res, 400, errorResponse('INVALID_AMOUNT', 'amount 解析失败，需为十进制数字字符串', { endpoint: 'quote/sell', token, amount: amountStr, basetoken_decimals: dpClamped }));
                }
            }
            else {
                return sendJson(res, 400, errorResponse('MISSING_AMOUNT_WEI', '卖出报价需提供 amountWei（原始单位）', { endpoint: 'quote/sell', token }));
            }
        }
        else {
            try {
                tokenAmtInput = ethers.BigNumber.from(amountWeiStr2);
            }
            catch {
                return sendJson(res, 400, errorResponse('INVALID_AMOUNT_WEI', '无效的 amountWei，需为十进制或十六进制整数', { endpoint: 'quote/sell', token, amountWei: amountWeiStr2 }));
            }
        }
        var tokenAmtForQuote = (tokenAmtInput.isZero() ? ethers.BigNumber.from(1) : tokenAmtInput);
        const ownerOpt2 = (body as any).walletId !== undefined ? owner : undefined;
        const hasReqNonce3 = (body as any).nonce !== undefined;
        const providedNonce3 = hasReqNonce3 ? Number((body as any).nonce) : null;
        const [r, nonceVal3] = await Promise.all([
            ownerOpt2
                ? prepareSellDualAllowanceMulticall(provider as any, token, ownerOpt2, tokenAmtForQuote)
                : quoteSell(provider, token, tokenAmtForQuote, undefined),
            (hasReqNonce3 ? Promise.resolve(providedNonce3) : (ownerOpt2 ? (provider as any).getTransactionCount(ownerOpt2, 'pending') : Promise.resolve(null))),
        ]);
        const pendingNonce3 = hasReqNonce3 ? providedNonce3 : (nonceVal3 !== null && nonceVal3 !== undefined ? Number(nonceVal3) : null);
        const slippage = (body as any).slippage !== undefined ? Number((body as any).slippage) : 2;
        if (isNaN(slippage) || slippage < 0 || slippage > 100) {
            return sendJson(res, 400, errorResponse('INVALID_SLIPPAGE', '无效滑点范围（0-100）', { endpoint: 'quote/sell', token, slippage }));
        }
        const info = (r as any).info;
        const decimals = Number(info.basicInfo.decimals || 18);
        const isXMode = !!info.poolInfo.isXMode;
        const isFour = !!info.basicInfo.isFourMemeToken;
        const status = Number(info.platformInfo.tradingStatus);
        const statusName = STATUS_NAMES[status] || '未知状态';
        const market = status === 1 ? 'internal' : status === 2 ? 'external' : 'none';
        const isBnbQuote4 = String(info.platformInfo.quote || '').toLowerCase() === ethers.constants.AddressZero.toLowerCase();
        const platform_code = isFour ? 1 : 0;
        const market_code = status;
        const quoteDpBase = Number(info.basicInfo.decimals || 18);
        const quoteDpQuote = Number(info.poolInfo.quoteDecimals || 18);
        const tokenUsdPriceBn3: ethers.BigNumber | undefined = (r as any).tokenUsdPrice;
        const totalSupplyBn3: ethers.BigNumber | undefined = info.basicInfo.totalSupply;
        const marketCapStr3 = (tokenUsdPriceBn3 && totalSupplyBn3)
            ? formatMarketCapWithUnit(tokenUsdPriceBn3.mul(totalSupplyBn3).div(ethers.BigNumber.from(10).pow(quoteDpBase)), mcStyle)
            : null;
        const slipBps3 = Math.max(0, Math.min(10000, Math.round(Number(slippage) * 100)));
        const minFundsBn3 = (r as any).bnbAmount ? (r as any).bnbAmount.mul(10000 - slipBps3).div(10000) : null;
        const quoteAddrRaw4 = String(info.platformInfo.quote || '').trim();
        const quoteAddrNorm4 = (!ethers.utils.isAddress(quoteAddrRaw4) || quoteAddrRaw4 === ethers.constants.AddressZero)
            ? WBNB
            : quoteAddrRaw4;
        const useThreePath4 = market === 'external' && quoteAddrNorm4.toLowerCase() !== WBNB.toLowerCase();
        const pathSell4 = useThreePath4 ? [token, quoteAddrNorm4, WBNB] : [token, WBNB];
        const body200 = {
            side: 'sell', chain: 'bsc', token, mode: isXMode ? 'xmode' : 'normal', market,
            is_bnb_quote: isBnbQuote4,
            platform_code, market_code, status_name: statusName,
            basetoken_symbol: info.basicInfo.symbol,
            quotetoken_symbol: info.poolInfo.quoteSymbol,
            basetoken_decimals: quoteDpBase,
            quotetoken_decimals: quoteDpQuote,
            quotetoken_address: quoteAddrNorm4 || null,
            use_three_path: useThreePath4 ? 1 : 0,
            path_sell: pathSell4,
            token_amount: ethers.utils.formatUnits(tokenAmtInput, decimals),
            token_amount_wei: tokenAmtInput.toString(),
            bnb_cost: ethers.utils.formatEther((r as any).bnbAmount),
            bnb_cost_wei: (r as any).bnbAmount?.toString?.() ?? null,
            min_bnb_amount: minFundsBn3 ? ethers.utils.formatEther(minFundsBn3) : null,
            min_bnb_amount_wei: minFundsBn3 ? minFundsBn3.toString() : null,
            price_per_token: String((r as any).pricePerToken),
            walletId,
            wallet_address: ownerOpt2 || null,
            nonce: pendingNonce3 !== null ? pendingNonce3 : undefined,
            bnb_usd_price: (r as any).bnbUsdPrice ? ethers.utils.formatUnits((r as any).bnbUsdPrice, 18) : null,
            token_usd_price: (r as any).tokenUsdPrice ? ethers.utils.formatUnits((r as any).tokenUsdPrice, 18) : null,
            market_cap: marketCapStr3,
            basetoken_balance: formatUnitsTruncDp((() => {
                const tokenLc = token.toLowerCase();
                let baseBn = info.poolInfo.poolTokenBalance;
                let quoteBn = info.poolInfo.poolQuoteBalance;
                if (market === 'external') {
                    const pair = info.poolInfo?.v2TokenQuotePair;
                    const pair2 = info.poolInfo?.v2WbnbQuotePair;
                    const map = (p: any) => {
                        if (!p || !p.pair || p.pair === ethers.constants.AddressZero)
                            return false;
                        const r0 = String(p.reserve0?.token || '').toLowerCase();
                        const r1 = String(p.reserve1?.token || '').toLowerCase();
                        if (r0 === tokenLc) {
                            baseBn = p.reserve0?.reserve || baseBn;
                            quoteBn = p.reserve1?.reserve || quoteBn;
                            return true;
                        }
                        if (r1 === tokenLc) {
                            baseBn = p.reserve1?.reserve || baseBn;
                            quoteBn = p.reserve0?.reserve || quoteBn;
                            return true;
                        }
                        return false;
                    };
                    if (!map(pair))
                        map(pair2);
                }
                return baseBn;
            })(), decimals, poolDp),
            quotetoken_balance: formatUnitsTruncDp((() => {
                const tokenLc = token.toLowerCase();
                let baseBn = info.poolInfo.poolTokenBalance;
                let quoteBn = info.poolInfo.poolQuoteBalance;
                if (market === 'external') {
                    const pair = info.poolInfo?.v2TokenQuotePair;
                    const pair2 = info.poolInfo?.v2WbnbQuotePair;
                    const map = (p: any) => {
                        if (!p || !p.pair || p.pair === ethers.constants.AddressZero)
                            return false;
                        const r0 = String(p.reserve0?.token || '').toLowerCase();
                        const r1 = String(p.reserve1?.token || '').toLowerCase();
                        if (r0 === tokenLc) {
                            baseBn = p.reserve0?.reserve || baseBn;
                            quoteBn = p.reserve1?.reserve || quoteBn;
                            return true;
                        }
                        if (r1 === tokenLc) {
                            baseBn = p.reserve1?.reserve || baseBn;
                            quoteBn = p.reserve0?.reserve || quoteBn;
                            return true;
                        }
                        return false;
                    };
                    if (!map(pair))
                        map(pair2);
                }
                return quoteBn;
            })(), quoteDpQuote, poolDp),
            wallet_bnb_balance: ownerOpt2 && (r as any).bnbBalance ? formatEtherHuman((r as any).bnbBalance) : null,
            wallet_token_balance: ownerOpt2 && (r as any).tokenBalance ? formatUnitsHuman((r as any).tokenBalance, decimals) : null,
            allowance_fourmeme: ownerOpt2 && (r as any).allowanceFourmeme !== undefined ? normalizeFormatted(ethers.utils.formatUnits((r as any).allowanceFourmeme, decimals)) : null,
            allowance_router: ownerOpt2 && (r as any).allowanceRouter !== undefined ? normalizeFormatted(ethers.utils.formatUnits((r as any).allowanceRouter, decimals)) : null,
        };
        const ok = !!info.basicInfo.isFourMemeToken && (Number(info.platformInfo.tradingStatus) === 1 || Number(info.platformInfo.tradingStatus) === 2);
        const shouldOverrideZeroSell = tokenAmtInput.isZero();
        return ok ? sendJson(res, 200, (shouldOverrideZeroSell ? applyZeroOverride('sell', body200) : body200)) : sendJson(res, 400, { error: 'QUOTE_UNAVAILABLE', message: '当前代币不支持卖出报价', ...body200, bnb_cost: null, bnb_cost_wei: null, min_bnb_amount: null, min_bnb_amount_wei: null, price_per_token: null });
    }
    catch (err: any) {
        return sendJson(res, 500, errorResponse('INTERNAL_ERROR', '服务端异常', { endpoint: 'quote/sell', detail: err?.message || String(err) }));
    }
}
