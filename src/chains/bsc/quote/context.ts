import { ethers } from 'ethers';
import { FOURMEME_CONTRACT, MULTICALL3, AGGREGATOR5_CONTRACT, PANCAKE_V2_ROUTER, PRICE_ORACLE } from '../constants';
import { FourmemeTokenInfo } from '../trading/optimized-aggregator';
import ERC20_ABI from '../../../abis/ERC20.json';
import MULTICALL3_ABI from '../../../abis/Multicall3.json';
import AGGREGATOR5_ABI from '../../../abis/TokenInfoAggregator5.json';
import PRICE_ORACLE_ABI from '../../../abis/FourMemePriceOracle.json';
import { quoteInternalBuyMulticall, quoteSellMulticall, quoteSellPercentageMulticall } from '../multicall3';
function packCall(iface: ethers.utils.Interface, target: string, funcName: string, args: any[], allowFailure = true) {
    const data = iface.encodeFunctionData(funcName, args);
    return { target, allowFailure, callData: data };
}
export async function prepareBuyWithAllowanceMulticall(provider: ethers.providers.Provider, token: string, owner: string, bnbIn: ethers.BigNumber, slippagePercent: number = 0): Promise<{
    info: FourmemeTokenInfo;
    tokenAmount: ethers.BigNumber;
    minTokenAmount: ethers.BigNumber;
    pricePerToken: number;
    allowance: ethers.BigNumber;
}> {
    const aggIface = new ethers.utils.Interface(AGGREGATOR5_ABI);
    const ercIface = new ethers.utils.Interface(ERC20_ABI as any);
    const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI as any, provider);
    const calls = [
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'getFourmemeTokenInfo', [token], true),
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'tryBuyWithBNB', [token, bnbIn], true),
        packCall(ercIface, token, 'allowance', [owner, FOURMEME_CONTRACT], true),
    ];
    const results = await (mc.callStatic as any).aggregate3(calls);
    const rInfo = results[0];
    const rBuy = results[1];
    const rAllow = results[2];
    if (!rInfo?.success)
            throw new Error('获取代币信息失败（getFourmemeTokenInfo）');
    const [rawInfo] = aggIface.decodeFunctionResult('getFourmemeTokenInfo', rInfo.returnData);
    const info = {
        basicInfo: {
            name: rawInfo.basic.name,
            symbol: rawInfo.basic.symbol,
            decimals: Number(rawInfo.basic.decimals),
            totalSupply: rawInfo.basic.totalSupply,
            isFourMemeToken: Boolean(rawInfo.basic.isFourMemeToken),
        },
        platformInfo: {
            version: rawInfo.platform.version,
            tokenManager: rawInfo.platform.tokenManager,
            quote: rawInfo.platform.quote,
            lastPrice: rawInfo.platform.lastPrice,
            usdPrice: rawInfo.platform.usdPrice,
            tradingFeeRate: rawInfo.platform.tradingFeeRate,
            minTradingFee: rawInfo.platform.minTradingFee,
            launchTime: rawInfo.platform.launchTime,
            tradingStatus: Number(rawInfo.platform.tradingStatus),
        },
        tradingInfo: {
            offers: rawInfo.trading.offers,
            maxOffers: rawInfo.trading.maxOffers,
            funds: rawInfo.trading.funds,
            maxFunds: rawInfo.trading.maxFunds,
            liquidityAdded: Boolean(rawInfo.trading.liquidityAdded),
            offerPercentage: rawInfo.trading.offerPercentage,
            fundsPercentage: rawInfo.trading.fundsPercentage,
        },
        poolInfo: {
            quoteName: rawInfo.pool.quoteName,
            quoteSymbol: rawInfo.pool.quoteSymbol,
            quoteDecimals: Number(rawInfo.pool.quoteDecimals),
            poolTokenBalance: rawInfo.pool.poolTokenBalance,
            poolQuoteBalance: rawInfo.pool.poolQuoteBalance,
            isXMode: Boolean(rawInfo.pool.isXMode),
            template: rawInfo.pool.template,
            v2TokenQuotePair: {
                pair: rawInfo.pool.v2TokenQuotePair.pair,
                reserve0: { token: rawInfo.pool.v2TokenQuotePair.reserve0.token, reserve: rawInfo.pool.v2TokenQuotePair.reserve0.reserve },
                reserve1: { token: rawInfo.pool.v2TokenQuotePair.reserve1.token, reserve: rawInfo.pool.v2TokenQuotePair.reserve1.reserve },
            },
            v2WbnbQuotePair: {
                pair: rawInfo.pool.v2WbnbQuotePair.pair,
                reserve0: { token: rawInfo.pool.v2WbnbQuotePair.reserve0.token, reserve: rawInfo.pool.v2WbnbQuotePair.reserve0.reserve },
                reserve1: { token: rawInfo.pool.v2WbnbQuotePair.reserve1.token, reserve: rawInfo.pool.v2WbnbQuotePair.reserve1.reserve },
            },
        },
    } as FourmemeTokenInfo;
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
    const allowance = rAllow?.success ? ethers.BigNumber.from(rAllow.returnData) : ethers.constants.Zero;
    return { info, tokenAmount: estimatedAmount, minTokenAmount, pricePerToken, allowance };
}
export async function prepareBuyDualAllowanceMulticall(provider: ethers.providers.Provider, token: string, owner: string, bnbIn: ethers.BigNumber, slippagePercent: number = 0): Promise<{
    info: FourmemeTokenInfo;
    tokenAmount: ethers.BigNumber;
    minTokenAmount: ethers.BigNumber;
    pricePerToken: number;
    allowanceFourmeme: ethers.BigNumber;
    allowanceRouter: ethers.BigNumber;
    bnbUsdPrice: ethers.BigNumber;
    tokenUsdPrice: ethers.BigNumber;
    bnbBalance: ethers.BigNumber;
    tokenBalance: ethers.BigNumber;
}> {
    const aggIface = new ethers.utils.Interface(AGGREGATOR5_ABI);
    const ercIface = new ethers.utils.Interface(ERC20_ABI as any);
    const oracleIface = new ethers.utils.Interface(PRICE_ORACLE_ABI as any);
    const mcIface = new ethers.utils.Interface(MULTICALL3_ABI as any);
    const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI as any, provider);
    const calls = [
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'getFourmemeTokenInfo', [token], true),
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'tryBuyWithBNB', [token, bnbIn], true),
        packCall(ercIface, token, 'allowance', [owner, FOURMEME_CONTRACT], true),
        packCall(ercIface, token, 'allowance', [owner, PANCAKE_V2_ROUTER], true),
        packCall(oracleIface, PRICE_ORACLE, 'getBNBUsdPrice', [], true),
        packCall(oracleIface, PRICE_ORACLE, 'getTokenUsdPrice', [token], true),
        packCall(mcIface, MULTICALL3, 'getEthBalance', [owner], true),
        packCall(ercIface, token, 'balanceOf', [owner], true),
    ];
    const results = await (mc.callStatic as any).aggregate3(calls);
    const rInfo = results[0];
    const rBuy = results[1];
    const rAllowInternal = results[2];
    const rAllowRouter = results[3];
    const rBnbUsd = results[4];
    const rTokenUsd = results[5];
    const rBnbBal = results[6];
    const rTokenBal = results[7];
    if (!rInfo?.success)
throw new Error('获取代币信息失败（getFourmemeTokenInfo）');
    const [rawInfo] = aggIface.decodeFunctionResult('getFourmemeTokenInfo', rInfo.returnData);
    const info = {
        basicInfo: {
            name: rawInfo.basic.name,
            symbol: rawInfo.basic.symbol,
            decimals: Number(rawInfo.basic.decimals),
            totalSupply: rawInfo.basic.totalSupply,
            isFourMemeToken: Boolean(rawInfo.basic.isFourMemeToken),
        },
        platformInfo: {
            version: rawInfo.platform.version,
            tokenManager: rawInfo.platform.tokenManager,
            quote: rawInfo.platform.quote,
            lastPrice: rawInfo.platform.lastPrice,
            usdPrice: rawInfo.platform.usdPrice,
            tradingFeeRate: rawInfo.platform.tradingFeeRate,
            minTradingFee: rawInfo.platform.minTradingFee,
            launchTime: rawInfo.platform.launchTime,
            tradingStatus: Number(rawInfo.platform.tradingStatus),
        },
        tradingInfo: {
            offers: rawInfo.trading.offers,
            maxOffers: rawInfo.trading.maxOffers,
            funds: rawInfo.trading.funds,
            maxFunds: rawInfo.trading.maxFunds,
            liquidityAdded: Boolean(rawInfo.trading.liquidityAdded),
            offerPercentage: rawInfo.trading.offerPercentage,
            fundsPercentage: rawInfo.trading.fundsPercentage,
        },
        poolInfo: {
            quoteName: rawInfo.pool.quoteName,
            quoteSymbol: rawInfo.pool.quoteSymbol,
            quoteDecimals: Number(rawInfo.pool.quoteDecimals),
            poolTokenBalance: rawInfo.pool.poolTokenBalance,
            poolQuoteBalance: rawInfo.pool.poolQuoteBalance,
            isXMode: Boolean(rawInfo.pool.isXMode),
            template: rawInfo.pool.template,
            v2TokenQuotePair: {
                pair: rawInfo.pool.v2TokenQuotePair.pair,
                reserve0: { token: rawInfo.pool.v2TokenQuotePair.reserve0.token, reserve: rawInfo.pool.v2TokenQuotePair.reserve0.reserve },
                reserve1: { token: rawInfo.pool.v2TokenQuotePair.reserve1.token, reserve: rawInfo.pool.v2TokenQuotePair.reserve1.reserve },
            },
            v2WbnbQuotePair: {
                pair: rawInfo.pool.v2WbnbQuotePair.pair,
                reserve0: { token: rawInfo.pool.v2WbnbQuotePair.reserve0.token, reserve: rawInfo.pool.v2WbnbQuotePair.reserve0.reserve },
                reserve1: { token: rawInfo.pool.v2WbnbQuotePair.reserve1.token, reserve: rawInfo.pool.v2WbnbQuotePair.reserve1.reserve },
            },
        },
    } as FourmemeTokenInfo;
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
    const allowanceFourmeme = rAllowInternal?.success ? ethers.BigNumber.from(rAllowInternal.returnData) : ethers.constants.Zero;
    const allowanceRouter = rAllowRouter?.success ? ethers.BigNumber.from(rAllowRouter.returnData) : ethers.constants.Zero;
    const bnbUsdPrice: ethers.BigNumber = rBnbUsd?.success ? (oracleIface.decodeFunctionResult('getBNBUsdPrice', rBnbUsd.returnData)[0] as ethers.BigNumber) : ethers.constants.Zero;
    const tokenUsdPrice: ethers.BigNumber = rTokenUsd?.success ? (oracleIface.decodeFunctionResult('getTokenUsdPrice', rTokenUsd.returnData)[0] as ethers.BigNumber) : ethers.constants.Zero;
    const bnbBalance: ethers.BigNumber = rBnbBal?.success ? ethers.BigNumber.from(rBnbBal.returnData) : ethers.constants.Zero;
    const tokenBalance: ethers.BigNumber = rTokenBal?.success ? ethers.BigNumber.from(rTokenBal.returnData) : ethers.constants.Zero;
    return { info, tokenAmount: estimatedAmount, minTokenAmount, pricePerToken, allowanceFourmeme, allowanceRouter, bnbUsdPrice, tokenUsdPrice, bnbBalance, tokenBalance };
}
export async function prepareSellWithAllowanceMulticall(provider: ethers.providers.Provider, token: string, owner: string, tokenAmount: ethers.BigNumber): Promise<{
    info: FourmemeTokenInfo;
    bnbAmount: ethers.BigNumber;
    pricePerToken: number;
    allowance: ethers.BigNumber;
}> {
    const aggIface = new ethers.utils.Interface(AGGREGATOR5_ABI);
    const ercIface = new ethers.utils.Interface(ERC20_ABI as any);
    const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI as any, provider);
    const calls = [
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'getFourmemeTokenInfo', [token], true),
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'trySellToBNB', [token, tokenAmount], true),
        packCall(ercIface, token, 'allowance', [owner, FOURMEME_CONTRACT], true),
    ];
    const results = await (mc.callStatic as any).aggregate3(calls);
    const rInfo = results[0];
    const rSell = results[1];
    const rAllow = results[2];
    if (!rInfo?.success)
throw new Error('获取代币信息失败（getFourmemeTokenInfo）');
    if (!rSell?.success)
            throw new Error('卖出到 BNB 失败（trySellToBNB）');
    const [rawInfo] = aggIface.decodeFunctionResult('getFourmemeTokenInfo', rInfo.returnData);
    const info = {
        basicInfo: {
            name: rawInfo.basic.name,
            symbol: rawInfo.basic.symbol,
            decimals: Number(rawInfo.basic.decimals),
            totalSupply: rawInfo.basic.totalSupply,
            isFourMemeToken: Boolean(rawInfo.basic.isFourMemeToken),
        },
        platformInfo: {
            version: rawInfo.platform.version,
            tokenManager: rawInfo.platform.tokenManager,
            quote: rawInfo.platform.quote,
            lastPrice: rawInfo.platform.lastPrice,
            usdPrice: rawInfo.platform.usdPrice,
            tradingFeeRate: rawInfo.platform.tradingFeeRate,
            minTradingFee: rawInfo.platform.minTradingFee,
            launchTime: rawInfo.platform.launchTime,
            tradingStatus: Number(rawInfo.platform.tradingStatus),
        },
        tradingInfo: {
            offers: rawInfo.trading.offers,
            maxOffers: rawInfo.trading.maxOffers,
            funds: rawInfo.trading.funds,
            maxFunds: rawInfo.trading.maxFunds,
            liquidityAdded: Boolean(rawInfo.trading.liquidityAdded),
            offerPercentage: rawInfo.trading.offerPercentage,
            fundsPercentage: rawInfo.trading.fundsPercentage,
        },
        poolInfo: {
            quoteName: rawInfo.pool.quoteName,
            quoteSymbol: rawInfo.pool.quoteSymbol,
            quoteDecimals: Number(rawInfo.pool.quoteDecimals),
            poolTokenBalance: rawInfo.pool.poolTokenBalance,
            poolQuoteBalance: rawInfo.pool.poolQuoteBalance,
            isXMode: Boolean(rawInfo.pool.isXMode),
            template: rawInfo.pool.template,
            v2TokenQuotePair: {
                pair: rawInfo.pool.v2TokenQuotePair.pair,
                reserve0: { token: rawInfo.pool.v2TokenQuotePair.reserve0.token, reserve: rawInfo.pool.v2TokenQuotePair.reserve0.reserve },
                reserve1: { token: rawInfo.pool.v2TokenQuotePair.reserve1.token, reserve: rawInfo.pool.v2TokenQuotePair.reserve1.reserve },
            },
            v2WbnbQuotePair: {
                pair: rawInfo.pool.v2WbnbQuotePair.pair,
                reserve0: { token: rawInfo.pool.v2WbnbQuotePair.reserve0.token, reserve: rawInfo.pool.v2WbnbQuotePair.reserve0.reserve },
                reserve1: { token: rawInfo.pool.v2WbnbQuotePair.reserve1.token, reserve: rawInfo.pool.v2WbnbQuotePair.reserve1.reserve },
            },
        },
    } as FourmemeTokenInfo;
    const dec = aggIface.decodeFunctionResult('trySellToBNB', rSell.returnData);
    const estimatedBNB: ethers.BigNumber = dec[0];
    const decimals = Number(info.basicInfo.decimals || 18);
    const tokenAmtFloat = parseFloat(ethers.utils.formatUnits(tokenAmount, decimals));
    const bnbFloat = parseFloat(ethers.utils.formatEther(estimatedBNB));
    const pricePerToken = tokenAmtFloat > 0 ? bnbFloat / tokenAmtFloat : 0;
    const allowance = rAllow?.success ? ethers.BigNumber.from(rAllow.returnData) : ethers.constants.Zero;
    return { info, bnbAmount: estimatedBNB, pricePerToken, allowance };
}
export async function prepareSellDualAllowanceMulticall(provider: ethers.providers.Provider, token: string, owner: string, tokenAmount: ethers.BigNumber): Promise<{
    info: FourmemeTokenInfo;
    bnbAmount: ethers.BigNumber;
    pricePerToken: number;
    allowanceFourmeme: ethers.BigNumber;
    allowanceRouter: ethers.BigNumber;
    bnbUsdPrice: ethers.BigNumber;
    tokenUsdPrice: ethers.BigNumber;
    bnbBalance: ethers.BigNumber;
    tokenBalance: ethers.BigNumber;
}> {
    const aggIface = new ethers.utils.Interface(AGGREGATOR5_ABI);
    const ercIface = new ethers.utils.Interface(ERC20_ABI as any);
    const oracleIface = new ethers.utils.Interface(PRICE_ORACLE_ABI as any);
    const mcIface = new ethers.utils.Interface(MULTICALL3_ABI as any);
    const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI as any, provider);
    const calls = [
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'getFourmemeTokenInfo', [token], true),
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'trySellToBNB', [token, tokenAmount], true),
        packCall(ercIface, token, 'allowance', [owner, FOURMEME_CONTRACT], true),
        packCall(ercIface, token, 'allowance', [owner, PANCAKE_V2_ROUTER], true),
        packCall(oracleIface, PRICE_ORACLE, 'getBNBUsdPrice', [], true),
        packCall(oracleIface, PRICE_ORACLE, 'getTokenUsdPrice', [token], true),
        packCall(mcIface, MULTICALL3, 'getEthBalance', [owner], true),
        packCall(ercIface, token, 'balanceOf', [owner], true),
    ];
    const results = await (mc.callStatic as any).aggregate3(calls);
    const rInfo = results[0];
    const rSell = results[1];
    const rAllowInternal = results[2];
    const rAllowRouter = results[3];
    const rBnbUsd = results[4];
    const rTokenUsd = results[5];
    const rBnbBal = results[6];
    const rTokenBal = results[7];
    if (!rInfo?.success)
throw new Error('获取代币信息失败（getFourmemeTokenInfo）');
    if (!rSell?.success)
throw new Error('卖出到 BNB 失败（trySellToBNB）');
    const [rawInfo] = aggIface.decodeFunctionResult('getFourmemeTokenInfo', rInfo.returnData);
    const info = {
        basicInfo: {
            name: rawInfo.basic.name,
            symbol: rawInfo.basic.symbol,
            decimals: Number(rawInfo.basic.decimals),
            totalSupply: rawInfo.basic.totalSupply,
            isFourMemeToken: Boolean(rawInfo.basic.isFourMemeToken),
        },
        platformInfo: {
            version: rawInfo.platform.version,
            tokenManager: rawInfo.platform.tokenManager,
            quote: rawInfo.platform.quote,
            lastPrice: rawInfo.platform.lastPrice,
            usdPrice: rawInfo.platform.usdPrice,
            tradingFeeRate: rawInfo.platform.tradingFeeRate,
            minTradingFee: rawInfo.platform.minTradingFee,
            launchTime: rawInfo.platform.launchTime,
            tradingStatus: Number(rawInfo.platform.tradingStatus),
        },
        tradingInfo: {
            offers: rawInfo.trading.offers,
            maxOffers: rawInfo.trading.maxOffers,
            funds: rawInfo.trading.funds,
            maxFunds: rawInfo.trading.maxFunds,
            liquidityAdded: Boolean(rawInfo.trading.liquidityAdded),
            offerPercentage: rawInfo.trading.offerPercentage,
            fundsPercentage: rawInfo.trading.fundsPercentage,
        },
        poolInfo: {
            quoteName: rawInfo.pool.quoteName,
            quoteSymbol: rawInfo.pool.quoteSymbol,
            quoteDecimals: Number(rawInfo.pool.quoteDecimals),
            poolTokenBalance: rawInfo.pool.poolTokenBalance,
            poolQuoteBalance: rawInfo.pool.poolQuoteBalance,
            isXMode: Boolean(rawInfo.pool.isXMode),
            template: rawInfo.pool.template,
            v2TokenQuotePair: {
                pair: rawInfo.pool.v2TokenQuotePair.pair,
                reserve0: { token: rawInfo.pool.v2TokenQuotePair.reserve0.token, reserve: rawInfo.pool.v2TokenQuotePair.reserve0.reserve },
                reserve1: { token: rawInfo.pool.v2TokenQuotePair.reserve1.token, reserve: rawInfo.pool.v2TokenQuotePair.reserve1.reserve },
            },
            v2WbnbQuotePair: {
                pair: rawInfo.pool.v2WbnbQuotePair.pair,
                reserve0: { token: rawInfo.pool.v2WbnbQuotePair.reserve0.token, reserve: rawInfo.pool.v2WbnbQuotePair.reserve0.reserve },
                reserve1: { token: rawInfo.pool.v2WbnbQuotePair.reserve1.token, reserve: rawInfo.pool.v2WbnbQuotePair.reserve1.reserve },
            },
        },
    } as FourmemeTokenInfo;
    const dec = aggIface.decodeFunctionResult('trySellToBNB', rSell.returnData);
    const estimatedBNB: ethers.BigNumber = dec[0];
    const decimals = Number(info.basicInfo.decimals || 18);
    const tokenAmtFloat = parseFloat(ethers.utils.formatUnits(tokenAmount, decimals));
    const bnbFloat = parseFloat(ethers.utils.formatEther(estimatedBNB));
    const pricePerToken = tokenAmtFloat > 0 ? bnbFloat / tokenAmtFloat : 0;
    const allowanceFourmeme = rAllowInternal?.success ? ethers.BigNumber.from(rAllowInternal.returnData) : ethers.constants.Zero;
    const allowanceRouter = rAllowRouter?.success ? ethers.BigNumber.from(rAllowRouter.returnData) : ethers.constants.Zero;
    const bnbUsdPrice: ethers.BigNumber = rBnbUsd?.success ? (oracleIface.decodeFunctionResult('getBNBUsdPrice', rBnbUsd.returnData)[0] as ethers.BigNumber) : ethers.constants.Zero;
    const tokenUsdPrice: ethers.BigNumber = rTokenUsd?.success ? (oracleIface.decodeFunctionResult('getTokenUsdPrice', rTokenUsd.returnData)[0] as ethers.BigNumber) : ethers.constants.Zero;
    const bnbBalance: ethers.BigNumber = rBnbBal?.success ? ethers.BigNumber.from(rBnbBal.returnData) : ethers.constants.Zero;
    const tokenBalance: ethers.BigNumber = rTokenBal?.success ? ethers.BigNumber.from(rTokenBal.returnData) : ethers.constants.Zero;
    return { info, bnbAmount: estimatedBNB, pricePerToken, allowanceFourmeme, allowanceRouter, bnbUsdPrice, tokenUsdPrice, bnbBalance, tokenBalance };
}
export async function prepareSellPercentageWithAllowanceMulticall(provider: ethers.providers.Provider, token: string, owner: string, percent: number): Promise<{
    info: FourmemeTokenInfo;
    tokenAmount: ethers.BigNumber;
    bnbAmount: ethers.BigNumber;
    pricePerToken: number;
    allowance: ethers.BigNumber;
    bnbUsdPrice: ethers.BigNumber;
    tokenUsdPrice: ethers.BigNumber;
    bnbBalance: ethers.BigNumber;
    tokenBalance: ethers.BigNumber;
}> {
    const aggIface = new ethers.utils.Interface(AGGREGATOR5_ABI);
    const ercIface = new ethers.utils.Interface(ERC20_ABI as any);
    const oracleIface = new ethers.utils.Interface(PRICE_ORACLE_ABI as any);
    const mcIface = new ethers.utils.Interface(MULTICALL3_ABI as any);
    const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI as any, provider);
    const calls = [
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'getFourmemeTokenInfo', [token], true),
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'trySellPercentageToBNB', [token, owner, ethers.BigNumber.from(percent)], true),
        packCall(ercIface, token, 'allowance', [owner, FOURMEME_CONTRACT], true),
        packCall(oracleIface, PRICE_ORACLE, 'getBNBUsdPrice', [], true),
        packCall(oracleIface, PRICE_ORACLE, 'getTokenUsdPrice', [token], true),
        packCall(mcIface, MULTICALL3, 'getEthBalance', [owner], true),
        packCall(ercIface, token, 'balanceOf', [owner], true),
    ];
    const results = await (mc.callStatic as any).aggregate3(calls);
    const rInfo = results[0];
    const rSell = results[1];
    const rAllow = results[2];
    const rBnbUsd = results[3];
    const rTokenUsd = results[4];
    const rBnbBal = results[5];
    const rTokenBal = results[6];
    if (!rInfo?.success)
throw new Error('获取代币信息失败（getFourmemeTokenInfo）');
    if (!rSell?.success)
            throw new Error('按百分比卖出到 BNB 失败（trySellPercentageToBNB）');
    const [rawInfo] = aggIface.decodeFunctionResult('getFourmemeTokenInfo', rInfo.returnData);
    const info = {
        basicInfo: {
            name: rawInfo.basic.name,
            symbol: rawInfo.basic.symbol,
            decimals: Number(rawInfo.basic.decimals),
            totalSupply: rawInfo.basic.totalSupply,
            isFourMemeToken: Boolean(rawInfo.basic.isFourMemeToken),
        },
        platformInfo: {
            version: rawInfo.platform.version,
            tokenManager: rawInfo.platform.tokenManager,
            quote: rawInfo.platform.quote,
            lastPrice: rawInfo.platform.lastPrice,
            usdPrice: rawInfo.platform.usdPrice,
            tradingFeeRate: rawInfo.platform.tradingFeeRate,
            minTradingFee: rawInfo.platform.minTradingFee,
            launchTime: rawInfo.platform.launchTime,
            tradingStatus: Number(rawInfo.platform.tradingStatus),
        },
        tradingInfo: {
            offers: rawInfo.trading.offers,
            maxOffers: rawInfo.trading.maxOffers,
            funds: rawInfo.trading.funds,
            maxFunds: rawInfo.trading.maxFunds,
            liquidityAdded: Boolean(rawInfo.trading.liquidityAdded),
            offerPercentage: rawInfo.trading.offerPercentage,
            fundsPercentage: rawInfo.trading.fundsPercentage,
        },
        poolInfo: {
            quoteName: rawInfo.pool.quoteName,
            quoteSymbol: rawInfo.pool.quoteSymbol,
            quoteDecimals: Number(rawInfo.pool.quoteDecimals),
            poolTokenBalance: rawInfo.pool.poolTokenBalance,
            poolQuoteBalance: rawInfo.pool.poolQuoteBalance,
            isXMode: Boolean(rawInfo.pool.isXMode),
            template: rawInfo.pool.template,
            v2TokenQuotePair: {
                pair: rawInfo.pool.v2TokenQuotePair.pair,
                reserve0: { token: rawInfo.pool.v2TokenQuotePair.reserve0.token, reserve: rawInfo.pool.v2TokenQuotePair.reserve0.reserve },
                reserve1: { token: rawInfo.pool.v2TokenQuotePair.reserve1.token, reserve: rawInfo.pool.v2TokenQuotePair.reserve1.reserve },
            },
            v2WbnbQuotePair: {
                pair: rawInfo.pool.v2WbnbQuotePair.pair,
                reserve0: { token: rawInfo.pool.v2WbnbQuotePair.reserve0.token, reserve: rawInfo.pool.v2WbnbQuotePair.reserve0.reserve },
                reserve1: { token: rawInfo.pool.v2WbnbQuotePair.reserve1.token, reserve: rawInfo.pool.v2WbnbQuotePair.reserve1.reserve },
            },
        },
    } as FourmemeTokenInfo;
    const dec = aggIface.decodeFunctionResult('trySellPercentageToBNB', rSell.returnData);
    const estimatedBNB: ethers.BigNumber = dec[0];
    const sellAmount: ethers.BigNumber = dec[1];
    const decimals = Number(info.basicInfo.decimals || 18);
    const tokenAmtFloat = parseFloat(ethers.utils.formatUnits(sellAmount, decimals));
    const bnbFloat = parseFloat(ethers.utils.formatEther(estimatedBNB));
    const pricePerToken = tokenAmtFloat > 0 ? bnbFloat / tokenAmtFloat : 0;
    const allowance = rAllow?.success ? ethers.BigNumber.from(rAllow.returnData) : ethers.constants.Zero;
    const bnbUsdPrice: ethers.BigNumber = rBnbUsd?.success ? (oracleIface.decodeFunctionResult('getBNBUsdPrice', rBnbUsd.returnData)[0] as ethers.BigNumber) : ethers.constants.Zero;
    const tokenUsdPrice: ethers.BigNumber = rTokenUsd?.success ? (oracleIface.decodeFunctionResult('getTokenUsdPrice', rTokenUsd.returnData)[0] as ethers.BigNumber) : ethers.constants.Zero;
    const bnbBalance: ethers.BigNumber = rBnbBal?.success ? ethers.BigNumber.from(rBnbBal.returnData) : ethers.constants.Zero;
    const tokenBalance: ethers.BigNumber = rTokenBal?.success ? ethers.BigNumber.from(rTokenBal.returnData) : ethers.constants.Zero;
    return { info, tokenAmount: sellAmount, bnbAmount: estimatedBNB, pricePerToken, allowance, bnbUsdPrice, tokenUsdPrice, bnbBalance, tokenBalance };
}
export async function prepareSellDualPercentageMulticall(provider: ethers.providers.Provider, token: string, owner: string, percent: number): Promise<{
    info: FourmemeTokenInfo;
    tokenAmount: ethers.BigNumber;
    bnbAmount: ethers.BigNumber;
    pricePerToken: number;
    allowanceFourmeme: ethers.BigNumber;
    allowanceRouter: ethers.BigNumber;
}> {
    const aggIface = new ethers.utils.Interface(AGGREGATOR5_ABI);
    const ercIface = new ethers.utils.Interface(ERC20_ABI as any);
    const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI as any, provider);
    const calls = [
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'getFourmemeTokenInfo', [token], true),
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'trySellPercentageToBNB', [token, owner, ethers.BigNumber.from(percent)], true),
        packCall(ercIface, token, 'allowance', [owner, FOURMEME_CONTRACT], true),
        packCall(ercIface, token, 'allowance', [owner, PANCAKE_V2_ROUTER], true),
    ];
    const results = await (mc.callStatic as any).aggregate3(calls);
    const rInfo = results[0];
    const rSell = results[1];
    const rAllowInternal = results[2];
    const rAllowRouter = results[3];
    if (!rInfo?.success)
throw new Error('获取代币信息失败（getFourmemeTokenInfo）');
    if (!rSell?.success)
throw new Error('按百分比卖出到 BNB 失败（trySellPercentageToBNB）');
    const [rawInfo] = aggIface.decodeFunctionResult('getFourmemeTokenInfo', rInfo.returnData);
    const info = {
        basicInfo: {
            name: rawInfo.basic.name,
            symbol: rawInfo.basic.symbol,
            decimals: Number(rawInfo.basic.decimals),
            totalSupply: rawInfo.basic.totalSupply,
            isFourMemeToken: Boolean(rawInfo.basic.isFourMemeToken),
        },
        platformInfo: {
            version: rawInfo.platform.version,
            tokenManager: rawInfo.platform.tokenManager,
            quote: rawInfo.platform.quote,
            lastPrice: rawInfo.platform.lastPrice,
            usdPrice: rawInfo.platform.usdPrice,
            tradingFeeRate: rawInfo.platform.tradingFeeRate,
            minTradingFee: rawInfo.platform.minTradingFee,
            launchTime: rawInfo.platform.launchTime,
            tradingStatus: Number(rawInfo.platform.tradingStatus),
        },
        tradingInfo: {
            offers: rawInfo.trading.offers,
            maxOffers: rawInfo.trading.maxOffers,
            funds: rawInfo.trading.funds,
            maxFunds: rawInfo.trading.maxFunds,
            liquidityAdded: Boolean(rawInfo.trading.liquidityAdded),
            offerPercentage: rawInfo.trading.offerPercentage,
            fundsPercentage: rawInfo.trading.fundsPercentage,
        },
        poolInfo: {
            quoteName: rawInfo.pool.quoteName,
            quoteSymbol: rawInfo.pool.quoteSymbol,
            quoteDecimals: Number(rawInfo.pool.quoteDecimals),
            poolTokenBalance: rawInfo.pool.poolTokenBalance,
            poolQuoteBalance: rawInfo.pool.poolQuoteBalance,
            isXMode: Boolean(rawInfo.pool.isXMode),
            template: rawInfo.pool.template,
            v2TokenQuotePair: {
                pair: rawInfo.pool.v2TokenQuotePair.pair,
                reserve0: { token: rawInfo.pool.v2TokenQuotePair.reserve0.token, reserve: rawInfo.pool.v2TokenQuotePair.reserve0.reserve },
                reserve1: { token: rawInfo.pool.v2TokenQuotePair.reserve1.token, reserve: rawInfo.pool.v2TokenQuotePair.reserve1.reserve },
            },
            v2WbnbQuotePair: {
                pair: rawInfo.pool.v2WbnbQuotePair.pair,
                reserve0: { token: rawInfo.pool.v2WbnbQuotePair.reserve0.token, reserve: rawInfo.pool.v2WbnbQuotePair.reserve0.reserve },
                reserve1: { token: rawInfo.pool.v2WbnbQuotePair.reserve1.token, reserve: rawInfo.pool.v2WbnbQuotePair.reserve1.reserve },
            },
        },
    } as FourmemeTokenInfo;
    const dec = aggIface.decodeFunctionResult('trySellPercentageToBNB', rSell.returnData);
    const estimatedBNB: ethers.BigNumber = dec[0];
    const sellAmount: ethers.BigNumber = dec[1];
    const decimals = Number(info.basicInfo.decimals || 18);
    const tokenAmtFloat = parseFloat(ethers.utils.formatUnits(sellAmount, decimals));
    const bnbFloat = parseFloat(ethers.utils.formatEther(estimatedBNB));
    const pricePerToken = tokenAmtFloat > 0 ? bnbFloat / tokenAmtFloat : 0;
    const allowanceFourmeme = rAllowInternal?.success ? ethers.BigNumber.from(rAllowInternal.returnData) : ethers.constants.Zero;
    const allowanceRouter = rAllowRouter?.success ? ethers.BigNumber.from(rAllowRouter.returnData) : ethers.constants.Zero;
    return { info, tokenAmount: sellAmount, bnbAmount: estimatedBNB, pricePerToken, allowanceFourmeme, allowanceRouter };
}
export async function prepareBuyExternalMulticall(provider: ethers.providers.Provider, token: string, bnbIn: ethers.BigNumber, slippagePercent: number = 0): Promise<{
    info: FourmemeTokenInfo;
    tokenAmount: ethers.BigNumber;
    minTokenAmount: ethers.BigNumber;
    pricePerToken: number;
}> {
    const aggIface = new ethers.utils.Interface(AGGREGATOR5_ABI);
    const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI as any, provider);
    const calls = [
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'getFourmemeTokenInfo', [token], true),
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'tryBuyWithBNB', [token, bnbIn], true),
    ];
    const results = await (mc.callStatic as any).aggregate3(calls);
    const rInfo = results[0];
    const rBuy = results[1];
    if (!rInfo?.success)
throw new Error('获取代币信息失败（getFourmemeTokenInfo）');
    const [rawInfo] = aggIface.decodeFunctionResult('getFourmemeTokenInfo', rInfo.returnData);
    const info = {
        basicInfo: {
            name: rawInfo.basic.name,
            symbol: rawInfo.basic.symbol,
            decimals: Number(rawInfo.basic.decimals),
            totalSupply: rawInfo.basic.totalSupply,
            isFourMemeToken: Boolean(rawInfo.basic.isFourMemeToken),
        },
        platformInfo: {
            version: rawInfo.platform.version,
            tokenManager: rawInfo.platform.tokenManager,
            quote: rawInfo.platform.quote,
            lastPrice: rawInfo.platform.lastPrice,
            usdPrice: rawInfo.platform.usdPrice,
            tradingFeeRate: rawInfo.platform.tradingFeeRate,
            minTradingFee: rawInfo.platform.minTradingFee,
            launchTime: rawInfo.platform.launchTime,
            tradingStatus: Number(rawInfo.platform.tradingStatus),
        },
        tradingInfo: {
            offers: rawInfo.trading.offers,
            maxOffers: rawInfo.trading.maxOffers,
            funds: rawInfo.trading.funds,
            maxFunds: rawInfo.trading.maxFunds,
            liquidityAdded: Boolean(rawInfo.trading.liquidityAdded),
            offerPercentage: rawInfo.trading.offerPercentage,
            fundsPercentage: rawInfo.trading.fundsPercentage,
        },
        poolInfo: {
            quoteName: rawInfo.pool.quoteName,
            quoteSymbol: rawInfo.pool.quoteSymbol,
            quoteDecimals: Number(rawInfo.pool.quoteDecimals),
            poolTokenBalance: rawInfo.pool.poolTokenBalance,
            poolQuoteBalance: rawInfo.pool.poolQuoteBalance,
            isXMode: Boolean(rawInfo.pool.isXMode),
            template: rawInfo.pool.template,
            v2TokenQuotePair: {
                pair: rawInfo.pool.v2TokenQuotePair.pair,
                reserve0: { token: rawInfo.pool.v2TokenQuotePair.reserve0.token, reserve: rawInfo.pool.v2TokenQuotePair.reserve0.reserve },
                reserve1: { token: rawInfo.pool.v2TokenQuotePair.reserve1.token, reserve: rawInfo.pool.v2TokenQuotePair.reserve1.reserve },
            },
            v2WbnbQuotePair: {
                pair: rawInfo.pool.v2WbnbQuotePair.pair,
                reserve0: { token: rawInfo.pool.v2WbnbQuotePair.reserve0.token, reserve: rawInfo.pool.v2WbnbQuotePair.reserve0.reserve },
                reserve1: { token: rawInfo.pool.v2WbnbQuotePair.reserve1.token, reserve: rawInfo.pool.v2WbnbQuotePair.reserve1.reserve },
            },
        },
    } as FourmemeTokenInfo;
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
    return { info, tokenAmount: estimatedAmount, minTokenAmount, pricePerToken };
}
export async function prepareSellExternalWithAllowanceMulticall(provider: ethers.providers.Provider, token: string, owner: string, tokenAmount: ethers.BigNumber): Promise<{
    info: FourmemeTokenInfo;
    bnbAmount: ethers.BigNumber;
    pricePerToken: number;
    allowance: ethers.BigNumber;
}> {
    const aggIface = new ethers.utils.Interface(AGGREGATOR5_ABI);
    const ercIface = new ethers.utils.Interface(ERC20_ABI as any);
    const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI as any, provider);
    const calls = [
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'getFourmemeTokenInfo', [token], true),
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'trySellToBNB', [token, tokenAmount], true),
        packCall(ercIface, token, 'allowance', [owner, PANCAKE_V2_ROUTER], true),
    ];
    const results = await (mc.callStatic as any).aggregate3(calls);
    const rInfo = results[0];
    const rSell = results[1];
    const rAllow = results[2];
    if (!rInfo?.success)
throw new Error('获取代币信息失败（getFourmemeTokenInfo）');
    if (!rSell?.success)
throw new Error('卖出到 BNB 失败（trySellToBNB）');
    const [rawInfo] = aggIface.decodeFunctionResult('getFourmemeTokenInfo', rInfo.returnData);
    const info = {
        basicInfo: {
            name: rawInfo.basic.name,
            symbol: rawInfo.basic.symbol,
            decimals: Number(rawInfo.basic.decimals),
            totalSupply: rawInfo.basic.totalSupply,
            isFourMemeToken: Boolean(rawInfo.basic.isFourMemeToken),
        },
        platformInfo: {
            version: rawInfo.platform.version,
            tokenManager: rawInfo.platform.tokenManager,
            quote: rawInfo.platform.quote,
            lastPrice: rawInfo.platform.lastPrice,
            usdPrice: rawInfo.platform.usdPrice,
            tradingFeeRate: rawInfo.platform.tradingFeeRate,
            minTradingFee: rawInfo.platform.minTradingFee,
            launchTime: rawInfo.platform.launchTime,
            tradingStatus: Number(rawInfo.platform.tradingStatus),
        },
        tradingInfo: {
            offers: rawInfo.trading.offers,
            maxOffers: rawInfo.trading.maxOffers,
            funds: rawInfo.trading.funds,
            maxFunds: rawInfo.trading.maxFunds,
            liquidityAdded: Boolean(rawInfo.trading.liquidityAdded),
            offerPercentage: rawInfo.trading.offerPercentage,
            fundsPercentage: rawInfo.trading.fundsPercentage,
        },
        poolInfo: {
            quoteName: rawInfo.pool.quoteName,
            quoteSymbol: rawInfo.pool.quoteSymbol,
            quoteDecimals: Number(rawInfo.pool.quoteDecimals),
            poolTokenBalance: rawInfo.pool.poolTokenBalance,
            poolQuoteBalance: rawInfo.pool.poolQuoteBalance,
            isXMode: Boolean(rawInfo.pool.isXMode),
            template: rawInfo.pool.template,
            v2TokenQuotePair: {
                pair: rawInfo.pool.v2TokenQuotePair.pair,
                reserve0: { token: rawInfo.pool.v2TokenQuotePair.reserve0.token, reserve: rawInfo.pool.v2TokenQuotePair.reserve0.reserve },
                reserve1: { token: rawInfo.pool.v2TokenQuotePair.reserve1.token, reserve: rawInfo.pool.v2TokenQuotePair.reserve1.reserve },
            },
            v2WbnbQuotePair: {
                pair: rawInfo.pool.v2WbnbQuotePair.pair,
                reserve0: { token: rawInfo.pool.v2WbnbQuotePair.reserve0.token, reserve: rawInfo.pool.v2WbnbQuotePair.reserve0.reserve },
                reserve1: { token: rawInfo.pool.v2WbnbQuotePair.reserve1.token, reserve: rawInfo.pool.v2WbnbQuotePair.reserve1.reserve },
            },
        },
    } as FourmemeTokenInfo;
    const dec = aggIface.decodeFunctionResult('trySellToBNB', rSell.returnData);
    const estimatedBNB: ethers.BigNumber = dec[0];
    const decimals = Number(info.basicInfo.decimals || 18);
    const tokenAmtFloat = parseFloat(ethers.utils.formatUnits(tokenAmount, decimals));
    const bnbFloat = parseFloat(ethers.utils.formatEther(estimatedBNB));
    const pricePerToken = tokenAmtFloat > 0 ? bnbFloat / tokenAmtFloat : 0;
    const allowance = rAllow?.success ? ethers.BigNumber.from(rAllow.returnData) : ethers.constants.Zero;
    return { info, bnbAmount: estimatedBNB, pricePerToken, allowance };
}
export async function prepareSellExternalPercentageWithAllowanceMulticall(provider: ethers.providers.Provider, token: string, owner: string, percent: number): Promise<{
    info: FourmemeTokenInfo;
    tokenAmount: ethers.BigNumber;
    bnbAmount: ethers.BigNumber;
    pricePerToken: number;
    allowance: ethers.BigNumber;
}> {
    const aggIface = new ethers.utils.Interface(AGGREGATOR5_ABI);
    const ercIface = new ethers.utils.Interface(ERC20_ABI as any);
    const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI as any, provider);
    const calls = [
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'getFourmemeTokenInfo', [token], true),
        packCall(aggIface, AGGREGATOR5_CONTRACT, 'trySellPercentageToBNB', [token, owner, ethers.BigNumber.from(percent)], true),
        packCall(ercIface, token, 'allowance', [owner, PANCAKE_V2_ROUTER], true),
    ];
    const results = await (mc.callStatic as any).aggregate3(calls);
    const rInfo = results[0];
    const rSell = results[1];
    const rAllow = results[2];
    if (!rInfo?.success)
throw new Error('获取代币信息失败（getFourmemeTokenInfo）');
    if (!rSell?.success)
throw new Error('按百分比卖出到 BNB 失败（trySellPercentageToBNB）');
    const [rawInfo] = aggIface.decodeFunctionResult('getFourmemeTokenInfo', rInfo.returnData);
    const info = {
        basicInfo: {
            name: rawInfo.basic.name,
            symbol: rawInfo.basic.symbol,
            decimals: Number(rawInfo.basic.decimals),
            totalSupply: rawInfo.basic.totalSupply,
            isFourMemeToken: Boolean(rawInfo.basic.isFourMemeToken),
        },
        platformInfo: {
            version: rawInfo.platform.version,
            tokenManager: rawInfo.platform.tokenManager,
            quote: rawInfo.platform.quote,
            lastPrice: rawInfo.platform.lastPrice,
            usdPrice: rawInfo.platform.usdPrice,
            tradingFeeRate: rawInfo.platform.tradingFeeRate,
            minTradingFee: rawInfo.platform.minTradingFee,
            launchTime: rawInfo.platform.launchTime,
            tradingStatus: Number(rawInfo.platform.tradingStatus),
        },
        tradingInfo: {
            offers: rawInfo.trading.offers,
            maxOffers: rawInfo.trading.maxOffers,
            funds: rawInfo.trading.funds,
            maxFunds: rawInfo.trading.maxFunds,
            liquidityAdded: Boolean(rawInfo.trading.liquidityAdded),
            offerPercentage: rawInfo.trading.offerPercentage,
            fundsPercentage: rawInfo.trading.fundsPercentage,
        },
        poolInfo: {
            quoteName: rawInfo.pool.quoteName,
            quoteSymbol: rawInfo.pool.quoteSymbol,
            quoteDecimals: Number(rawInfo.pool.quoteDecimals),
            poolTokenBalance: rawInfo.pool.poolTokenBalance,
            poolQuoteBalance: rawInfo.pool.poolQuoteBalance,
            isXMode: Boolean(rawInfo.pool.isXMode),
            template: rawInfo.pool.template,
            v2TokenQuotePair: {
                pair: rawInfo.pool.v2TokenQuotePair.pair,
                reserve0: { token: rawInfo.pool.v2TokenQuotePair.reserve0.token, reserve: rawInfo.pool.v2TokenQuotePair.reserve0.reserve },
                reserve1: { token: rawInfo.pool.v2TokenQuotePair.reserve1.token, reserve: rawInfo.pool.v2TokenQuotePair.reserve1.reserve },
            },
            v2WbnbQuotePair: {
                pair: rawInfo.pool.v2WbnbQuotePair.pair,
                reserve0: { token: rawInfo.pool.v2WbnbQuotePair.reserve0.token, reserve: rawInfo.pool.v2WbnbQuotePair.reserve0.reserve },
                reserve1: { token: rawInfo.pool.v2WbnbQuotePair.reserve1.token, reserve: rawInfo.pool.v2WbnbQuotePair.reserve1.reserve },
            },
        },
    } as FourmemeTokenInfo;
    const dec = aggIface.decodeFunctionResult('trySellPercentageToBNB', rSell.returnData);
    const estimatedBNB: ethers.BigNumber = dec[0];
    const sellAmount: ethers.BigNumber = dec[1];
    const decimals = Number(info.basicInfo.decimals || 18);
    const tokenAmtFloat = parseFloat(ethers.utils.formatUnits(sellAmount, decimals));
    const bnbFloat = parseFloat(ethers.utils.formatEther(estimatedBNB));
    const pricePerToken = tokenAmtFloat > 0 ? bnbFloat / tokenAmtFloat : 0;
    const allowance = rAllow?.success ? ethers.BigNumber.from(rAllow.returnData) : ethers.constants.Zero;
    return { info, tokenAmount: sellAmount, bnbAmount: estimatedBNB, pricePerToken, allowance };
}
