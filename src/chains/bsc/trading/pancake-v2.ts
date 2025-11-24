import { ethers } from 'ethers';
import { PANCAKE_ROUTER_ABI, ERC20_ABI } from './abi';
import { WBNB, PANCAKE_V2_ROUTER } from '../constants';
type TxOverrides = {
    gasPrice?: ethers.BigNumber;
    gasLimit?: ethers.BigNumber;
};
export class PancakeV2Trader {
    public wallet: ethers.Wallet;
    private overrides: TxOverrides = {};
    constructor(provider: ethers.providers.Provider, privateKey: string) {
        this.wallet = new ethers.Wallet(privateKey, provider);
    }
    address(): string { return this.wallet.address; }
    setTxOverrides(o: TxOverrides) { this.overrides = { ...o }; }
    async approveTokenUnsigned(token: string, nonce?: number): Promise<string> {
        const iface = new ethers.utils.Interface(ERC20_ABI as any);
        const data = iface.encodeFunctionData('approve', [PANCAKE_V2_ROUTER, ethers.constants.MaxUint256]);
        const chainId = await this.wallet.getChainId();
        const tx = {
            chainId,
            to: token,
            data,
            nonce,
            ...(this.overrides.gasPrice ? { gasPrice: this.overrides.gasPrice } : {}),
            ...(this.overrides.gasLimit ? { gasLimit: this.overrides.gasLimit } : {}),
        } as ethers.providers.TransactionRequest;
        return await this.wallet.signTransaction(tx);
    }
    async approveTokenAmountUnsigned(token: string, amount: ethers.BigNumber, nonce?: number): Promise<string> {
        const iface = new ethers.utils.Interface(ERC20_ABI as any);
        const data = iface.encodeFunctionData('approve', [PANCAKE_V2_ROUTER, amount]);
        const chainId = await this.wallet.getChainId();
        const tx = {
            chainId,
            to: token,
            data,
            nonce,
            ...(this.overrides.gasPrice ? { gasPrice: this.overrides.gasPrice } : {}),
            ...(this.overrides.gasLimit ? { gasLimit: this.overrides.gasLimit } : {}),
        } as ethers.providers.TransactionRequest;
        return await this.wallet.signTransaction(tx);
    }
    async buyUnsigned(token: string, bnbIn: ethers.BigNumber, amountOutMin: ethers.BigNumber, nonce?: number, deadlineSec: number = 600): Promise<string> {
        const iface = new ethers.utils.Interface(PANCAKE_ROUTER_ABI as any);
        const path = [WBNB, token];
        const to = this.address();
        const deadline = Math.floor(Date.now() / 1000) + Math.max(1, deadlineSec);
        const data = iface.encodeFunctionData('swapExactETHForTokens', [amountOutMin, path, to, deadline]);
        const chainId = await this.wallet.getChainId();
        try {
        }
        catch { }
        const tx = {
            chainId,
            to: PANCAKE_V2_ROUTER,
            data,
            value: bnbIn,
            nonce,
            ...(this.overrides.gasPrice ? { gasPrice: this.overrides.gasPrice } : {}),
            ...(this.overrides.gasLimit ? { gasLimit: this.overrides.gasLimit } : {}),
        } as ethers.providers.TransactionRequest;
        return await this.wallet.signTransaction(tx);
    }
    async buyUnsignedPath(path: string[], bnbIn: ethers.BigNumber, amountOutMin: ethers.BigNumber, nonce?: number, deadlineSec: number = 600): Promise<string> {
        const iface = new ethers.utils.Interface(PANCAKE_ROUTER_ABI as any);
        const to = this.address();
        const deadline = Math.floor(Date.now() / 1000) + Math.max(1, deadlineSec);
        const data = iface.encodeFunctionData('swapExactETHForTokens', [amountOutMin, path, to, deadline]);
        const chainId = await this.wallet.getChainId();
        try {
        }
        catch { }
        const tx = {
            chainId,
            to: PANCAKE_V2_ROUTER,
            data,
            value: bnbIn,
            nonce,
            ...(this.overrides.gasPrice ? { gasPrice: this.overrides.gasPrice } : {}),
            ...(this.overrides.gasLimit ? { gasLimit: this.overrides.gasLimit } : {}),
        } as ethers.providers.TransactionRequest;
        return await this.wallet.signTransaction(tx);
    }
    async sellUnsigned(token: string, amountIn: ethers.BigNumber, amountOutMin: ethers.BigNumber, nonce?: number, deadlineSec: number = 600): Promise<string> {
        const iface = new ethers.utils.Interface(PANCAKE_ROUTER_ABI as any);
        const path = [token, WBNB];
        const to = this.address();
        const deadline = Math.floor(Date.now() / 1000) + Math.max(1, deadlineSec);
        const data = iface.encodeFunctionData('swapExactTokensForETH', [amountIn, amountOutMin, path, to, deadline]);
        const chainId = await this.wallet.getChainId();
        const tx = {
            chainId,
            to: PANCAKE_V2_ROUTER,
            data,
            nonce,
            ...(this.overrides.gasPrice ? { gasPrice: this.overrides.gasPrice } : {}),
            ...(this.overrides.gasLimit ? { gasLimit: this.overrides.gasLimit } : {}),
        } as ethers.providers.TransactionRequest;
        return await this.wallet.signTransaction(tx);
    }
    async sellUnsignedPath(path: string[], amountIn: ethers.BigNumber, amountOutMin: ethers.BigNumber, nonce?: number, deadlineSec: number = 600): Promise<string> {
        const iface = new ethers.utils.Interface(PANCAKE_ROUTER_ABI as any);
        const to = this.address();
        const deadline = Math.floor(Date.now() / 1000) + Math.max(1, deadlineSec);
        const data = iface.encodeFunctionData('swapExactTokensForETH', [amountIn, amountOutMin, path, to, deadline]);
        const chainId = await this.wallet.getChainId();
        const tx = {
            chainId,
            to: PANCAKE_V2_ROUTER,
            data,
            nonce,
            ...(this.overrides.gasPrice ? { gasPrice: this.overrides.gasPrice } : {}),
            ...(this.overrides.gasLimit ? { gasLimit: this.overrides.gasLimit } : {}),
        } as ethers.providers.TransactionRequest;
        return await this.wallet.signTransaction(tx);
    }
}
export async function pollReceipt(provider: ethers.providers.Provider, txHash: string, intervalMs = 800, timeoutMs = 90000): Promise<ethers.providers.TransactionReceipt | null> {
    const started = Date.now();
    let receipt: ethers.providers.TransactionReceipt | null = null;
    while (!receipt) {
        receipt = await provider.getTransactionReceipt(txHash);
        if (receipt)
            break;
        if (timeoutMs && Date.now() - started > timeoutMs)
            return null;
        await new Promise(r => setTimeout(r, Math.max(200, intervalMs)));
    }
    return receipt;
}
