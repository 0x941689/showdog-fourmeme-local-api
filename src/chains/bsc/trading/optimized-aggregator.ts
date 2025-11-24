import { ethers } from 'ethers';
import { BigNumber } from '@ethersproject/bignumber';
import { AGGREGATOR_ABI, AGGREGATOR_CONTRACT } from './abi';
import { Address } from './types';
export interface BasicInfo {
    name: string;
    symbol: string;
    decimals: number;
    totalSupply: BigNumber;
    isFourMemeToken: boolean;
}
export interface PlatformInfo {
    version: BigNumber;
    tokenManager: string;
    quote: string;
    lastPrice: BigNumber;
    usdPrice: BigNumber;
    tradingFeeRate: BigNumber;
    minTradingFee: BigNumber;
    launchTime: BigNumber;
    tradingStatus: number;
}
export interface TradingInfo {
    offers: BigNumber;
    maxOffers: BigNumber;
    funds: BigNumber;
    maxFunds: BigNumber;
    liquidityAdded: boolean;
    offerPercentage: BigNumber;
    fundsPercentage: BigNumber;
}
export interface PoolInfo {
    quoteName: string;
    quoteSymbol: string;
    quoteDecimals: number;
    poolTokenBalance: BigNumber;
    poolQuoteBalance: BigNumber;
    isXMode: boolean;
    template: BigNumber;
    v2TokenQuotePair: {
        pair: string;
        reserve0: {
            token: string;
            reserve: BigNumber;
        };
        reserve1: {
            token: string;
            reserve: BigNumber;
        };
    };
    v2WbnbQuotePair: {
        pair: string;
        reserve0: {
            token: string;
            reserve: BigNumber;
        };
        reserve1: {
            token: string;
            reserve: BigNumber;
        };
    };
}
export interface FourmemeTokenInfo {
    basicInfo: BasicInfo;
    platformInfo: PlatformInfo;
    tradingInfo: TradingInfo;
    poolInfo: PoolInfo;
}
export interface SimpleTokenInfo {
    name: string;
    symbol: string;
    totalSupply: BigNumber;
    isGraduated: boolean;
}
export class OptimizedTokenInfoAggregator {
    private contract: ethers.Contract;
    constructor(provider: any) {
        this.contract = new ethers.Contract(AGGREGATOR_CONTRACT, AGGREGATOR_ABI, provider);
    }
    async getFourmemeTokenInfo(token: Address): Promise<FourmemeTokenInfo> {
        const r = await this.contract.callStatic.getFourmemeTokenInfo(token);
        return {
            basicInfo: {
                name: r.basic.name,
                symbol: r.basic.symbol,
                decimals: Number(r.basic.decimals),
                totalSupply: r.basic.totalSupply,
                isFourMemeToken: Boolean(r.basic.isFourMemeToken),
            },
            platformInfo: {
                version: r.platform.version,
                tokenManager: r.platform.tokenManager,
                quote: r.platform.quote,
                lastPrice: r.platform.lastPrice,
                usdPrice: r.platform.usdPrice,
                tradingFeeRate: r.platform.tradingFeeRate,
                minTradingFee: r.platform.minTradingFee,
                launchTime: r.platform.launchTime,
                tradingStatus: Number(r.platform.tradingStatus),
            },
            tradingInfo: {
                offers: r.trading.offers,
                maxOffers: r.trading.maxOffers,
                funds: r.trading.funds,
                maxFunds: r.trading.maxFunds,
                liquidityAdded: Boolean(r.trading.liquidityAdded),
                offerPercentage: r.trading.offerPercentage,
                fundsPercentage: r.trading.fundsPercentage,
            },
            poolInfo: {
                quoteName: r.pool.quoteName,
                quoteSymbol: r.pool.quoteSymbol,
                quoteDecimals: Number(r.pool.quoteDecimals),
                poolTokenBalance: r.pool.poolTokenBalance,
                poolQuoteBalance: r.pool.poolQuoteBalance,
                isXMode: Boolean(r.pool.isXMode),
                template: r.pool.template,
                v2TokenQuotePair: {
                    pair: r.pool.v2TokenQuotePair.pair,
                    reserve0: { token: r.pool.v2TokenQuotePair.reserve0.token, reserve: r.pool.v2TokenQuotePair.reserve0.reserve },
                    reserve1: { token: r.pool.v2TokenQuotePair.reserve1.token, reserve: r.pool.v2TokenQuotePair.reserve1.reserve },
                },
                v2WbnbQuotePair: {
                    pair: r.pool.v2WbnbQuotePair.pair,
                    reserve0: { token: r.pool.v2WbnbQuotePair.reserve0.token, reserve: r.pool.v2WbnbQuotePair.reserve0.reserve },
                    reserve1: { token: r.pool.v2WbnbQuotePair.reserve1.token, reserve: r.pool.v2WbnbQuotePair.reserve1.reserve },
                },
            },
        };
    }
    async getTokenInfo(token: Address): Promise<SimpleTokenInfo> {
        const info = await this.getFourmemeTokenInfo(token);
        return {
            name: info.basicInfo.name,
            symbol: info.basicInfo.symbol,
            totalSupply: info.basicInfo.totalSupply,
            isGraduated: info.platformInfo.tradingStatus === 2,
        };
    }
}
