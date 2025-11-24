export const contracts = {
    bsc: {
        fourmeme: "0x5c952063c7fc8610FFDB798152D69F0B9550762b",
        wbnb: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
        multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
        aggregator5: "0x874d199077eEb08AF9B22c2fD5d9e6f041216877",
        pancakeV2Router: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
        priceOracle: "0x66163B19Dfe075D7B90601B9bA1d86183C7fAe82",
        tokenManagerHelper3: "0xF251F83e40a78868FcfA3FA4599Dad6494E46034",
    },
    eth: {},
    base: {},
    tron: {},
    solana: {},
} as const;
export type ChainKey = keyof typeof contracts;
export type ContractNames<K extends ChainKey> = keyof typeof contracts[K];
