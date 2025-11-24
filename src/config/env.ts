import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import * as path from 'path';
dotenv.config();
export type WalletItem = {
    id: number;
    name?: string;
    privateKey: string;
};
export type WalletsEnvConfig = {
    wallets: WalletItem[];
};
function tryReadMultilineJsonFromDotenv(key: string): any | null {
    try {
        const dotenvPath = path.resolve(process.cwd(), '.env');
        const content = readFileSync(dotenvPath, 'utf8');
        const lines = content.split(/\r?\n/);
        let startIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const idx = line.indexOf('=');
            if (idx > -1) {
                const k = line.slice(0, idx).trim();
                if (k === key) { startIdx = i; break; }
            }
        }
        if (startIdx === -1) return null;
        const firstLine = lines[startIdx];
        const eqIdx = firstLine.indexOf('=');
        const firstValue = firstLine.slice(eqIdx + 1);
        let buffer = firstValue + '\n';
        let closed = /\]/.test(firstValue);
        for (let i = startIdx + 1; i < lines.length && !closed; i++) {
            buffer += lines[i] + '\n';
            if (/\]/.test(lines[i])) closed = true;
        }
        const clean = buffer
            .split(/\r?\n/)
            .map(l => l.replace(/^\s*#.*$/, ''))
            .join('\n')
            .trim();
        if (!clean) return null;
        return JSON.parse(clean);
    } catch {
        return null;
    }
}
export function loadWalletsFromEnv(): WalletsEnvConfig {
    const rawEnv = process.env.EVM_WALLETS ?? process.env.EVM_WALLETS_JSON;
    if (!rawEnv || String(rawEnv).trim().length === 0) {
        const arrFromFile = tryReadMultilineJsonFromDotenv('EVM_WALLETS')
            ?? tryReadMultilineJsonFromDotenv('EVM_WALLETS_JSON');
        if (!arrFromFile)
            throw new Error('缺少必填环境变量：EVM_WALLETS 或 EVM_WALLETS_JSON');
        const wallets: WalletItem[] = (Array.isArray(arrFromFile) ? arrFromFile : []).map((it: any, idx: number) => {
            const id = Number(it?.id);
            const pk = String(it?.privateKey || '').trim();
            const name = it?.name ? String(it.name).trim() : undefined;
            if (!Number.isFinite(id)) {
                throw new Error(`EVM_WALLETS[${idx}].id 无效：必须为数字`);
            }
            if (!pk || !pk.startsWith('0x')) {
                throw new Error(`EVM_WALLETS[${idx}].privateKey 无效：必须为以 0x 开头的私钥`);
            }
            return { id, name, privateKey: pk } as WalletItem;
        });
        if (!Array.isArray(wallets) || wallets.length === 0) {
            throw new Error('钱包配置必须为非空数组（EVM_WALLETS/EVM_WALLETS_JSON），如 [ {"id":1,"privateKey":"0x..."} ]');
        }
        const ids = new Set<number>();
        for (const w of wallets) {
            if (ids.has(w.id))
                throw new Error(`EVM_WALLETS 中存在重复 id：${w.id}`);
            ids.add(w.id);
        }
        return { wallets };
    }
    const rawJson = String(rawEnv).trim();
    let arr: any;
    try {
        arr = JSON.parse(rawJson);
    }
    catch (e: any) {
        const arrFromFile = tryReadMultilineJsonFromDotenv('EVM_WALLETS')
            ?? tryReadMultilineJsonFromDotenv('EVM_WALLETS_JSON');
        if (!arrFromFile)
            throw new Error(`钱包配置解析失败（EVM_WALLETS/EVM_WALLETS_JSON）：必须为合法 JSON 数组；错误：${e?.message || String(e)}`);
        arr = arrFromFile;
    }
    if (!Array.isArray(arr) || arr.length === 0) {
        throw new Error('钱包配置必须为非空数组（EVM_WALLETS/EVM_WALLETS_JSON），如 [{"id":1,"privateKey":"0x..."}]');
    }
    const wallets: WalletItem[] = arr.map((it: any, idx: number) => {
        const id = Number(it?.id);
        const pk = String(it?.privateKey || '').trim();
        const name = it?.name ? String(it.name).trim() : undefined;
        if (!Number.isFinite(id)) {
            throw new Error(`EVM_WALLETS[${idx}].id 无效：必须为数字`);
        }
        if (!pk || !pk.startsWith('0x')) {
            throw new Error(`EVM_WALLETS[${idx}].privateKey 无效：必须为以 0x 开头的私钥`);
        }
        return { id, name, privateKey: pk } as WalletItem;
    });
    const ids = new Set<number>();
    for (const w of wallets) {
        if (ids.has(w.id))
            throw new Error(`EVM_WALLETS 中存在重复 id：${w.id}`);
        ids.add(w.id);
    }
    return { wallets };
}
