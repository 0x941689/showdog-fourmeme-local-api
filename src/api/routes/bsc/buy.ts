import { IncomingMessage, ServerResponse } from 'http';
import { ethers } from 'ethers';
import { parseJsonBody, parseQueryParams, sendJson, errorResponse } from '../../utils/http';
import { STATUS_NAMES } from '../../utils/format';
import { walletCfg, getTraderById, getPancakeTraderById, provider } from '../../context';
import { WBNB } from '../../../chains/bsc';
import { quoteBuy } from '../../../chains/bsc/quote/internal';
export async function handleBuy(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = req.method === 'GET' ? parseQueryParams(req) : ((req as any)._parsedBody ?? await parseJsonBody(req));
        const token = String((body as any).token || '').trim();
        const slippageRaw = (body as any).slippage;
        if (slippageRaw === undefined) {
            return sendJson(res, 400, errorResponse('MISSING_SLIPPAGE', '缺少必填参数 slippage', { endpoint: 'buy' }));
        }
        const autoApproveRaw = (body as any).autoApprove;
        if (autoApproveRaw === undefined) {
            return sendJson(res, 400, errorResponse('MISSING_AUTO_APPROVE', '缺少必填参数 autoApprove', { endpoint: 'buy' }));
        }
        const slippage = Number(slippageRaw);
        const bnbStr = String((body as any).bnb_cost || '').trim();
        const walletIdRaw = (body as any).walletId;
        if (walletIdRaw === undefined) {
            return sendJson(res, 400, errorResponse('MISSING_WALLET_ID', '缺少必填参数 walletId', { endpoint: 'buy' }));
        }
        const walletId = Number(walletIdRaw);
        if (!Number.isFinite(walletId)) {
            return sendJson(res, 400, errorResponse('INVALID_WALLET_ID', 'walletId 必须为有效数字', { endpoint: 'buy', walletId: walletIdRaw }));
        }
        if (!walletCfg.wallets.find(w => w.id === walletId)) {
            return sendJson(res, 400, errorResponse('WALLET_NOT_FOUND', '指定钱包不存在', { endpoint: 'buy', walletId }));
        }
        if (!ethers.utils.isAddress(token)) {
            return sendJson(res, 400, errorResponse('INVALID_TOKEN_ADDRESS', '无效代币地址', { endpoint: 'buy', token }));
        }
        if (!bnbStr || isNaN(Number(bnbStr)) || Number(bnbStr) <= 0) {
            return sendJson(res, 400, errorResponse('INVALID_BNB_COST', '无效 bnb_cost 数值', { endpoint: 'buy', token, bnb_cost: bnbStr }));
        }
        if (isNaN(slippage) || slippage < 0 || slippage > 100) {
            return sendJson(res, 400, errorResponse('INVALID_SLIPPAGE', '无效滑点范围（0-100）', { endpoint: 'buy', token, slippage }));
        }
        const bnbCost = ethers.utils.parseEther(bnbStr);
        const trader = getTraderById(walletId);
        const owner = trader.address();
        const gasPriceStr = (body as any).gasprice;
        const gasLimitStr = (body as any).gaslimit;
        if (gasPriceStr === undefined || gasLimitStr === undefined) {
            return sendJson(res, 400, errorResponse('MISSING_GAS_PARAMS', '缺少必填参数 gasprice 或 gaslimit', { endpoint: 'buy', token }));
        }
        let gasPrice: ethers.BigNumber;
        let gasLimit: ethers.BigNumber;
        try {
            gasPrice = ethers.utils.parseUnits(String(gasPriceStr), 'gwei');
            gasLimit = ethers.BigNumber.from(String(gasLimitStr));
            if (gasLimit.lte(0))
                throw new Error('gaslimit 必须大于 0');
        }
        catch {
            return sendJson(res, 400, errorResponse('INVALID_GAS_PARAMS', '无效的 gasprice/gaslimit', { endpoint: 'buy', token, gasprice: gasPriceStr, gaslimit: gasLimitStr }));
        }
        const statusInfo = await trader.getTradingStatus(token);
        const status = statusInfo.isInternal ? 1 : (statusInfo.isGraduated ? 2 : 0);
        if (status === 0) {
            const statusName = STATUS_NAMES[status] || '未知状态';
            return sendJson(res, 400, {
                error: 'UNSUPPORTED_TRADING_STATUS',
                message: '当前代币不支持买入',
                side: 'buy', chain: 'bsc', token,
                tx_hash: null,
                market: 'none',
                platform_code: statusInfo.isFourMeme ? 1 : 0,
                market_code: status,
                status_name: statusName,
                walletId,
                wallet_address: owner,
            });
        }
        if (status === 1) {
            (trader as any).setTxOverrides({ gasPrice, gasLimit });
            const p = (trader as any).wallet.provider as ethers.providers.Provider;
            const [quote, baseNonce] = await Promise.all([
                quoteBuy(provider as any, token, bnbCost, slippage, undefined),
                p.getTransactionCount(trader.address(), 'pending')
            ]);
            const minTokenAmount = (quote as any).minTokenAmount as ethers.BigNumber;
            const quoteTokenAddr = String((quote as any).info?.platformInfo?.quote || '').toLowerCase();
            const isBnbQuote = quoteTokenAddr === ethers.constants.AddressZero.toLowerCase();
            const chainId = 56;
            try {
            }
            catch (e) {
            }
            const signed = await (trader as any).signBuyPrecomputedNoEst(token, bnbCost, minTokenAmount, baseNonce, chainId, isBnbQuote);
            const tx = await p.sendTransaction(signed);
            try {
            }
            catch { }
            const statusName = STATUS_NAMES[1];
            return sendJson(res, 200, {
                side: 'buy', chain: 'bsc', token,
                tx_hash: tx.hash,
                market: 'internal',
                platform_code: 1,
                market_code: 1,
                status_name: statusName,
                walletId,
                wallet_address: owner,
            });
        }
        else {
            const pancakeTrader = getPancakeTraderById(walletId);
            pancakeTrader.setTxOverrides({ gasPrice, gasLimit });
            const p = (pancakeTrader as any).wallet.provider as ethers.providers.Provider;
            const [quote, baseNonce] = await Promise.all([
                quoteBuy(provider as any, token, bnbCost, slippage, undefined),
                p.getTransactionCount(pancakeTrader.address(), 'pending')
            ]);
            const minTokenAmount = (quote as any).minTokenAmount as ethers.BigNumber;
            const quoteTokenAddr = String((quote as any).info?.platformInfo?.quote || '').toLowerCase();
            const THREE_PATH_QUOTES = new Set([
                '0x0E09Fabb73BD3Ade0A17ECC321fD13a19e81Ce82',
                '0x55d398326f99059fF775485246999027B3197955',
                '0x8d0D000EE44948FC98c9B98a4FA4921476F08B0d',
                '0x000AE314e2a2172A039B26378814C252734F556A',
            ].map(a => a.toLowerCase()));
            const useThreePath = quoteTokenAddr && quoteTokenAddr !== WBNB.toLowerCase() && THREE_PATH_QUOTES.has(quoteTokenAddr);
            try {
            }
            catch (e) {
            }
            const signed = useThreePath
                ? await (pancakeTrader as any).buyUnsignedPath([WBNB, quoteTokenAddr, token], bnbCost, minTokenAmount, baseNonce)
                : await pancakeTrader.buyUnsigned(token, bnbCost, minTokenAmount, baseNonce);
            const tx = await p.sendTransaction(signed);
            try {
            }
            catch { }
            const statusName = STATUS_NAMES[2];
            return sendJson(res, 200, {
                side: 'buy', chain: 'bsc', token,
                tx_hash: tx.hash,
                market: 'external',
                platform_code: statusInfo.isFourMeme ? 1 : 0,
                market_code: 2,
                status_name: statusName,
                walletId,
                wallet_address: owner,
            });
        }
    }
    catch (err: any) {
        return sendJson(res, 500, errorResponse('INTERNAL_ERROR', '服务端异常', { endpoint: 'buy', detail: err?.message || String(err) }));
    }
}
