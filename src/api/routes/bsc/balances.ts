import { IncomingMessage, ServerResponse } from 'http';
import { ethers } from 'ethers';
import { parseJsonBody, parseQueryParams, sendJson, errorResponse } from '../../utils/http';
import { getDisplayDp, formatEtherDp, formatUnitsDp, formatUnitsTruncDp } from '../../utils/format';
import { provider, walletCfg, getTraderById } from '../../context';
import MULTICALL3_ABI from '../../../abis/Multicall3.json';
import AGGREGATOR5_ABI from '../../../abis/TokenInfoAggregator5.json';
import ERC20_ABI from '../../../abis/ERC20.json';
import PRICE_ORACLE_ABI from '../../../abis/FourMemePriceOracle.json';
import { MULTICALL3, AGGREGATOR5_CONTRACT, PRICE_ORACLE } from '../../../chains/bsc/constants';
function formatUsdTwoDecimals(valueWei18: ethers.BigNumber): string {
    const threshold = ethers.utils.parseUnits('0.01', 18);
    if (valueWei18.lt(threshold))
        return '0';
    const denom = ethers.constants.WeiPerEther;
    const scaled = valueWei18.mul(100);
    const roundedCents = scaled.add(denom.div(2)).div(denom);
    const s = roundedCents.toString();
    if (s.length <= 2) {
        return `0.${s.padStart(2, '0')}`;
    }
    return `${s.slice(0, -2)}.${s.slice(-2)}`;
}
export async function handleBalances(req: IncomingMessage, res: ServerResponse) {
    try {
        const reqId = Math.random().toString(36).slice(2, 10);
        const started = Date.now();
        const body = req.method === 'GET'
            ? parseQueryParams(req)
            : ((req as any)._parsedBody ?? await parseJsonBody(req));
        if ((body as any).walletId === undefined) {
            return sendJson(res, 400, errorResponse('MISSING_WALLET_ID', 'walletId 必须提供', { endpoint: 'balances' }));
        }
        const walletId = Number((body as any).walletId);
        const displayDp = getDisplayDp(body);
        if (Number.isNaN(walletId)) {
            return sendJson(res, 400, errorResponse('INVALID_WALLET_ID', 'walletId 必须为数字', { endpoint: 'balances', walletId: String((body as any).walletId) }));
        }
        const walletIds = new Set(walletCfg.wallets.map(w => w.id));
        if (!walletIds.has(walletId)) {
            return sendJson(res, 400, errorResponse('WALLET_NOT_FOUND', '指定的钱包编号不存在', { endpoint: 'balances', walletId }));
        }
        const token = (body as any).token ? String((body as any).token).trim() : undefined;
        const trader = getTraderById(walletId);
        const address = trader.address();
        let result: any;
        if (token) {
            if (!ethers.utils.isAddress(token)) {
                return sendJson(res, 400, errorResponse('INVALID_TOKEN_ADDRESS', '无效代币地址', { endpoint: 'balances', token }));
            }
            const aggIface = new ethers.utils.Interface(AGGREGATOR5_ABI as any);
            const mcIface = new ethers.utils.Interface(MULTICALL3_ABI as any);
            const ercIface = new ethers.utils.Interface(ERC20_ABI as any);
            const oracleIface = new ethers.utils.Interface(PRICE_ORACLE_ABI as any);
            const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI as any, provider);
            const calls = [
                { target: AGGREGATOR5_CONTRACT, allowFailure: true, callData: aggIface.encodeFunctionData('getFourmemeTokenInfo', [token]) },
                { target: MULTICALL3, allowFailure: true, callData: mcIface.encodeFunctionData('getEthBalance', [address]) },
                { target: token, allowFailure: true, callData: ercIface.encodeFunctionData('balanceOf', [address]) },
                { target: PRICE_ORACLE, allowFailure: true, callData: oracleIface.encodeFunctionData('getBNBUsdPrice', []) },
                { target: PRICE_ORACLE, allowFailure: true, callData: oracleIface.encodeFunctionData('getTokenUsdPrice', [token]) },
            ];
            const results = await (mc.callStatic as any).aggregate3(calls);
            const rInfo = results[0];
            const rBnb = results[1];
            const rTokBal = results[2];
            const rBnbUsd = results[3];
            const rTokenUsd = results[4];
            if (!rInfo?.success)
                throw new Error('获取代币信息失败（getFourmemeTokenInfo）');
            const [rawInfo] = aggIface.decodeFunctionResult('getFourmemeTokenInfo', rInfo.returnData);
            const decimals = Number(rawInfo.basic.decimals);
            const symbol = String(rawInfo.basic.symbol);
            const bnbBal = rBnb?.success ? (mcIface.decodeFunctionResult('getEthBalance', rBnb.returnData)[0] as ethers.BigNumber) : ethers.constants.Zero;
            const tbal = rTokBal?.success ? (ercIface.decodeFunctionResult('balanceOf', rTokBal.returnData)[0] as ethers.BigNumber) : ethers.constants.Zero;
            const bnbUsdPrice = rBnbUsd?.success ? (oracleIface.decodeFunctionResult('getBNBUsdPrice', rBnbUsd.returnData)[0] as ethers.BigNumber) : ethers.constants.Zero;
            const tokenUsdPrice = rTokenUsd?.success ? (oracleIface.decodeFunctionResult('getTokenUsdPrice', rTokenUsd.returnData)[0] as ethers.BigNumber) : ethers.constants.Zero;
            const bnbUsdValueBn = bnbUsdPrice.mul(bnbBal).div(ethers.constants.WeiPerEther);
            const tokenUsdValueBn = tokenUsdPrice.mul(tbal).div(ethers.constants.WeiPerEther);
            result = {
                walletId,
                address,
                bnb_balance: formatEtherDp(bnbBal, displayDp),
                token,
                token_balance: formatUnitsDp(tbal, decimals, displayDp),
                token_symbol: symbol,
                token_decimals: decimals,
                display_dp: displayDp,
                bnb_usd_price: ethers.utils.formatUnits(bnbUsdPrice, 18),
                token_usd_price: ethers.utils.formatUnits(tokenUsdPrice, 18),
                bnb_usd_value: formatUsdTwoDecimals(bnbUsdValueBn),
                token_usd_value: formatUsdTwoDecimals(tokenUsdValueBn),
            };
        }
        else {
            const mcIface = new ethers.utils.Interface(MULTICALL3_ABI as any);
            const oracleIface = new ethers.utils.Interface(PRICE_ORACLE_ABI as any);
            const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI as any, provider);
            const calls = [
                { target: MULTICALL3, allowFailure: true, callData: mcIface.encodeFunctionData('getEthBalance', [address]) },
                { target: PRICE_ORACLE, allowFailure: true, callData: oracleIface.encodeFunctionData('getBNBUsdPrice', []) },
            ];
            const results = await (mc.callStatic as any).aggregate3(calls);
            const rBnb = results[0];
            const rBnbUsd = results[1];
            const bnbBal = rBnb?.success ? (mcIface.decodeFunctionResult('getEthBalance', rBnb.returnData)[0] as ethers.BigNumber) : ethers.constants.Zero;
            const bnbUsdPrice = rBnbUsd?.success ? (oracleIface.decodeFunctionResult('getBNBUsdPrice', rBnbUsd.returnData)[0] as ethers.BigNumber) : ethers.constants.Zero;
            const bnbUsdValueBn = bnbUsdPrice.mul(bnbBal).div(ethers.constants.WeiPerEther);
            result = {
                walletId,
                address,
                bnb_balance: formatEtherDp(bnbBal, displayDp),
                display_dp: displayDp,
                bnb_usd_price: ethers.utils.formatUnits(bnbUsdPrice, 18),
                bnb_usd_value: formatUsdTwoDecimals(bnbUsdValueBn),
            };
        }
        return sendJson(res, 200, result);
    }
    catch (err: any) {
        return sendJson(res, 500, { error: err?.message || String(err) });
    }
}
