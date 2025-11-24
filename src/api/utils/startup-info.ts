import { BRAND_LOGO, formatStartupBanner, StartupStatus } from '../../config/startup-banner';
import { currentRpc, provider } from '../context';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Wallet, utils } from 'ethers';
import { loadWalletsFromEnv } from '../../config/env';

export async function getStartupStatus(port: number, host: string, whitelist: string[]): Promise<StartupStatus> {
    const nodeStatus = await checkNodeStatus();
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    const wallets = await buildWalletInfos();

    return {
        port,
        url: `http://${host}:${port}`,
        whitelistIPs: whitelist,
        nodeStatus,
        environment: process.env.NODE_ENV || 'development',
        version: packageJson.version || '1.0.0',
        buildTime: new Date().toISOString(),
        wallets
    };
}

async function checkNodeStatus(): Promise<{
    connected: boolean;
    latency?: number;
    endpoint?: string;
}> {
    try {
        try {
            await provider.getBlockNumber();
        } catch {}

        let latency: number | undefined;
        try {
            const { wallets } = loadWalletsFromEnv();
            if (wallets && wallets.length > 0) {
                const first = wallets[0];
                const wallet = new Wallet(first.privateKey);
                const address = wallet.address;
                const startTime = Date.now();
                await provider.getBalance(address);
                latency = Date.now() - startTime;
            } else {
                const startTime = Date.now();
                await provider.getBlockNumber();
                latency = Date.now() - startTime;
            }
        } catch {
            return {
                connected: false,
                endpoint: currentRpc.url
            };
        }

        return {
            connected: true,
            latency,
            endpoint: currentRpc.url
        };
    } catch (error) {
        return {
            connected: false,
            endpoint: currentRpc.url
        };
    }
}

async function buildWalletInfos(): Promise<Array<{
    id: number;
    name?: string;
    address: string;
    balance: string;
}>> {
    try {
        const { wallets } = loadWalletsFromEnv();
        const result: Array<{ id: number; name?: string; address: string; balance: string; }> = [];
        for (const w of wallets) {
            try {
                const wallet = new Wallet(w.privateKey);
                const address = wallet.address;
                const balanceWei = await provider.getBalance(address);
                const balanceBNB = parseFloat(utils.formatEther(balanceWei)).toFixed(4);
                result.push({ id: w.id, name: w.name, address, balance: balanceBNB });
            } catch (err) {
                continue;
            }
        }
        return result;
    } catch {
        return [];
    }
}
export async function printStartupBanner(port: number, host: string, whitelist: string[]): Promise<void> {
    try {
        const status = await getStartupStatus(port, host, whitelist);
        const banner = formatStartupBanner(BRAND_LOGO, status);
        console.log(banner);
    } catch (error) {
        console.log(BRAND_LOGO);
        console.log(`\n🚀 服务器启动成功`);
        console.log(`端口: ${port}`);
        console.log(`访问地址: http://${host}:${port}`);
        console.log(`白名单IP: ${whitelist.join(', ') || '无'}`);
    }
}