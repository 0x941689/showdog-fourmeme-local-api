import { IncomingMessage, ServerResponse } from 'http';
import { ethers } from 'ethers';
import { parseJsonBody, parseQueryParams, sendJson, errorResponse } from '../../utils/http';
import { STATUS_NAMES } from '../../utils/format';
import { walletCfg, getTraderById, getPancakeTraderById, provider } from '../../context';
import { quoteSell } from '../../../chains/bsc/quote/internal';
import { prepareSellDualPercentageMulticall } from '../../../chains/bsc/quote/context';
import { WBNB } from '../../../chains/bsc';
export async function handleSell(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = req.method === 'GET' ? parseQueryParams(req) : ((req as any)._parsedBody ?? await parseJsonBody(req));
        const token = String((body as any).token || '').trim();
        const walletIdRaw = (body as any).walletId;
        if (walletIdRaw === undefined) {
            return sendJson(res, 400, errorResponse('MISSING_WALLET_ID', '缺少必填参数 walletId', { endpoint: 'sell' }));
        }
        const walletId = Number(walletIdRaw);
        if (!Number.isFinite(walletId)) {
            return sendJson(res, 400, errorResponse('INVALID_WALLET_ID', 'walletId 必须为有效数字', { endpoint: 'sell', walletId: walletIdRaw }));
        }
        if (!walletCfg.wallets.find(w => w.id === walletId)) {
            return sendJson(res, 400, errorResponse('WALLET_NOT_FOUND', '指定钱包不存在', { endpoint: 'sell', walletId }));
        }
        if (!ethers.utils.isAddress(token)) {
            return sendJson(res, 400, errorResponse('INVALID_TOKEN_ADDRESS', '无效代币地址', { endpoint: 'sell', token }));
        }
        const trader = getTraderById(walletId);
        const owner = trader.address();
        const slippageRaw = (body as any).slippage;
        if (slippageRaw === undefined) {
            return sendJson(res, 400, errorResponse('MISSING_SLIPPAGE', '缺少必填参数 slippage', { endpoint: 'sell' }));
        }
        const slippage = Number(slippageRaw);
        if (isNaN(slippage) || slippage < 0 || slippage > 100) {
            return sendJson(res, 400, errorResponse('INVALID_SLIPPAGE', '无效滑点范围（0-100）', { endpoint: 'sell', token, slippage }));
        }
        const percentStr = (body as any).percent !== undefined ? String((body as any).percent).trim() : '';
        const gasPriceStr = (body as any).gasprice;
        const gasLimitStr = (body as any).gaslimit;
        if (gasPriceStr === undefined || gasLimitStr === undefined) {
            return sendJson(res, 400, errorResponse('MISSING_GAS_PARAMS', '缺少必填参数 gasprice 或 gaslimit', { endpoint: 'sell', token }));
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
            return sendJson(res, 400, errorResponse('INVALID_GAS_PARAMS', '无效的 gasprice/gaslimit', { endpoint: 'sell', token, gasprice: gasPriceStr, gaslimit: gasLimitStr }));
        }
        const autoApproveRaw = (body as any).autoApprove;
        if (autoApproveRaw === undefined) {
            return sendJson(res, 400, errorResponse('MISSING_AUTO_APPROVE', '缺少必填参数 autoApprove', { endpoint: 'sell' }));
        }
        const autoApprove = String(autoApproveRaw).toLowerCase() === 'true';
        const statusInfo = await trader.getTradingStatus(token);
        const status = statusInfo.isInternal ? 1 : (statusInfo.isGraduated ? 2 : 0);
        if (status === 0) {
            const statusName = STATUS_NAMES[status] || '未知状态';
            return sendJson(res, 400, {
                error: 'UNSUPPORTED_TRADING_STATUS',
                message: '当前代币不支持卖出',
                side: 'sell', chain: 'bsc', token,
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
            if (!percentStr) {
                return sendJson(res, 400, errorResponse('MISSING_PERCENT', '卖出必须提供 percent（0-100）', { endpoint: 'sell', token }));
            }
            const percentNum = Number(percentStr);
            if (isNaN(percentNum) || percentNum <= 0 || percentNum > 100) {
                return sendJson(res, 400, errorResponse('INVALID_PERCENT', 'percent 必须为 (0,100] 的数字', { endpoint: 'sell', token, percent: percentStr }));
            }
            const [r, baseNonce] = await Promise.all([
                prepareSellDualPercentageMulticall(provider as any, token, owner, percentNum),
                p.getTransactionCount(trader.address(), 'pending')
            ]);
            const sellAmountWei = r.tokenAmount as ethers.BigNumber;
            const bnbAmount = r.bnbAmount as ethers.BigNumber;
            const allowanceFourmeme = r.allowanceFourmeme as ethers.BigNumber;
            const minFunds = bnbAmount.mul(100 - slippage).div(100);
            const chainId = 56;
            const needApprove = allowanceFourmeme.lt(sellAmountWei);
            if (needApprove && !autoApprove) {
                return sendJson(res, 400, errorResponse('ALLOWANCE_INSUFFICIENT', '授权不足，且 autoApprove=false', { endpoint: 'sell', token }));
            }
            const signedSell = await (trader as any).signSellPrecomputedNoEst(token, sellAmountWei, minFunds, needApprove ? baseNonce + 1 : baseNonce, chainId);
            if (needApprove) {
                const signedApprove = await (trader as any).signApproveMaxNoEst(token, baseNonce, chainId);
                const [txApprove, txSell] = await Promise.all([
                    p.sendTransaction(signedApprove),
                    p.sendTransaction(signedSell)
                ]);
                const statusName = STATUS_NAMES[1];
                return sendJson(res, 200, {
                    side: 'sell', chain: 'bsc', token,
                    tx_hash: txSell.hash,
                    market: 'internal',
                    platform_code: 1,
                    market_code: 1,
                    status_name: statusName,
                    walletId,
                    wallet_address: owner,
                });
            }
            else {
                const txSell = await p.sendTransaction(signedSell);
                const statusName = STATUS_NAMES[1];
                return sendJson(res, 200, {
                    side: 'sell', chain: 'bsc', token,
                    tx_hash: txSell.hash,
                    market: 'internal',
                    platform_code: 1,
                    market_code: 1,
                    status_name: statusName,
                    walletId,
                    wallet_address: owner,
                });
            }
        }
        else {
            let amountWei: ethers.BigNumber | undefined;
            if (!percentStr) {
                return sendJson(res, 400, errorResponse('MISSING_PERCENT', '卖出必须提供 percent（0-100）', { endpoint: 'sell', token }));
            }
            const percentNum = Number(percentStr);
            if (isNaN(percentNum) || percentNum <= 0 || percentNum > 100) {
                return sendJson(res, 400, errorResponse('INVALID_PERCENT', 'percent 必须为 (0,100] 的数字', { endpoint: 'sell', token, percent: percentStr }));
            }
            const bal = await trader.getTokenBalance(token);
            amountWei = bal.mul(Math.round(percentNum * 100)).div(10000);
            const pancakeTrader = getPancakeTraderById(walletId);
            pancakeTrader.setTxOverrides({ gasPrice, gasLimit });
            const p2 = (pancakeTrader as any).wallet.provider as ethers.providers.Provider;
            const [rQuote, baseNonce2] = await Promise.all([
                quoteSell(provider as any, token, amountWei!, undefined),
                p2.getTransactionCount(pancakeTrader.address(), 'pending')
            ]);
            const bnbAmount = (rQuote as any).bnbAmount as ethers.BigNumber;
            const minFunds = bnbAmount.mul(100 - slippage).div(100);
            const quoteTokenAddr = String((rQuote as any).info?.platformInfo?.quote || '').toLowerCase();
            const THREE_PATH_QUOTES = new Set([
                '0x0E09Fabb73BD3Ade0A17ECC321fD13a19e81Ce82',
                '0x55d398326f99059fF775485246999027B3197955',
                '0x8d0D000EE44948FC98c9B98a4FA4921476F08B0d',
                '0x000AE314e2a2172A039B26378814C252734F556A',
            ].map(a => a.toLowerCase()));
            const useThreePath = quoteTokenAddr && quoteTokenAddr !== WBNB.toLowerCase() && THREE_PATH_QUOTES.has(quoteTokenAddr);
            const path = useThreePath ? [token, quoteTokenAddr, WBNB] : [token, WBNB];
            const signedApprove = await pancakeTrader.approveTokenUnsigned(token, baseNonce2);
            const signedSell = useThreePath
                ? await (pancakeTrader as any).sellUnsignedPath(path, amountWei!, minFunds, baseNonce2 + 1)
                : await (pancakeTrader as any).sellUnsigned(token, amountWei!, minFunds, baseNonce2 + 1);
            const [txApprove2, txSell2] = await Promise.all([
                p2.sendTransaction(signedApprove),
                p2.sendTransaction(signedSell)
            ]);
            const statusName = STATUS_NAMES[2];
            return sendJson(res, 200, {
                side: 'sell', chain: 'bsc', token,
                tx_hash: txSell2.hash,
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
        return sendJson(res, 500, errorResponse('INTERNAL_ERROR', '服务端异常', { endpoint: 'sell', detail: err?.message || String(err) }));
    }
}
