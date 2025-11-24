import { ethers } from 'ethers';
import { BigNumber } from '@ethersproject/bignumber';
import { formatEther } from '@ethersproject/units';
import { AbiCoder } from '@ethersproject/abi';
import { FOURMEME_ABI, ERC20_ABI } from './abi';
import { quoteBuy as quoteBuyInternal, quoteSell as quoteSellInternal } from '../quote/internal';
import { TokenInfoAggregatorService } from './aggregator';
import { OptimizedTokenInfoAggregator } from './optimized-aggregator';
import { Address, TokenInfo, PriceInfo, TradeResult, TradeType, AggregatedTokenInfo, XModeBuyParams, BuyTokenParams, TxOverrides } from './types';
import { FOURMEME_CONTRACT, TOKEN_MANAGER_HELPER3 } from '../constants';
function applyPercent(bn: BigNumber, percent: number): BigNumber {
    const numerator = BigInt(Math.round(percent * 100));
    const denominator = BigInt(100 * 100);
    const base = BigInt(bn.toString());
    return BigNumber.from((base * numerator) / denominator);
}
export class FourememeTrader {
    private contract: ethers.Contract;
    private helper3: ethers.Contract;
    private wallet: ethers.Wallet;
    private aggregatorService: TokenInfoAggregatorService;
    private optimizedAggregator: OptimizedTokenInfoAggregator;
    private txOverrides: TxOverrides = {};
    constructor(provider: any, privateKey: string, contractAddress: string = FOURMEME_CONTRACT) {
        this.wallet = new ethers.Wallet(privateKey, provider);
        this.contract = new ethers.Contract(contractAddress, FOURMEME_ABI, this.wallet);
        this.helper3 = new ethers.Contract(TOKEN_MANAGER_HELPER3, FOURMEME_ABI, this.wallet);
        this.aggregatorService = new TokenInfoAggregatorService(provider);
        this.optimizedAggregator = new OptimizedTokenInfoAggregator(provider);
    }
    address(): string {
        return this.wallet.address;
    }
    async getTokenInfo(token: Address): Promise<TokenInfo> {
        const info = await this.aggregatorService.getAggregatedInfo(token);
        return {
            base: '0x0000000000000000000000000000000000000000',
            quote: '0x0000000000000000000000000000000000000000',
            template: BigNumber.from(0),
            total_supply: info.totalSupplyA,
            max_offers: info.maxOffers,
            max_raising: info.maxFunds,
            launch_time: BigNumber.from(0),
            offers: info.offers,
            funds: info.funds,
            last_price: BigNumber.from(0),
            k: BigNumber.from(0),
            t: BigNumber.from(0),
            status: BigNumber.from(info.tradingStatus),
        };
    }
    async getAggregatedTokenInfo(token: Address): Promise<AggregatedTokenInfo> {
        return this.aggregatorService.getAggregatedInfo(token);
    }
    async batchGetAggregatedTokenInfo(tokens: Address[]): Promise<AggregatedTokenInfo[]> {
        const promises = tokens.map((t) => this.aggregatorService.getAggregatedInfo(t));
        return Promise.all(promises);
    }
    async quoteBuy(token: Address, bnb_cost: BigNumber): Promise<PriceInfo> {
        const r = await quoteBuyInternal(this.wallet.provider, token, bnb_cost);
        return {
            token_amount: r.tokenAmount,
            bnb_cost: bnb_cost,
            price_per_token: r.pricePerToken,
            fee: BigNumber.from(0),
        };
    }
    async quoteSell(token: Address, token_amount: BigNumber): Promise<PriceInfo> {
        const r = await quoteSellInternal(this.wallet.provider, token, token_amount);
        return {
            token_amount,
            bnb_cost: r.bnbAmount,
            price_per_token: r.pricePerToken,
            fee: BigNumber.from(0),
        };
    }
    async buy(token: Address, bnb_cost: BigNumber, slippage: number): Promise<TradeResult> {
        const priceInfo = await this.quoteBuy(token, bnb_cost);
        const minPercent = 100 - slippage;
        const minAmount = applyPercent(priceInfo.token_amount, minPercent);
        const gas = await (this.contract.estimateGas as any).buyTokenAMAP(token, this.address(), bnb_cost, minAmount, { value: bnb_cost });
        const tx = await (this.contract as any).buyTokenAMAP(token, this.address(), bnb_cost, minAmount, this.mergeOverrides({ value: bnb_cost }, gas));
        const receipt = await tx.wait();
        return {
            tx_hash: receipt.transactionHash,
            trade_type: 'Buy',
            token,
            amount: priceInfo.token_amount,
            cost: bnb_cost,
            price: priceInfo.price_per_token,
        };
    }
    async buyOptimized(token: Address, bnb_cost: BigNumber, slippage: number): Promise<TradeResult> {
        const priceInfo = await this.quoteBuy(token, bnb_cost);
        const minPercent = 100 - slippage;
        const minAmount = applyPercent(priceInfo.token_amount, minPercent);
        return this.selectBuyMethod(token, bnb_cost, minAmount);
    }
    async sell(token: Address, amount: BigNumber, slippage: number): Promise<TradeResult> {
        const priceInfo = await this.quoteSell(token, amount);
        const minPercent = 100 - slippage;
        const minFunds = applyPercent(priceInfo.bnb_cost, minPercent);
        const gas = await (this.contract.estimateGas as any).sellToken(token, amount, minFunds);
        const tx = await (this.contract as any).sellToken(token, amount, minFunds, this.mergeOverrides({}, gas));
        const receipt = await tx.wait();
        return {
            tx_hash: receipt.transactionHash,
            trade_type: 'Sell',
            token,
            amount,
            cost: priceInfo.bnb_cost,
            price: priceInfo.price_per_token,
        };
    }
    async sellOptimized(token: Address, amount: BigNumber, slippage: number): Promise<TradeResult> {
        const priceInfo = await this.quoteSell(token, amount);
        const minPercent = 100 - slippage;
        const minFunds = applyPercent(priceInfo.bnb_cost, minPercent);
        return this.selectSellMethod(token, amount, minFunds);
    }

    async approveToken(token: Address): Promise<string> {
        const tokenContract = new ethers.Contract(token, ERC20_ABI, this.wallet);
        const maxAmount = BigNumber.from('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        const gas = await (tokenContract.estimateGas as any).approve(FOURMEME_CONTRACT, maxAmount);
        const tx = await (tokenContract as any).approve(FOURMEME_CONTRACT, maxAmount, this.mergeOverrides({}, gas));
        const receipt = await tx.wait();
        return receipt.transactionHash;
    }
    async getTokenAllowance(token: Address, spender: Address): Promise<BigNumber> {
        const tokenContract = new ethers.Contract(token, ERC20_ABI, this.wallet);
        return await (tokenContract as any).allowance(this.address(), spender);
    }
    async approveTokenToHelper(token: Address): Promise<string> {
        const tokenContract = new ethers.Contract(token, ERC20_ABI, this.wallet);
        const maxAmount = BigNumber.from('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        const gas = await (tokenContract.estimateGas as any).approve(TOKEN_MANAGER_HELPER3, maxAmount);
        const tx = await (tokenContract as any).approve(TOKEN_MANAGER_HELPER3, maxAmount, this.mergeOverrides({}, gas));
        const receipt = await tx.wait();
        return receipt.transactionHash;
    }
    async isTokenOnFourmeme(token: Address): Promise<boolean> {
        return this.aggregatorService.isFourMemeToken(token);
    }
    async isTokenOnFourmemeOptimized(token: Address): Promise<boolean> {
        return this.aggregatorService.isFourMemeToken(token);
    }
    async getTradingStatus(token: Address): Promise<{
        isFourMeme: boolean;
        isInternal: boolean;
        isGraduated: boolean;
    }> {
        return this.aggregatorService.getTradingStatus(token);
    }
    async getTokenBalance(token: Address): Promise<BigNumber> {
        const raw = await new ethers.Contract(token, ERC20_ABI, this.wallet).balanceOf(this.address());
        return raw;
    }
    async isXModeToken(token: Address): Promise<boolean> {
        try {
            if (!this.optimizedAggregator) {
                console.error('OptimizedTokenInfoAggregator 未初始化');
                return false;
            }
            const fourmemeInfo = await this.optimizedAggregator.getFourmemeTokenInfo(token);
            return fourmemeInfo.poolInfo.isXMode;
        }
        catch (error) {
            console.error('检查是否 X 模式代币出错：', error);
            return false;
        }
    }
    async quoteXModeBuy(token: Address, bnb_cost: BigNumber): Promise<PriceInfo> {
        return this.quoteBuy(token, bnb_cost);
    }
    async buyXMode(params: XModeBuyParams, slippage: number = 2): Promise<TradeResult> {
        const { token, to, amount, funds, maxFunds, minAmount } = params;
        const safeOrigin = BigNumber.from(0);
        const safeAmount = amount || BigNumber.from(0);
        const safeFunds = funds || BigNumber.from(0);
        const safeMaxFunds = maxFunds || BigNumber.from(0);
        const safeMinAmount = minAmount || BigNumber.from(0);
        const safeTo = to || this.address();
        const buyTokenParams: BuyTokenParams = {
            origin: safeOrigin,
            token,
            to: safeTo,
            amount: safeAmount,
            maxFunds: safeMaxFunds,
            funds: safeFunds,
            minAmount: safeMinAmount,
        };
        const abiCoder = new AbiCoder();
        const encodedArgs = abiCoder.encode(['tuple(uint256,address,address,uint256,uint256,uint256,uint256)'], [[
                buyTokenParams.origin.toString(),
                buyTokenParams.token,
                buyTokenParams.to,
                buyTokenParams.amount.toString(),
                buyTokenParams.maxFunds.toString(),
                buyTokenParams.funds.toString(),
                buyTokenParams.minAmount.toString(),
            ]]);
        let bnbValue = safeFunds.gt(0) ? safeFunds : safeMaxFunds;
        if (bnbValue.eq(0)) {
            throw new Error('必须指定 funds 或 maxFunds 参数');
        }
        try {
            const gas = await this.contract.estimateGas['buyToken(bytes,uint256,bytes)'](encodedArgs, 0, '0x', { value: bnbValue.toString() });
            const tx = await this.contract['buyToken(bytes,uint256,bytes)'](encodedArgs, 0, '0x', this.mergeOverrides({ value: bnbValue.toString() }, gas));
            const receipt = await tx.wait();
            return {
                tx_hash: receipt.transactionHash,
                trade_type: 'Buy',
                token,
                amount: safeAmount,
                cost: bnbValue,
                price: bnbValue.gt(0) && safeAmount.gt(0) ? parseFloat(formatEther(bnbValue)) / parseFloat(formatEther(safeAmount)) : 0,
            };
        }
        catch (error) {
            console.error('X 模式买入出错：', error);
            throw error;
        }
    }
    async smartBuy(token: Address, bnb_cost: BigNumber, slippage: number = 2): Promise<TradeResult> {
        const isXMode = await this.isXModeToken(token);
        if (isXMode) {
            return this.buyXMode({
                token,
                funds: bnb_cost,
                minAmount: BigNumber.from(0),
            }, slippage);
        }
        else {
            return this.buyOptimized(token, bnb_cost, slippage);
        }
    }

    private async sendBuyXModeRaw(params: XModeBuyParams, slippage: number = 2): Promise<{
        tx: ethers.providers.TransactionResponse;
        token_amount: BigNumber;
        price_per_token: number;
    }> {
        const { token, to, funds, maxFunds } = params;
        const safeFunds = funds || BigNumber.from(0);
        const bnbValue = safeFunds.gt(0) ? safeFunds : (maxFunds || BigNumber.from(0));
        if (bnbValue.eq(0))
            throw new Error('必须指定 funds 或 maxFunds 参数');
        const quote = await this.quoteXModeBuy(token, bnbValue);
        const minAmount = applyPercent(quote.token_amount, 100 - slippage);
        const abiCoder = new AbiCoder();
        const buyTokenParams: BuyTokenParams = {
            origin: BigNumber.from(0),
            token,
            to: to || this.address(),
            amount: BigNumber.from(0),
            maxFunds: bnbValue,
            funds: bnbValue,
            minAmount,
        };
        const encodedArgs = abiCoder.encode(['tuple(uint256,address,address,uint256,uint256,uint256,uint256)'], [[
                buyTokenParams.origin.toString(),
                buyTokenParams.token,
                buyTokenParams.to,
                buyTokenParams.amount.toString(),
                buyTokenParams.maxFunds.toString(),
                buyTokenParams.funds.toString(),
                buyTokenParams.minAmount.toString(),
            ]]);
        const gas = await this.contract.estimateGas['buyToken(bytes,uint256,bytes)'](encodedArgs, 0, '0x', { value: bnbValue.toString() });
        const tx = await this.contract['buyToken(bytes,uint256,bytes)'](encodedArgs, 0, '0x', this.mergeOverrides({ value: bnbValue.toString() }, gas));
        return { tx, token_amount: quote.token_amount, price_per_token: quote.price_per_token };
    }
    async smartSell(token: Address, amount: BigNumber, slippage: number = 2): Promise<TradeResult> {
        const isXMode = await this.isXModeToken(token);
        if (isXMode) {
            console.warn('警告：这是X Mode代币，卖出可能需要特殊处理');
            return this.sellOptimized(token, amount, slippage);
        }
        else {
            return this.sellOptimized(token, amount, slippage);
        }
    }
    async getRecommendedTradingMethod(token: Address): Promise<'normal' | 'xmode'> {
        const isXMode = await this.isXModeToken(token);
        return isXMode ? 'xmode' : 'normal';
    }
    private async isBnbQuotePool(token: Address): Promise<boolean> {
        try {
            const tokenInfo = await this.optimizedAggregator.getFourmemeTokenInfo(token);
            const quote = tokenInfo.platformInfo.quote;
            const isZero = quote === ethers.constants.AddressZero;
            return isZero;
        }
        catch (error) {
            console.error('检查报价类型出错：', error);
            return true;
        }
    }
    private async selectBuyMethod(token: Address, bnb_cost: BigNumber, minAmount: BigNumber): Promise<TradeResult> {
        const agg = await this.optimizedAggregator.getFourmemeTokenInfo(token);
        const isBnbQuote = agg.platformInfo.quote === ethers.constants.AddressZero;
        if (isBnbQuote) {
            const value = bnb_cost;
            const funds = bnb_cost;
            const gas = await (this.contract.estimateGas as any).buyTokenAMAP(token, this.address(), funds, minAmount, { value });
            const tx = await (this.contract as any).buyTokenAMAP(token, this.address(), funds, minAmount, this.mergeOverrides({ value }, gas));
            const receipt = await tx.wait();
            return {
                tx_hash: receipt.transactionHash,
                trade_type: 'Buy',
                token,
                amount: minAmount,
                cost: funds,
                price: parseFloat(formatEther(funds.toString())) / parseFloat(formatEther(minAmount.toString())),
            };
        }
        else {
            const origin = BigNumber.from(0);
            const value = bnb_cost;
            const funds = bnb_cost;
            const gas = await (this.helper3.estimateGas as any).buyWithEth(origin, token, this.address(), funds, minAmount, { value });
            const tx = await (this.helper3 as any).buyWithEth(origin, token, this.address(), funds, minAmount, this.mergeOverrides({ value }, gas));
            const receipt = await tx.wait();
            return {
                tx_hash: receipt.transactionHash,
                trade_type: 'Buy',
                token,
                amount: minAmount,
                cost: funds,
                price: parseFloat(formatEther(funds.toString())) / parseFloat(formatEther(minAmount.toString())),
            };
        }
    }
    private async selectSellMethod(token: Address, amount: BigNumber, minFunds: BigNumber): Promise<TradeResult> {
        const agg = await this.optimizedAggregator.getFourmemeTokenInfo(token);
        const isBnbQuote = agg.platformInfo.quote === ethers.constants.AddressZero;
        if (isBnbQuote) {
            const gas = await (this.contract.estimateGas as any).sellToken(token, amount, minFunds);
            const tx = await (this.contract as any).sellToken(token, amount, minFunds, this.mergeOverrides({}, gas));
            const receipt = await tx.wait();
            return {
                tx_hash: receipt.transactionHash,
                trade_type: 'Sell',
                token,
                amount,
                cost: minFunds,
                price: parseFloat(formatEther(minFunds.toString())) / parseFloat(formatEther(amount.toString())),
            };
        }
        else {
            const gas = await (this.contract.estimateGas as any).sellToken(token, amount, minFunds);
            const tx = await (this.contract as any).sellToken(token, amount, minFunds, this.mergeOverrides({}, gas));
            const receipt = await tx.wait();
            return {
                tx_hash: receipt.transactionHash,
                trade_type: 'Sell',
                token,
                amount,
                cost: minFunds,
                price: parseFloat(formatEther(minFunds.toString())) / parseFloat(formatEther(amount.toString())),
            };
        }
    }
    setTxOverrides(overrides: TxOverrides) {
        this.txOverrides = overrides || {};
    }
    private mergeOverrides(base: Record<string, any>, fallbackGasLimit?: BigNumber): Record<string, any> {
        const merged: any = { ...base };
        if (this.txOverrides.gasPrice)
            merged.gasPrice = this.txOverrides.gasPrice;
        if (this.txOverrides.gasLimit || fallbackGasLimit)
            merged.gasLimit = this.txOverrides.gasLimit || fallbackGasLimit;
        if (this.txOverrides.nonce !== undefined)
            merged.nonce = this.txOverrides.nonce;
        return merged;
    }

    async approveTokenUnsigned(token: Address, nonce: number): Promise<string> {
        const tokenContract = new ethers.Contract(token, ERC20_ABI, this.wallet);
        const maxAmount = BigNumber.from('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        const gasLimit = this.txOverrides.gasLimit || await (tokenContract.estimateGas as any).approve(FOURMEME_CONTRACT, maxAmount);
        const tx = await (tokenContract as any).populateTransaction.approve(FOURMEME_CONTRACT, maxAmount, { nonce, gasPrice: this.txOverrides.gasPrice, gasLimit });
        const chainId = await this.wallet.getChainId();
        const withChainId = { chainId, ...tx } as ethers.providers.TransactionRequest;
        return await this.wallet.signTransaction(withChainId);
    }
    async approveTokenAmountUnsigned(token: Address, amount: BigNumber, nonce: number): Promise<string> {
        const tokenContract = new ethers.Contract(token, ERC20_ABI, this.wallet);
        const gasLimit = this.txOverrides.gasLimit || await (tokenContract.estimateGas as any).approve(FOURMEME_CONTRACT, amount);
        const tx = await (tokenContract as any).populateTransaction.approve(FOURMEME_CONTRACT, amount, { nonce, gasPrice: this.txOverrides.gasPrice, gasLimit });
        const chainId = await this.wallet.getChainId();
        const withChainId = { chainId, ...tx } as ethers.providers.TransactionRequest;
        return await this.wallet.signTransaction(withChainId);
    }
    async sendBuyOptimizedUnsigned(token: Address, bnb_cost: BigNumber, slippage: number, nonce: number): Promise<{
        serialized: string;
        token_amount: BigNumber;
        price_per_token: number;
    }> {
        const priceInfo = await this.quoteBuy(token, bnb_cost);
        const minPercent = 100 - slippage;
        const minAmount = applyPercent(priceInfo.token_amount, minPercent);
        const isBnbQuote = await this.isBnbQuotePool(token);
        let tx: ethers.providers.TransactionRequest;
        if (isBnbQuote) {
            const gasLimit = this.txOverrides.gasLimit || await (this.contract.estimateGas as any).buyTokenAMAP(token, this.address(), bnb_cost, minAmount, { value: bnb_cost });
            tx = await (this.contract as any).populateTransaction.buyTokenAMAP(token, this.address(), bnb_cost, minAmount, { value: bnb_cost, nonce, gasPrice: this.txOverrides.gasPrice, gasLimit });
        }
        else {
            const gasLimit = this.txOverrides.gasLimit || await (this.helper3.estimateGas as any).buyWithEth(0, token, this.address(), bnb_cost, minAmount, { value: bnb_cost });
            tx = await (this.helper3 as any).populateTransaction.buyWithEth(0, token, this.address(), bnb_cost, minAmount, { value: bnb_cost, nonce, gasPrice: this.txOverrides.gasPrice, gasLimit });
        }
        const chainId = await this.wallet.getChainId();
        const withChainId = { chainId, ...tx } as ethers.providers.TransactionRequest;
        const serialized = await this.wallet.signTransaction(withChainId);
        return { serialized, token_amount: priceInfo.token_amount, price_per_token: priceInfo.price_per_token };
    }
    async sendBuyOptimizedUnsignedPrecomputed(token: Address, bnb_cost: BigNumber, minAmount: BigNumber, token_amount: BigNumber, price_per_token: number, nonce: number): Promise<{
        serialized: string;
        token_amount: BigNumber;
        price_per_token: number;
    }> {
        const gasLimit = this.txOverrides.gasLimit || await (this.contract.estimateGas as any).buyTokenAMAP(token, this.address(), bnb_cost, minAmount, { value: bnb_cost });
        const tx = await (this.contract as any).populateTransaction.buyTokenAMAP(token, this.address(), bnb_cost, minAmount, { value: bnb_cost, nonce, gasPrice: this.txOverrides.gasPrice, gasLimit });
        const chainId = await this.wallet.getChainId();
        const withChainId = { chainId, ...tx } as ethers.providers.TransactionRequest;
        const serialized = await this.wallet.signTransaction(withChainId);
        return { serialized, token_amount, price_per_token };
    }
    async sendSellOptimizedUnsigned(token: Address, amount: BigNumber, slippage: number, nonce: number): Promise<{
        serialized: string;
        bnb_cost: BigNumber;
        price_per_token: number;
    }> {
        const priceInfo = await this.quoteSell(token, amount);
        const minPercent = 100 - slippage;
        const minFunds = applyPercent(priceInfo.bnb_cost, minPercent);
        const isBnbQuote = await this.isBnbQuotePool(token);
        if (isBnbQuote) {
            const gasLimit = this.txOverrides.gasLimit || await (this.contract.estimateGas as any).sellToken(token, amount, minFunds);
            const tx = await (this.contract as any).populateTransaction.sellToken(token, amount, minFunds, { nonce, gasPrice: this.txOverrides.gasPrice, gasLimit });
            const chainId = await this.wallet.getChainId();
            const withChainId = { chainId, ...tx } as ethers.providers.TransactionRequest;
            const serialized = await this.wallet.signTransaction(withChainId);
            return { serialized, bnb_cost: priceInfo.bnb_cost, price_per_token: priceInfo.price_per_token };
        }
        else {
            const gasLimit = this.txOverrides.gasLimit || await (this.contract.estimateGas as any).sellToken(token, amount, minFunds);
            const tx = await (this.contract as any).populateTransaction.sellToken(token, amount, minFunds, { nonce, gasPrice: this.txOverrides.gasPrice, gasLimit });
            const chainId = await this.wallet.getChainId();
            const withChainId = { chainId, ...tx } as ethers.providers.TransactionRequest;
            const serialized = await this.wallet.signTransaction(withChainId);
            return { serialized, bnb_cost: priceInfo.bnb_cost, price_per_token: priceInfo.price_per_token };
        }
    }
    async sendSellOptimizedUnsignedPrecomputed(token: Address, amount: BigNumber, minFunds: BigNumber, bnb_cost: BigNumber, price_per_token: number, nonce: number): Promise<{
        serialized: string;
        bnb_cost: BigNumber;
        price_per_token: number;
    }> {
        const isBnbQuote = await this.isBnbQuotePool(token);
        let tx: ethers.providers.TransactionRequest;
        let gasLimit: BigNumber;
        if (isBnbQuote) {
            gasLimit = this.txOverrides.gasLimit || await (this.contract.estimateGas as any).sellToken(token, amount, minFunds);
            tx = await (this.contract as any).populateTransaction.sellToken(token, amount, minFunds, { nonce, gasPrice: this.txOverrides.gasPrice, gasLimit });
        }
        else {
            gasLimit = this.txOverrides.gasLimit || await (this.contract.estimateGas as any).sellToken(token, amount, minFunds);
            tx = await (this.contract as any).populateTransaction.sellToken(token, amount, minFunds, { nonce, gasPrice: this.txOverrides.gasPrice, gasLimit });
        }
        const chainId = await this.wallet.getChainId();
        const withChainId = { chainId, ...tx } as ethers.providers.TransactionRequest;
        const serialized = await this.wallet.signTransaction(withChainId);
        return { serialized, bnb_cost, price_per_token };
    }
    async signBuyPrecomputedNoEst(token: Address, bnb_cost: BigNumber, minAmount: BigNumber, nonce: number, chainId: number, isBnbQuote: boolean): Promise<string> {
        const gasLimit = this.txOverrides.gasLimit ?? BigNumber.from(500000);
        let tx: ethers.providers.TransactionRequest;
        if (isBnbQuote) {
            try {
            }
            catch { }
            tx = await (this.contract as any).populateTransaction.buyTokenAMAP(token, this.address(), bnb_cost, minAmount, { value: bnb_cost, nonce, gasPrice: this.txOverrides.gasPrice, gasLimit });
        }
        else {
            try {
            }
            catch { }
            tx = await (this.helper3 as any).populateTransaction.buyWithEth(0, token, this.address(), bnb_cost, minAmount, { value: bnb_cost, nonce, gasPrice: this.txOverrides.gasPrice, gasLimit });
        }
        const serialized = await this.wallet.signTransaction({ chainId, ...tx });
        return serialized;
    }
    async signSellPrecomputedNoEst(token: Address, amount: BigNumber, minFunds: BigNumber, nonce: number, chainId: number): Promise<string> {
        const gasLimit = this.txOverrides.gasLimit ?? BigNumber.from(500000);
        const tx = await (this.contract as any).populateTransaction.sellToken(token, amount, minFunds, { nonce, gasPrice: this.txOverrides.gasPrice, gasLimit });
        const serialized = await this.wallet.signTransaction({ chainId, ...tx });
        return serialized;
    }
    async signApproveMaxNoEst(token: Address, nonce: number, chainId: number): Promise<string> {
        const tokenContract = new ethers.Contract(token, ERC20_ABI, this.wallet);
        const maxAmount = BigNumber.from('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        const gasLimit = this.txOverrides.gasLimit ?? BigNumber.from(120000);
        const tx = await (tokenContract as any).populateTransaction.approve(FOURMEME_CONTRACT, maxAmount, { nonce, gasPrice: this.txOverrides.gasPrice, gasLimit });
        const serialized = await this.wallet.signTransaction({ chainId, ...tx });
        return serialized;
    }
    async signApproveAmountNoEst(token: Address, amount: BigNumber, nonce: number, chainId: number): Promise<string> {
        const tokenContract = new ethers.Contract(token, ERC20_ABI, this.wallet);
        const gasLimit = this.txOverrides.gasLimit ?? BigNumber.from(120000);
        const tx = await (tokenContract as any).populateTransaction.approve(FOURMEME_CONTRACT, amount, { nonce, gasPrice: this.txOverrides.gasPrice, gasLimit });
        const serialized = await this.wallet.signTransaction({ chainId, ...tx });
        return serialized;
    }
}
