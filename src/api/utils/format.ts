import { ethers } from 'ethers';
export function clampDp(raw: any): number {
    const n = Number(raw);
    if (Number.isNaN(n) || !Number.isFinite(n))
        return 4;
    return Math.max(0, Math.min(18, Math.round(n)));
}
export function getDisplayDp(body: any): number {
    return clampDp((body?.display_dp ?? body?.dp ?? 4));
}
export function trimTrailingZeros(intPart: string, fracPart: string): string {
    return fracPart.replace(/0+$/, '') ? `${intPart}.${fracPart.replace(/0+$/, '')}` : intPart;
}
export function formatBnUnits(bn: ethers.BigNumber, unitDecimals: number, dp: number): string {
    const s = ethers.utils.formatUnits(bn, unitDecimals);
    const [i, f = ''] = s.split('.');
    const frac = f.slice(0, dp);
    return trimTrailingZeros(i, frac);
}
export function formatEtherDp(bn: ethers.BigNumber, dp: number): string {
    return formatBnUnits(bn, 18, dp);
}
export function formatUnitsDp(bn: ethers.BigNumber, decimals: number, dp: number): string {
    return formatBnUnits(bn, decimals, dp);
}
export function formatBnUnitsTrunc(bn: ethers.BigNumber, unitDecimals: number, dp: number): string {
    const s = ethers.utils.formatUnits(bn, unitDecimals);
    const [i, f = ''] = s.split('.');
    const frac = f.slice(0, dp);
    return frac ? `${i}.${frac}` : i;
}
export function formatEtherTruncDp(bn: ethers.BigNumber, dp: number): string {
    return formatBnUnitsTrunc(bn, 18, dp);
}
export function formatUnitsTruncDp(bn: ethers.BigNumber, decimals: number, dp: number): string {
    return formatBnUnitsTrunc(bn, decimals, dp);
}
export function normalizeFormatted(value: string): string {
    if (!value)
        return '0';
    const [i, f = ''] = value.split('.');
    const int = i.replace(/^0+/, '') || '0';
    const frac = f.replace(/0+$/, '');
    return frac ? `${int}.${frac}` : int;
}
export function formatEtherHuman(bn: ethers.BigNumber): string {
    return normalizeFormatted(ethers.utils.formatEther(bn));
}
export function formatUnitsHuman(bn: ethers.BigNumber, decimals: number): string {
    return normalizeFormatted(ethers.utils.formatUnits(bn, decimals));
}
export type MarketCapStyle = 'western' | 'cn';
export function getMarketCapStyle(body: any): MarketCapStyle {
    const raw = String((body?.marketcap_unit ?? '')).trim().toLowerCase();
    return raw === 'cn' ? 'cn' : 'western';
}
export function formatMarketCapWithUnit(marketCap18: ethers.BigNumber, style: MarketCapStyle): string {
    let unit = '';
    let decimalsForFormat = 18;
    const pow10 = (n: number) => ethers.BigNumber.from(10).pow(n);
    if (style === 'western') {
        if (marketCap18.gte(pow10(30))) {
            unit = 'T';
            decimalsForFormat = 30;
        }
        else if (marketCap18.gte(pow10(27))) {
            unit = 'B';
            decimalsForFormat = 27;
        }
        else if (marketCap18.gte(pow10(24))) {
            unit = 'M';
            decimalsForFormat = 24;
        }
        else if (marketCap18.gte(pow10(21))) {
            unit = 'K';
            decimalsForFormat = 21;
        }
    }
    else {
        if (marketCap18.gte(pow10(30))) {
            unit = '万亿';
            decimalsForFormat = 30;
        }
        else if (marketCap18.gte(pow10(26))) {
            unit = '亿';
            decimalsForFormat = 26;
        }
        else if (marketCap18.gte(pow10(22))) {
            unit = '万';
            decimalsForFormat = 22;
        }
    }
    const valueStr = formatUnitsTruncDp(marketCap18, decimalsForFormat, 2);
    return unit ? `$${valueStr}${unit}` : `$${valueStr}`;
}

export const STATUS_NAMES: Record<number, string> = {
    0: '非Four.meme代币',
    1: '内盘交易',
    2: '外盘交易',
};
