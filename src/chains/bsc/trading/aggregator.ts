import { ethers } from 'ethers';
import { BigNumber } from '@ethersproject/bignumber';
import { AGGREGATOR_ABI, AGGREGATOR_CONTRACT } from './abi';
import { AggregatedTokenInfo, PoolInfo, Address } from './types';
export class TokenInfoAggregatorService {
    private contract: ethers.Contract;
    constructor(provider: any) {
        this.contract = new ethers.Contract(AGGREGATOR_CONTRACT, AGGREGATOR_ABI, provider);
    }
    async getAggregatedInfo(token: Address): Promise<AggregatedTokenInfo> {
        try {
            const result = await (this.contract.callStatic as any).getFourmemeTokenInfo(token);
            const basic = result.basic;
            const platform = result.platform;
            const trading = result.trading;
            const pool = result.pool;
            const liquidityPools: PoolInfo[] = [
                {
                    poolAddress: '0x0000000000000000000000000000000000000000',
                    isV3: false,
                    fee: 0,
                    reserveA: pool.poolTokenBalance,
                    reserveB: pool.poolQuoteBalance,
                    totalLiquidity: pool.poolQuoteBalance,
                },
            ];
            return {
                nameA: basic.name,
                symbolA: basic.symbol,
                nameB: pool.quoteName,
                symbolB: pool.quoteSymbol,
                decimalsA: basic.decimals,
                decimalsB: pool.quoteDecimals,
                totalSupplyA: basic.totalSupply,
                totalSupplyB: BigNumber.from(0),
                isFourMemeToken: basic.isFourMemeToken,
                tradingStatus: Number(platform.tradingStatus),
                offerPercentage: trading.offerPercentage,
                fundsPercentage: trading.fundsPercentage,
                offers: trading.offers,
                maxOffers: trading.maxOffers,
                funds: trading.funds,
                maxFunds: trading.maxFunds,
                liquidityPools,
            };
        }
        catch (error) {
            throw new Error(`获取聚合代币信息失败：${error}`);
        }
    }
    async batchGetAggregatedInfo(pairs: [
        Address,
        Address
    ][]): Promise<AggregatedTokenInfo[]> {
        const tokens = pairs.map(([token]) => token);
        const promises = tokens.map((t) => this.getAggregatedInfo(t));
        return Promise.all(promises);
    }
    async isFourMemeToken(token: Address): Promise<boolean> {
        try {
            const info = await this.getAggregatedInfo(token);
            return info.isFourMemeToken;
        }
        catch (error) {
            console.warn('检查 Four.meme 代币状态失败：', error);
            return false;
        }
    }
    async getTradingStatus(token: Address): Promise<{
        isFourMeme: boolean;
        isInternal: boolean;
        isGraduated: boolean;
    }> {
        try {
            const aggregatedInfo = await this.getAggregatedInfo(token);
            return {
                isFourMeme: aggregatedInfo.isFourMemeToken,
                isInternal: aggregatedInfo.tradingStatus === 1,
                isGraduated: aggregatedInfo.tradingStatus === 2,
            };
        }
        catch (error) {
            console.warn('获取交易状态失败：', error);
            return {
                isFourMeme: false,
                isInternal: false,
                isGraduated: false,
            };
        }
    }
}
