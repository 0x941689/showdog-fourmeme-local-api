import { BigNumber } from '@ethersproject/bignumber';
export type Address = string;
export type TxOverrides = {
    gasPrice?: BigNumber;
    gasLimit?: BigNumber;
    nonce?: number;
};
export interface TokenInfo {
    base: Address;
    quote: Address;
    template: BigNumber;
    total_supply: BigNumber;
    max_offers: BigNumber;
    max_raising: BigNumber;
    launch_time: BigNumber;
    offers: BigNumber;
    funds: BigNumber;
    last_price: BigNumber;
    k: BigNumber;
    t: BigNumber;
    status: BigNumber;
}
export type TradeType = 'Buy' | 'Sell';
export interface BuyParams {
    token: Address;
    amount?: BigNumber;
    funds?: BigNumber;
    to?: Address;
    min_amount?: BigNumber;
    max_funds?: BigNumber;
}
export interface SellParams {
    token: Address;
    amount: BigNumber;
    min_funds?: BigNumber;
}
export interface BuyTokenParams {
    origin: BigNumber;
    token: Address;
    to: Address;
    amount: BigNumber;
    maxFunds: BigNumber;
    funds: BigNumber;
    minAmount: BigNumber;
}
export interface XModeBuyParams {
    token: Address;
    to?: Address;
    amount?: BigNumber;
    funds?: BigNumber;
    maxFunds?: BigNumber;
    minAmount?: BigNumber;
}
export interface TradeResult {
    tx_hash: string;
    trade_type: TradeType;
    token: Address;
    amount: BigNumber;
    cost: BigNumber;
    price: number;
}
export interface PriceInfo {
    token_amount: BigNumber;
    bnb_cost: BigNumber;
    price_per_token: number;
    fee: BigNumber;
}
export function isTradable(info: TokenInfo): boolean {
    return info.status.eq(0);
}
export function isGraduated(info: TokenInfo): boolean {
    return info.status.eq(2);
}
export function currentPrice(info: TokenInfo): number {
    return Number(info.last_price.toString()) / 1e18;
}
export function liquidity(info: TokenInfo): number {
    return Number(info.funds.toString()) / 1e18;
}
export function reserves(info: TokenInfo): number {
    return Number(info.offers.toString()) / 1e18;
}
export interface PoolInfo {
    poolAddress: Address;
    isV3: boolean;
    fee: number;
    reserveA: BigNumber;
    reserveB: BigNumber;
    totalLiquidity: BigNumber;
}
export interface AggregatedTokenInfo {
    nameA: string;
    symbolA: string;
    nameB: string;
    symbolB: string;
    decimalsA: number;
    decimalsB: number;
    totalSupplyA: BigNumber;
    totalSupplyB: BigNumber;
    isFourMemeToken: boolean;
    tradingStatus: number;
    offerPercentage: BigNumber;
    fundsPercentage: BigNumber;
    offers: BigNumber;
    maxOffers: BigNumber;
    funds: BigNumber;
    maxFunds: BigNumber;
    liquidityPools: PoolInfo[];
}
export function isInternalTradingAvailable(info: AggregatedTokenInfo): boolean {
    return info.isFourMemeToken && info.tradingStatus === 0;
}
export function isGraduatedFromAggregated(info: AggregatedTokenInfo): boolean {
    return info.tradingStatus === 2;
}
export function currentPriceFromAggregated(info: AggregatedTokenInfo): number {
    if (info.offers.isZero() || info.funds.isZero()) {
        return 0;
    }
    return Number(info.funds.toString()) / Number(info.offers.toString());
}
export function liquidityFromAggregated(info: AggregatedTokenInfo): number {
    return Number(info.funds.toString()) / 1e18;
}
export function reservesFromAggregated(info: AggregatedTokenInfo): number {
    return Number(info.offers.toString()) / 1e18;
}

export function isXMode(template: BigNumber): boolean {
    return template.and(BigNumber.from(0x10000)).gt(0);
}
export function isXModeFromAggregated(info: AggregatedTokenInfo): boolean {
    return false;
}
