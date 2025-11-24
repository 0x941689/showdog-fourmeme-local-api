import { IncomingMessage, ServerResponse } from 'http';
import { ethers } from 'ethers';
import { parseJsonBody, parseQueryParams, sendJson, errorResponse } from '../../utils/http';
import { provider } from '../../context';
export async function handleTxStatus(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = req.method === 'GET' ? parseQueryParams(req) : ((req as any)._parsedBody ?? await parseJsonBody(req));
        const hashRaw = (body as any).hash;
        const hash = String(hashRaw || '').trim();
        if (!hash || !hash.startsWith('0x') || hash.length < 66) {
            return sendJson(res, 400, errorResponse('INVALID_HASH', '无效交易哈希', { endpoint: 'tx/status', hash: hashRaw }));
        }
        const receipt = await provider.getTransactionReceipt(hash);
        if (receipt) {
            const status = receipt.status === 1 ? 'success' : 'failed';
            const gasUsed = receipt.gasUsed ? receipt.gasUsed.toString() : null;
            const cumulativeGasUsed = receipt.cumulativeGasUsed ? receipt.cumulativeGasUsed.toString() : null;
            let effectiveGasPriceGwei: number | null = null;
            try {
                const egp = (receipt as any).effectiveGasPrice as ethers.BigNumber | undefined;
                if (egp)
                    effectiveGasPriceGwei = Number(ethers.utils.formatUnits(egp, 'gwei'));
                else {
                    const tx = await provider.getTransaction(hash);
                    if (tx?.gasPrice)
                        effectiveGasPriceGwei = Number(ethers.utils.formatUnits(tx.gasPrice, 'gwei'));
                }
            }
            catch {
                effectiveGasPriceGwei = null;
            }
            const confirmations = typeof (receipt as any).confirmations === 'number'
                ? (receipt as any).confirmations
                : Math.max(0, (await provider.getBlockNumber()) - (receipt.blockNumber ?? 0) + 1);
            return sendJson(res, 200, {
                status,
                block_number: receipt.blockNumber ?? null,
                gas_used: gasUsed,
                cumulative_gas_used: cumulativeGasUsed,
                effective_gas_price_gwei: effectiveGasPriceGwei,
                confirmations,
            });
        }
        try {
            const tx = await provider.getTransaction(hash);
            if (tx && tx.blockNumber == null) {
                return sendJson(res, 200, {
                    status: 'pending',
                    block_number: null,
                    gas_used: null,
                    cumulative_gas_used: null,
                    effective_gas_price_gwei: tx.gasPrice ? Number(ethers.utils.formatUnits(tx.gasPrice, 'gwei')) : null,
                    confirmations: 0,
                });
            }
        }
        catch { }
        return sendJson(res, 200, {
            status: 'unknown',
            block_number: null,
            gas_used: null,
            cumulative_gas_used: null,
            effective_gas_price_gwei: null,
            confirmations: 0,
        });
    }
    catch (err: any) {
        return sendJson(res, 500, errorResponse('INTERNAL_ERROR', '服务端异常', { endpoint: 'tx/status', detail: err?.message || String(err) }));
    }
}
