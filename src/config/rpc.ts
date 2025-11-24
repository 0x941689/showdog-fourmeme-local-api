export type HttpWs = {
    https?: string;
    wss?: string;
};
export const EVM_RPC: Record<string, HttpWs> = {
    bsc: {
        https: 'https://bsc-rpc.publicnode.com',
        wss: 'wss://bsc-rpc.publicnode.com'
    },
};
export function pickRpcUrl(cfg: HttpWs): {
    url: string;
    isWs: boolean;
} {
    const hasWss = !!cfg.wss && cfg.wss.trim().length > 0;
    const hasHttps = !!cfg.https && cfg.https.trim().length > 0;
    if (hasWss)
        return { url: cfg.wss!.trim(), isWs: true };
    if (hasHttps)
        return { url: cfg.https!.trim(), isWs: false };
    throw new Error('RPC 配置缺失：必须至少提供 wss 或 https 地址');
}
