import { ethers } from 'ethers';
import { quoteInternalBuyMulticall, quoteSellMulticall, quoteSellPercentageMulticall } from '../multicall3';
import { FourmemeTokenInfo } from '../trading/optimized-aggregator';
export async function quoteInternalBuy(provider: ethers.providers.Provider, tokenAddress: string, bnbIn: ethers.BigNumber, slippagePercent: number = 0, owner?: string): Promise<{
    info: FourmemeTokenInfo;
    tokenAmount: ethers.BigNumber;
    minTokenAmount: ethers.BigNumber;
    pricePerToken: number;
    bnbUsdPrice: ethers.BigNumber;
    tokenUsdPrice: ethers.BigNumber;
    bnbBalance?: ethers.BigNumber;
    tokenBalance?: ethers.BigNumber;
}> {
    const r = await quoteInternalBuyMulticall(provider, tokenAddress, bnbIn, slippagePercent, owner);
    return r;
}
export const quoteBuy = quoteInternalBuy;
export async function quoteSell(provider: ethers.providers.Provider, tokenAddress: string, tokenAmount: ethers.BigNumber, owner?: string): Promise<{
    info: FourmemeTokenInfo;
    bnbAmount: ethers.BigNumber;
    pricePerToken: number;
    bnbUsdPrice: ethers.BigNumber;
    tokenUsdPrice: ethers.BigNumber;
    bnbBalance?: ethers.BigNumber;
    tokenBalance?: ethers.BigNumber;
}> {
    const r = await quoteSellMulticall(provider, tokenAddress, tokenAmount, owner);
    return r;
}
export async function quoteSellPercentage(provider: ethers.providers.Provider, tokenAddress: string, owner: string, percent: number): Promise<{
    info: FourmemeTokenInfo;
    tokenAmount: ethers.BigNumber;
    bnbAmount: ethers.BigNumber;
    pricePerToken: number;
    bnbUsdPrice: ethers.BigNumber;
    tokenUsdPrice: ethers.BigNumber;
    bnbBalance?: ethers.BigNumber;
    tokenBalance?: ethers.BigNumber;
}> {
    const r = await quoteSellPercentageMulticall(provider, tokenAddress, owner, percent);
    return r;
}
