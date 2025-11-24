import { IncomingMessage, ServerResponse } from 'http';
import { ethers } from 'ethers';
import { parseJsonBody, parseQueryParams, sendJson, errorResponse } from '../../utils/http';
import { logApiResponse } from '../../utils/logger';
import { provider, walletCfg, getTraderById, getPancakeTraderById } from '../../context';
import { WBNB } from '../../../chains/bsc';
export async function handleSwapBuy(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = req.method === 'GET' ? parseQueryParams(req) : ((req as any)._parsedBody ?? await parseJsonBody(req));
        const token = String((body as any).token || '').trim();
        const bnbCostWeiStr = String((body as any).bnb_cost_wei || '').trim();
        const minTokenWeiStr = String((body as any).min_token_amount_wei || '').trim();
        const allowanceFourStr = String((body as any).allowance_fourmeme ?? '').trim();
        const allowanceRouterStr = String((body as any).allowance_router ?? '').trim();
        const walletIdRaw = (body as any).walletId;
        if (walletIdRaw === undefined) {
            return sendJson(res, 400, errorResponse('MISSING_WALLET_ID', '缺少必填参数 walletId', { endpoint: 'swap/buy' }));
        }
        const walletId = Number(walletIdRaw);
        if (!Number.isFinite(walletId)) {
            return sendJson(res, 400, errorResponse('INVALID_WALLET_ID', 'walletId 必须为有效数字', { endpoint: 'swap/buy', walletId: walletIdRaw }));
        }
        if (!walletCfg.wallets.find(w => w.id === walletId)) {
            return sendJson(res, 400, errorResponse('WALLET_NOT_FOUND', '指定钱包不存在', { endpoint: 'swap/buy', walletId }));
        }
        const market = String((body as any).market || 'internal').trim().toLowerCase();
        const gasPriceStr = (body as any).gasprice;
        const gasLimitStr = (body as any).gaslimit;
        const defaultGasPrice = ethers.utils.parseUnits('0.08', 'gwei');
        const defaultGasLimit = ethers.BigNumber.from(500000);
        const gasPrice = gasPriceStr !== undefined ? ethers.utils.parseUnits(String(gasPriceStr), 'gwei') : defaultGasPrice;
        const gasLimit = gasLimitStr !== undefined ? ethers.BigNumber.from(String(gasLimitStr)) : defaultGasLimit;
        if (!ethers.utils.isAddress(token))
            return sendJson(res, 400, errorResponse('INVALID_TOKEN_ADDRESS', '无效代币地址', { endpoint: 'swap/buy', token }));
        let bnbCost: ethers.BigNumber;
        let minAmount: ethers.BigNumber;
        const needApproveInternal = market === 'internal' && (!allowanceFourStr || allowanceFourStr === '0');
        const needApproveExternal = market === 'external' && (!allowanceRouterStr || allowanceRouterStr === '0');
        try {
            bnbCost = ethers.BigNumber.from(bnbCostWeiStr);
        }
        catch {
            return sendJson(res, 400, errorResponse('INVALID_BNB_COST_WEI', 'bnb_cost_wei 必须为十进制或0x十六进制整数且大于0', { endpoint: 'swap/buy', token, bnb_cost_wei: bnbCostWeiStr }));
        }
        try {
            minAmount = ethers.BigNumber.from(minTokenWeiStr);
        }
        catch {
            return sendJson(res, 400, errorResponse('INVALID_MIN_TOKEN_WEI', 'min_token_amount_wei 必须为十进制或0x十六进制整数且不小于0', { endpoint: 'swap/buy', token, min_token_amount_wei: minTokenWeiStr }));
        }
        if (bnbCost.lte(0))
            return sendJson(res, 400, errorResponse('INVALID_BNB_COST_WEI', 'bnb_cost_wei 必须为正整数', { endpoint: 'swap/buy', token, bnb_cost_wei: bnbCostWeiStr }));
        if (minAmount.lt(0))
            return sendJson(res, 400, errorResponse('INVALID_MIN_TOKEN_WEI', 'min_token_amount_wei 不可为负数', { endpoint: 'swap/buy', token, min_token_amount_wei: minTokenWeiStr }));
        if (gasLimit.lte(0))
            return sendJson(res, 400, errorResponse('INVALID_GAS_LIMIT', 'gaslimit 必须为正整数', { endpoint: 'swap/buy', token, gaslimit: gasLimit.toString() }));
        if (market === 'external') {
            const trader = getPancakeTraderById(walletId);
            trader.setTxOverrides({ gasPrice, gasLimit });
            const p = (trader as any).wallet.provider;
            const nonceParam = (body as any).nonce;
            if (nonceParam === undefined)
                return sendJson(res, 400, errorResponse('MISSING_NONCE', '缺少必填参数 nonce', { endpoint: 'swap/buy' }));
            const nonce = Number(nonceParam);
            const useThreeRaw = (body as any).use_three_path;
            const quoteAddrReqRaw = String((body as any).quotetoken_address || '').trim();
            let signed: string;
            let useThreeFlag: boolean | null = null;
            if (typeof useThreeRaw === 'string') {
                if (useThreeRaw === '1') useThreeFlag = true;
                else if (useThreeRaw === '0') useThreeFlag = false;
            }
            else if (typeof useThreeRaw === 'number') {
                if (useThreeRaw === 1) useThreeFlag = true;
                else if (useThreeRaw === 0) useThreeFlag = false;
            }
            if (useThreeFlag === null) {
                return sendJson(res, 400, errorResponse('MISSING_USE_THREE_PATH', 'use_three_path 必须为 1 或 0', { endpoint: 'swap/buy' }));
            }
            if (useThreeFlag) {
                const quoteAddrReq = quoteAddrReqRaw;
                if (!ethers.utils.isAddress(quoteAddrReq) || quoteAddrReq.toLowerCase() === ethers.constants.AddressZero || quoteAddrReq.toLowerCase() === WBNB.toLowerCase()) {
                    return sendJson(res, 400, errorResponse('INVALID_QUOTE_ADDRESS', 'use_three_path=true 时须提供有效的 quotetoken_address（非 0x0 且不可为 WBNB）', { endpoint: 'swap/buy', quotetoken_address: quoteAddrReqRaw }));
                }
                signed = await (trader as any).buyUnsignedPath([WBNB, quoteAddrReq, token], bnbCost, minAmount, nonce);
            }
            else {
                signed = await trader.buyUnsigned(token, bnbCost, minAmount, nonce);
            }
            const tx = await p.sendTransaction(signed);
            if (needApproveExternal) {
                try {
                    const signedApprove = await trader.approveTokenUnsigned(token, nonce + 1);
                    void p.sendTransaction(signedApprove).catch(() => { });
                }
                catch { }
            }
            return sendJson(res, 200, {
                endpoint: 'swap/buy', tx_hash: tx.hash, market: 'external', token,
                bnb_cost_wei: bnbCost.toString(), min_token_amount_wei: minAmount.toString(),
                walletId: walletId,
                gas_price_gwei: Number(ethers.utils.formatUnits(gasPrice, 'gwei')),
                gas_limit: gasLimit.toString(), receipt_waited: false,
            });
        }
        else {
            const trader = getTraderById(walletId);
            trader.setTxOverrides({ gasPrice, gasLimit });
            const p = (trader as any).wallet.provider;
            const nonceParam = (body as any).nonce;
            if (nonceParam === undefined)
                return sendJson(res, 400, errorResponse('MISSING_NONCE', '缺少必填参数 nonce', { endpoint: 'swap/buy' }));
            const nonce = Number(nonceParam);
            const isBnbQuoteReq = (body as any).is_bnb_quote;
            const quoteAddrRaw = String((body as any).quotetoken_address || '').trim();
            let isBnbQuote: boolean | null = null;
            if (typeof isBnbQuoteReq === 'boolean') {
                isBnbQuote = !!isBnbQuoteReq;
            }
            else if (typeof isBnbQuoteReq === 'string') {
                const s = isBnbQuoteReq.trim().toLowerCase();
                if (['true', '1', 'yes', 'y'].includes(s)) isBnbQuote = true;
                else if (['false', '0', 'no', 'n'].includes(s)) isBnbQuote = false;
            }
            else if (typeof isBnbQuoteReq === 'number') {
                isBnbQuote = Number(isBnbQuoteReq) !== 0;
            }
            if (isBnbQuote === null) {
                if (ethers.utils.isAddress(quoteAddrRaw)) {
                    const lc = quoteAddrRaw.toLowerCase();
                    isBnbQuote = (lc === ethers.constants.AddressZero.toLowerCase()) || (lc === WBNB.toLowerCase());
                }
                else {
                    try {
                        const { info } = await (await import('../../../chains/bsc/quote/internal')).quoteBuy(provider as any, token, bnbCost, 0, undefined);
                        const lc = String(info.platformInfo.quote || '').toLowerCase();
                        isBnbQuote = (lc === ethers.constants.AddressZero.toLowerCase()) || (lc === WBNB.toLowerCase());
                    }
                    catch {
                        isBnbQuote = true;
                    }
                }
            }
            try {
                await logApiResponse((res as any)._req, 200, {
                    endpoint: 'swap/buy',
                    debug: {
                        stage: 'pre_send_internal',
                        market,
                        token,
                        walletId,
                        nonce,
                        is_bnb_quote_req: isBnbQuoteReq,
                        is_bnb_quote_final: isBnbQuote,
                        quotetoken_address: quoteAddrRaw || null,
                        bnb_cost_wei: bnbCost.toString(),
                        min_token_amount_wei: minAmount.toString(),
                        gas_price_gwei: Number(ethers.utils.formatUnits(gasPrice, 'gwei')),
                        gas_limit: gasLimit.toString(),
                        need_approve_internal: needApproveInternal,
                    },
                });
            }
            catch {}
            const chainId = 56;
            const signed = await trader.signBuyPrecomputedNoEst(token as any, bnbCost as any, minAmount as any, nonce, chainId, isBnbQuote);
            const tx = await p.sendTransaction(signed);
            if (needApproveInternal) {
                try {
                    const signedApprove = await trader.signApproveMaxNoEst(token, nonce + 1, chainId);
                    void p.sendTransaction(signedApprove).catch(() => { });
                }
                catch { }
            }
            return sendJson(res, 200, {
                endpoint: 'swap/buy', tx_hash: tx.hash, market: 'internal', token,
                bnb_cost_wei: bnbCost.toString(), min_token_amount_wei: minAmount.toString(),
                walletId: walletId,
                gas_price_gwei: Number(ethers.utils.formatUnits(gasPrice, 'gwei')),
                gas_limit: gasLimit.toString(), receipt_waited: false,
            });
        }
    }
    catch (err: any) {
        return sendJson(res, 500, errorResponse('INTERNAL_ERROR', '服务端异常', { endpoint: 'swap/buy', detail: err?.message || String(err) }));
    }
}
export async function handleSwapSell(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = req.method === 'GET' ? parseQueryParams(req) : ((req as any)._parsedBody ?? await parseJsonBody(req));
        const token = String((body as any).token || '').trim();
        const tokenAmountWeiStr = String((body as any).token_amount_wei || '').trim();
        const minBnbWeiStr = String((body as any).min_bnb_amount_wei || '').trim();
        const allowanceFourStr = String((body as any).allowance_fourmeme ?? '').trim();
        const allowanceRouterStr = String((body as any).allowance_router ?? '').trim();
        const walletIdRaw = (body as any).walletId;
        if (walletIdRaw === undefined) {
            return sendJson(res, 400, errorResponse('MISSING_WALLET_ID', '缺少必填参数 walletId', { endpoint: 'swap/sell' }));
        }
        const walletId = Number(walletIdRaw);
        if (!Number.isFinite(walletId)) {
            return sendJson(res, 400, errorResponse('INVALID_WALLET_ID', 'walletId 必须为有效数字', { endpoint: 'swap/sell', walletId: walletIdRaw }));
        }
        if (!walletCfg.wallets.find(w => w.id === walletId)) {
            return sendJson(res, 400, errorResponse('WALLET_NOT_FOUND', '指定钱包不存在', { endpoint: 'swap/sell', walletId }));
        }
        const market = String((body as any).market || 'internal').trim().toLowerCase();
        const gasPriceStr = (body as any).gasprice;
        const gasLimitStr = (body as any).gaslimit;
        const defaultGasPrice = ethers.utils.parseUnits('0.08', 'gwei');
        const defaultGasLimit = ethers.BigNumber.from(500000);
        const gasPrice = gasPriceStr !== undefined ? ethers.utils.parseUnits(String(gasPriceStr), 'gwei') : defaultGasPrice;
        const gasLimit = gasLimitStr !== undefined ? ethers.BigNumber.from(String(gasLimitStr)) : defaultGasLimit;
        if (!ethers.utils.isAddress(token))
            return sendJson(res, 400, errorResponse('INVALID_TOKEN_ADDRESS', '无效代币地址', { endpoint: 'swap/sell', token }));
        let amountWei: ethers.BigNumber;
        let minFunds: ethers.BigNumber;
        const needApproveInternal = market === 'internal' && (!allowanceFourStr || allowanceFourStr === '0');
        const needApproveExternal = market === 'external' && (!allowanceRouterStr || allowanceRouterStr === '0');
        try {
            amountWei = ethers.BigNumber.from(tokenAmountWeiStr);
        }
        catch {
            return sendJson(res, 400, errorResponse('INVALID_TOKEN_AMOUNT_WEI', 'token_amount_wei 必须为十进制或0x十六进制整数且大于0', { endpoint: 'swap/sell', token, token_amount_wei: tokenAmountWeiStr }));
        }
        try {
            minFunds = ethers.BigNumber.from(minBnbWeiStr);
        }
        catch {
            return sendJson(res, 400, errorResponse('INVALID_MIN_BNB_AMOUNT_WEI', 'min_bnb_amount_wei 必须为十进制或0x十六进制整数且不小于0', { endpoint: 'swap/sell', token, min_bnb_amount_wei: minBnbWeiStr }));
        }
        if (amountWei.lte(0))
            return sendJson(res, 400, errorResponse('INVALID_TOKEN_AMOUNT_WEI', 'token_amount_wei 必须为正整数', { endpoint: 'swap/sell', token, token_amount_wei: tokenAmountWeiStr }));
        if (minFunds.lt(0))
            return sendJson(res, 400, errorResponse('INVALID_MIN_BNB_AMOUNT_WEI', 'min_bnb_amount_wei 不可为负数', { endpoint: 'swap/sell', token, min_bnb_amount_wei: minBnbWeiStr }));
        if (gasLimit.lte(0))
            return sendJson(res, 400, errorResponse('INVALID_GAS_LIMIT', 'gaslimit 必须为正整数', { endpoint: 'swap/sell', token, gaslimit: gasLimit.toString() }));
        if (market === 'external') {
            const trader = getPancakeTraderById(walletId);
            trader.setTxOverrides({ gasPrice, gasLimit });
            const p = (trader as any).wallet.provider;
            const nonceParam = (body as any).nonce;
            if (nonceParam === undefined)
                return sendJson(res, 400, errorResponse('MISSING_NONCE', '缺少必填参数 nonce', { endpoint: 'swap/sell' }));
            const nonce = Number(nonceParam);
            if (needApproveExternal) {
                try {
                    const signedApprove = await trader.approveTokenUnsigned(token, nonce);
                    await p.sendTransaction(signedApprove);
                }
                catch { }
                const useThreeRaw = (body as any).use_three_path;
                const quoteAddrReqRaw = String((body as any).quotetoken_address || '').trim();
                let signedSell: string;
                let useThreeFlag: boolean | null = null;
                if (typeof useThreeRaw === 'string') {
                    if (useThreeRaw === '1') useThreeFlag = true;
                    else if (useThreeRaw === '0') useThreeFlag = false;
                }
                else if (typeof useThreeRaw === 'number') {
                    if (useThreeRaw === 1) useThreeFlag = true;
                    else if (useThreeRaw === 0) useThreeFlag = false;
                }
                if (useThreeFlag === null) {
                    return sendJson(res, 400, errorResponse('MISSING_USE_THREE_PATH', 'use_three_path 必须为 1 或 0', { endpoint: 'swap/sell' }));
                }
                if (useThreeFlag) {
                    if (!ethers.utils.isAddress(quoteAddrReqRaw) || quoteAddrReqRaw.toLowerCase() === ethers.constants.AddressZero || quoteAddrReqRaw.toLowerCase() === WBNB.toLowerCase()) {
                        return sendJson(res, 400, errorResponse('INVALID_QUOTE_ADDRESS', 'use_three_path=true 时须提供有效的 quotetoken_address（非 0x0 且不可为 WBNB）', { endpoint: 'swap/sell', quotetoken_address: quoteAddrReqRaw }));
                    }
                    signedSell = await (trader as any).sellUnsignedPath([token, quoteAddrReqRaw, WBNB], amountWei, minFunds, nonce + 1);
                }
                else {
                    signedSell = await trader.sellUnsigned(token, amountWei, minFunds, nonce + 1);
                }
                const txSell = await p.sendTransaction(signedSell);
                return sendJson(res, 200, {
                    endpoint: 'swap/sell', tx_hash: txSell.hash, market: 'external', token,
                    token_amount_wei: amountWei.toString(), min_bnb_amount_wei: minFunds.toString(),
                    walletId: walletId,
                    gas_price_gwei: Number(ethers.utils.formatUnits(gasPrice, 'gwei')),
                    gas_limit: gasLimit.toString(), receipt_waited: false,
                });
            }
            const useThreeRaw = (body as any).use_three_path;
            const quoteAddrReqRaw = String((body as any).quotetoken_address || '').trim();
            let signed: string;
            let useThreeFlag: boolean | null = null;
            if (typeof useThreeRaw === 'string') {
                if (useThreeRaw === '1') useThreeFlag = true;
                else if (useThreeRaw === '0') useThreeFlag = false;
            }
            else if (typeof useThreeRaw === 'number') {
                if (useThreeRaw === 1) useThreeFlag = true;
                else if (useThreeRaw === 0) useThreeFlag = false;
            }
            if (useThreeFlag === null) {
                return sendJson(res, 400, errorResponse('MISSING_USE_THREE_PATH', 'use_three_path 必须为 1 或 0', { endpoint: 'swap/sell' }));
            }
            if (useThreeFlag) {
                if (!ethers.utils.isAddress(quoteAddrReqRaw) || quoteAddrReqRaw.toLowerCase() === ethers.constants.AddressZero || quoteAddrReqRaw.toLowerCase() === WBNB.toLowerCase()) {
                    return sendJson(res, 400, errorResponse('INVALID_QUOTE_ADDRESS', 'use_three_path=true 时须提供有效的 quotetoken_address（非 0x0 且不可为 WBNB）', { endpoint: 'swap/sell', quotetoken_address: quoteAddrReqRaw }));
                }
                signed = await (trader as any).sellUnsignedPath([token, quoteAddrReqRaw, WBNB], amountWei, minFunds, nonce);
            }
            else {
                signed = await trader.sellUnsigned(token, amountWei, minFunds, nonce);
            }
            const tx = await p.sendTransaction(signed);
            return sendJson(res, 200, {
                endpoint: 'swap/sell', tx_hash: tx.hash, market: 'external', token,
                token_amount_wei: amountWei.toString(), min_bnb_amount_wei: minFunds.toString(),
                walletId: walletId,
                gas_price_gwei: Number(ethers.utils.formatUnits(gasPrice, 'gwei')),
                gas_limit: gasLimit.toString(), receipt_waited: false,
            });
        }
        else {
            const trader = getTraderById(walletId);
            trader.setTxOverrides({ gasPrice, gasLimit });
            const p = (trader as any).wallet.provider;
            const nonceParam = (body as any).nonce;
            if (nonceParam === undefined)
                return sendJson(res, 400, errorResponse('MISSING_NONCE', '缺少必填参数 nonce', { endpoint: 'swap/sell' }));
            const nonce = Number(nonceParam);
            if (needApproveInternal) {
                try {
                    const chainId = 56;
                    const signedApprove = await trader.signApproveMaxNoEst(token, nonce, chainId);
                    await p.sendTransaction(signedApprove);
                }
                catch { }
                const signedSell = await trader.signSellPrecomputedNoEst(token, amountWei, minFunds, nonce + 1, 56);
                const txSell = await p.sendTransaction(signedSell);
                return sendJson(res, 200, {
                    endpoint: 'swap/sell', tx_hash: txSell.hash, market: 'internal', token,
                    token_amount_wei: amountWei.toString(), min_bnb_amount_wei: minFunds.toString(),
                    walletId: walletId,
                    gas_price_gwei: Number(ethers.utils.formatUnits(gasPrice, 'gwei')),
                    gas_limit: gasLimit.toString(), receipt_waited: false,
                });
            }
            const signed = await trader.signSellPrecomputedNoEst(token, amountWei, minFunds, nonce, 56);
            const tx = await p.sendTransaction(signed);
            return sendJson(res, 200, {
                endpoint: 'swap/sell', tx_hash: tx.hash, market: 'internal', token,
                token_amount_wei: amountWei.toString(), min_bnb_amount_wei: minFunds.toString(),
                walletId: walletId,
                gas_price_gwei: Number(ethers.utils.formatUnits(gasPrice, 'gwei')),
                gas_limit: gasLimit.toString(), receipt_waited: false,
            });
        }
    }
    catch (err: any) {
        return sendJson(res, 500, errorResponse('INTERNAL_ERROR', '服务端异常', { endpoint: 'swap/sell', detail: err?.message || String(err) }));
    }
}
