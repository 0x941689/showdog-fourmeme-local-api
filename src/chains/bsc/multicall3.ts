import { ethers } from 'ethers';
import { MULTICALL3, AGGREGATOR5_CONTRACT, PRICE_ORACLE } from './constants';
import { FourmemeTokenInfo } from './trading/optimized-aggregator';
import MULTICALL3_ABI from '../../abis/Multicall3.json';
import AGGREGATOR5_ABI from '../../abis/TokenInfoAggregator5.json';
import PRICE_ORACLE_ABI from '../../abis/FourMemePriceOracle.json';
import ERC20_ABI from '../../abis/ERC20.json';
function packCall(iface: ethers.utils.Interface, target: string, funcName: string, args: any[], allowFailure = true) {
    const data = iface.encodeFunctionData(funcName, args);
    return { target, allowFailure, callData: data };
}
function mapInfo(raw: any): FourmemeTokenInfo {
    return {
        basicInfo: {
            name: raw.basic.name,
            symbol: raw.basic.symbol,
            decimals: Number(raw.basic.decimals),
            totalSupply: raw.basic.totalSupply,
            isFourMemeToken: Boolean(raw.basic.isFourMemeToken),
        },
        platformInfo: {
            version: raw.platform.version,
            tokenManager: raw.platform.tokenManager,
            quote: raw.platform.quote,
            lastPrice: raw.platform.lastPrice,
            usdPrice: raw.platform.usdPrice,
            tradingFeeRate: raw.platform.tradingFeeRate,
            minTradingFee: raw.platform.minTradingFee,
            launchTime: raw.platform.launchTime,
            tradingStatus: Number(raw.platform.tradingStatus),
        },
        tradingInfo: {
            offers: raw.trading.offers,
            maxOffers: raw.trading.maxOffers,
            funds: raw.trading.funds,
            maxFunds: raw.trading.maxFunds,
            liquidityAdded: Boolean(raw.trading.liquidityAdded),
            offerPercentage: raw.trading.offerPercentage,
            fundsPercentage: raw.trading.fundsPercentage,
        },
        poolInfo: {
            quoteName: raw.pool.quoteName,
            quoteSymbol: raw.pool.quoteSymbol,
            quoteDecimals: Number(raw.pool.quoteDecimals),
            poolTokenBalance: raw.pool.poolTokenBalance,
            poolQuoteBalance: raw.pool.poolQuoteBalance,
            isXMode: Boolean(raw.pool.isXMode),
            template: raw.pool.template,
            v2TokenQuotePair: {
                pair: raw.pool.v2TokenQuotePair.pair,
                reserve0: { token: raw.pool.v2TokenQuotePair.reserve0.token, reserve: raw.pool.v2TokenQuotePair.reserve0.reserve },
                reserve1: { token: raw.pool.v2TokenQuotePair.reserve1.token, reserve: raw.pool.v2TokenQuotePair.reserve1.reserve },
            },
            v2WbnbQuotePair: {
                pair: raw.pool.v2WbnbQuotePair.pair,
                reserve0: { token: raw.pool.v2WbnbQuotePair.reserve0.token, reserve: raw.pool.v2WbnbQuotePair.reserve0.reserve },
                reserve1: { token: raw.pool.v2WbnbQuotePair.reserve1.token, reserve: raw.pool.v2WbnbQuotePair.reserve1.reserve },
            },
        },
    };
}
export async function quoteInternalBuyMulticall(provider: ethers.providers.Provider, token: string, bnbIn: ethers.BigNumber, slippagePercent: number = 0, owner?: string): Promise<{
    info: FourmemeTokenInfo;
    tokenAmount: ethers.BigNumber;
    minTokenAmount: ethers.BigNumber;
    pricePerToken: number;
    bnbUsdPrice: ethers.BigNumber;
    tokenUsdPrice: ethers.BigNumber;
    bnbBalance?: ethers.BigNumber;
    tokenBalance?: ethers.BigNumber;
}> {
    const aggIface = new ethers.utils.Interface(AGGREGATOR5_ABI);
    const oracleIface = new ethers.utils.Interface(PRICE_ORACLE_ABI);
    const mcIface = new ethers.utils.Interface(MULTICALL3_ABI);
    const ercIface = new ethers.utils.Interface(ERC20_ABI);
    const calls = [
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'getFourmemeTokenInfo', [token], true),
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'tryBuyWithBNB', [token, bnbIn], true),
        packCall(oracleIface, PRICE_ORACLE, 'getBNBUsdPrice', [], true),
        packCall(oracleIface, PRICE_ORACLE, 'getTokenUsdPrice', [token], true),
    ];
    if (owner) {
        calls.push(packCall(mcIface, MULTICALL3, 'getEthBalance', [owner], true));
        calls.push(packCall(ercIface, token, 'balanceOf', [owner], true));
    }
    const multicall = new ethers.Contract(MULTICALL3, MULTICALL3_ABI, provider);
    const results = await multicall.callStatic.aggregate3(calls);
    const rAgg = results[0];
    const rBuy = results[1];
    const rBnbUsd = results[2];
    const rTokenUsd = results[3];
    const rEthBal = owner ? results[4] : undefined;
    const rTokBal = owner ? results[5] : undefined;
    if (!rAgg?.success)
        throw new Error('获取代币信息失败（getFourmemeTokenInfo）');
    const [rawInfo] = aggIface.decodeFunctionResult('getFourmemeTokenInfo', rAgg.returnData);
    try {
    }
    catch (e) {
    }
    const info = mapInfo(rawInfo);
    let estimatedAmount = ethers.constants.Zero;
    if (rBuy?.success) {
        const dec = aggIface.decodeFunctionResult('tryBuyWithBNB', rBuy.returnData);
        estimatedAmount = dec[0];
    }
    const decimals = Number(info.basicInfo.decimals || 18);
    const tokenOutFloat = parseFloat(ethers.utils.formatUnits(estimatedAmount, decimals));
    const bnbInFloat = parseFloat(ethers.utils.formatEther(bnbIn));
    const pricePerToken = tokenOutFloat > 0 ? bnbInFloat / tokenOutFloat : 0;
    const slipBps = Math.max(0, Math.min(10000, Math.round(Number(slippagePercent) * 100)));
    const minTokenAmount = estimatedAmount.mul(10000 - slipBps).div(10000);
    const bnbUsdPrice = rBnbUsd?.success ? ethers.BigNumber.from(rBnbUsd.returnData) : ethers.constants.Zero;
    let tokenUsdPrice = ethers.constants.Zero;
    if (rTokenUsd?.success) {
        const dec = oracleIface.decodeFunctionResult('getTokenUsdPrice', rTokenUsd.returnData);
        tokenUsdPrice = dec[0];
    }
    try {
    }
    catch (e) {
    }
    let bnbBalance: ethers.BigNumber | undefined;
    let tokenBalance: ethers.BigNumber | undefined;
    if (owner && rEthBal?.success) {
        const decBal = mcIface.decodeFunctionResult('getEthBalance', rEthBal.returnData);
        bnbBalance = decBal[0];
    }
    if (owner && rTokBal?.success) {
        const decTok = ercIface.decodeFunctionResult('balanceOf', rTokBal.returnData);
        tokenBalance = decTok[0];
    }
    return { info, tokenAmount: estimatedAmount, minTokenAmount, pricePerToken, bnbUsdPrice, tokenUsdPrice, bnbBalance, tokenBalance };
}
export async function quoteSellMulticall(provider: ethers.providers.Provider, token: string, tokenAmount: ethers.BigNumber, owner?: string): Promise<{
    info: FourmemeTokenInfo;
    bnbAmount: ethers.BigNumber;
    pricePerToken: number;
    bnbUsdPrice: ethers.BigNumber;
    tokenUsdPrice: ethers.BigNumber;
    bnbBalance?: ethers.BigNumber;
    tokenBalance?: ethers.BigNumber;
}> {
    const aggIface = new ethers.utils.Interface(AGGREGATOR5_ABI);
    const oracleIface = new ethers.utils.Interface(PRICE_ORACLE_ABI);
    const mcIface = new ethers.utils.Interface(MULTICALL3_ABI);
    const ercIface = new ethers.utils.Interface(ERC20_ABI);
    const calls = [
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'getFourmemeTokenInfo', [token], true),
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'trySellToBNB', [token, tokenAmount], true),
        packCall(oracleIface, PRICE_ORACLE, 'getBNBUsdPrice', [], true),
        packCall(oracleIface, PRICE_ORACLE, 'getTokenUsdPrice', [token], true),
    ];
    if (owner) {
        calls.push(packCall(mcIface, MULTICALL3, 'getEthBalance', [owner], true));
        calls.push(packCall(ercIface, token, 'balanceOf', [owner], true));
    }
    const multicall = new ethers.Contract(MULTICALL3, MULTICALL3_ABI, provider);
    const results = await multicall.callStatic.aggregate3(calls);
    const rAgg = results[0];
    const rSell = results[1];
    const rBnbUsd = results[2];
    const rTokenUsd = results[3];
    const rEthBal = owner ? results[4] : undefined;
    const rTokBal = owner ? results[5] : undefined;
    if (!rAgg?.success)
        throw new Error('获取代币信息失败（getFourmemeTokenInfo）');
    if (!rSell?.success)
        throw new Error('卖出到 BNB 失败（trySellToBNB）');
    const [rawInfo] = aggIface.decodeFunctionResult('getFourmemeTokenInfo', rAgg.returnData);
    const info = mapInfo(rawInfo);
    const dec = aggIface.decodeFunctionResult('trySellToBNB', rSell.returnData);
    const estimatedBNB: ethers.BigNumber = dec[0];
    const decimals = Number(info.basicInfo.decimals || 18);
    const tokenAmtFloat = parseFloat(ethers.utils.formatUnits(tokenAmount, decimals));
    const bnbFloat = parseFloat(ethers.utils.formatEther(estimatedBNB));
    const pricePerToken = tokenAmtFloat > 0 ? bnbFloat / tokenAmtFloat : 0;
    const bnbUsdPrice = rBnbUsd?.success ? ethers.BigNumber.from(rBnbUsd.returnData) : ethers.constants.Zero;
    let tokenUsdPrice = ethers.constants.Zero;
    if (rTokenUsd?.success) {
        const dec2 = oracleIface.decodeFunctionResult('getTokenUsdPrice', rTokenUsd.returnData);
        tokenUsdPrice = dec2[0];
    }
    let bnbBalance: ethers.BigNumber | undefined;
    let tokenBalance: ethers.BigNumber | undefined;
    if (owner && rEthBal?.success) {
        const decBal = mcIface.decodeFunctionResult('getEthBalance', rEthBal.returnData);
        bnbBalance = decBal[0];
    }
    if (owner && rTokBal?.success) {
        const decTok = ercIface.decodeFunctionResult('balanceOf', rTokBal.returnData);
        tokenBalance = decTok[0];
    }
    return { info, bnbAmount: estimatedBNB, pricePerToken, bnbUsdPrice, tokenUsdPrice, bnbBalance, tokenBalance };
}
export async function quoteSellPercentageMulticall(provider: ethers.providers.Provider, token: string, owner: string, percent: number): Promise<{
    info: FourmemeTokenInfo;
    tokenAmount: ethers.BigNumber;
    bnbAmount: ethers.BigNumber;
    pricePerToken: number;
    bnbUsdPrice: ethers.BigNumber;
    tokenUsdPrice: ethers.BigNumber;
    bnbBalance?: ethers.BigNumber;
    tokenBalance?: ethers.BigNumber;
}> {
    const aggIface = new ethers.utils.Interface(AGGREGATOR5_ABI);
    const oracleIface = new ethers.utils.Interface(PRICE_ORACLE_ABI);
    const mcIface = new ethers.utils.Interface(MULTICALL3_ABI);
    const ercIface = new ethers.utils.Interface(ERC20_ABI);
    const calls = [
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'getFourmemeTokenInfo', [token], true),
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'trySellPercentageToBNB', [token, owner, ethers.BigNumber.from(percent)], true),
        packCall(oracleIface, PRICE_ORACLE, 'getBNBUsdPrice', [], true),
        packCall(oracleIface, PRICE_ORACLE, 'getTokenUsdPrice', [token], true),
        packCall(mcIface, MULTICALL3, 'getEthBalance', [owner], true),
        packCall(ercIface, token, 'balanceOf', [owner], true),
    ];
    const multicall = new ethers.Contract(MULTICALL3, MULTICALL3_ABI, provider);
    const results = await multicall.callStatic.aggregate3(calls);
    const rAgg = results[0];
    const rSell = results[1];
    const rBnbUsd = results[2];
    const rTokenUsd = results[3];
    const rEthBal = results[4];
    const rTokBal = results[5];
    if (!rAgg?.success)
        throw new Error('获取代币信息失败（getFourmemeTokenInfo）');
    if (!rSell?.success)
        throw new Error('按百分比卖出到 BNB 失败（trySellPercentageToBNB）');
    const [rawInfo] = aggIface.decodeFunctionResult('getFourmemeTokenInfo', rAgg.returnData);
    const info = mapInfo(rawInfo);
    const dec = aggIface.decodeFunctionResult('trySellPercentageToBNB', rSell.returnData);
    const estimatedBNB: ethers.BigNumber = dec[0];
    const sellAmount: ethers.BigNumber = dec[1];
    const decimals = Number(info.basicInfo.decimals || 18);
    const tokenAmtFloat = parseFloat(ethers.utils.formatUnits(sellAmount, decimals));
    const bnbFloat = parseFloat(ethers.utils.formatEther(estimatedBNB));
    const pricePerToken = tokenAmtFloat > 0 ? bnbFloat / tokenAmtFloat : 0;
    const bnbUsdPrice = rBnbUsd?.success ? ethers.BigNumber.from(rBnbUsd.returnData) : ethers.constants.Zero;
    let tokenUsdPrice = ethers.constants.Zero;
    if (rTokenUsd?.success) {
        const dec2 = oracleIface.decodeFunctionResult('getTokenUsdPrice', rTokenUsd.returnData);
        tokenUsdPrice = dec2[0];
    }
    let bnbBalance: ethers.BigNumber | undefined;
    let tokenBalance: ethers.BigNumber | undefined;
    if (rEthBal?.success) {
        const decBal = mcIface.decodeFunctionResult('getEthBalance', rEthBal.returnData);
        bnbBalance = decBal[0];
    }
    if (rTokBal?.success) {
        const decTok = ercIface.decodeFunctionResult('balanceOf', rTokBal.returnData);
        tokenBalance = decTok[0];
    }
    return { info, tokenAmount: sellAmount, bnbAmount: estimatedBNB, pricePerToken, bnbUsdPrice, tokenUsdPrice, bnbBalance, tokenBalance };
}
export const quoteBuyMulticall = quoteInternalBuyMulticall;
