import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import { PROTOCOL, CONTRACTS, GHOST_LENDING_ABI, PRICE_FEED_ABI } from '../config/contracts';

export default function Borrow() {
    const { address } = useAccount();
    const [borrowAmount, setBorrowAmount] = useState('');
    const [selectedVaultId, setSelectedVaultId] = useState<string>('');

    // 1. Get User Vault IDs
    const { data: userVaultIds } = useReadContract({
        address: CONTRACTS.GHOST_LENDING,
        abi: GHOST_LENDING_ABI,
        functionName: 'getUserVaults',
        args: address ? [address] : undefined,
    });

    // 2. Get BTC Price
    const { data: priceData } = useReadContract({
        address: CONTRACTS.PRICE_FEED,
        abi: PRICE_FEED_ABI,
        functionName: 'latestRoundData',
    });

    // 3. Get Price Decimals
    const { data: priceDecimals } = useReadContract({
        address: CONTRACTS.PRICE_FEED,
        abi: PRICE_FEED_ABI,
        functionName: 'decimals',
    });

    // Select first vault by default
    useEffect(() => {
        if (userVaultIds && (userVaultIds as string[]).length > 0 && !selectedVaultId) {
            setSelectedVaultId((userVaultIds as string[])[0]);
        }
    }, [userVaultIds]);

    // 4. Get Selected Vault Position
    const { data: positionData, refetch: refetchPosition } = useReadContract({
        address: CONTRACTS.GHOST_LENDING,
        abi: GHOST_LENDING_ABI,
        functionName: 'positions',
        args: selectedVaultId ? [selectedVaultId] : undefined,
        query: { enabled: !!selectedVaultId }
    });

    // 5. Get Health Factor
    const { data: healthFactorData, refetch: refetchHealth } = useReadContract({
        address: CONTRACTS.GHOST_LENDING,
        abi: GHOST_LENDING_ABI,
        functionName: 'getHealthFactor',
        args: selectedVaultId ? [selectedVaultId] : undefined,
        query: { enabled: !!selectedVaultId }
    });

    // Process Data
    const btcDecimals = priceDecimals || 8;
    const btcPriceRaw = priceData ? priceData[1] : BigInt(0);
    const btcPrice = Number(formatUnits(btcPriceRaw, btcDecimals));

    let vault = {
        id: selectedVaultId,
        btcAmount: 0,
        btcValue: 0,
        currentDebt: 0,
        maxBorrow: 0,
        availableToBorrow: 0,
        healthFactor: 0
    };

    if (positionData) {
        const pos = positionData as any;
        const btcAmount = Number(formatUnits(pos[2], 8)); // 8 decimals for BTC
        const debt = Number(formatUnits(pos[3], 18)); // 18 decimals for gUSD
        const health = healthFactorData ? Number(formatUnits(healthFactorData as bigint, 18)) : 0;

        const btcValue = btcAmount * btcPrice;
        const maxBorrow = btcValue * (PROTOCOL.LTV / 100);
        const available = Math.max(0, maxBorrow - debt);

        vault = {
            id: selectedVaultId,
            btcAmount,
            btcValue,
            currentDebt: debt,
            maxBorrow,
            availableToBorrow: available,
            healthFactor: health
        };
    }

    // Write Contract
    const { writeContract, data: hash, error: writeError, isPending } = useWriteContract();
    const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
        hash,
    });

    useEffect(() => {
        if (isConfirmed) {
            setBorrowAmount('');
            refetchPosition();
            refetchHealth();
        }
    }, [isConfirmed]);

    const handleBorrow = () => {
        if (!borrowAmount || !selectedVaultId) return;
        
        writeContract({
            address: CONTRACTS.GHOST_LENDING,
            abi: GHOST_LENDING_ABI,
            functionName: 'borrow',
            args: [selectedVaultId as `0x${string}`, parseUnits(borrowAmount, 18)],
        });
    };

    const calculateNewHealth = (additionalDebt: number) => {
        const totalDebt = vault.currentDebt + additionalDebt;
        if (totalDebt === 0) return Infinity;
        const collateralValue = vault.btcValue;
        return (collateralValue * PROTOCOL.LIQUIDATION_THRESHOLD / 100) / totalDebt;
    };

    const newHealthFactor = borrowAmount ? calculateNewHealth(parseFloat(borrowAmount)) : vault.healthFactor;

    const getHealthColor = (hf: number) => {
        if (hf >= 999) return 'text-green-400'; // Safe/Infinity
        if (hf >= 2) return 'text-green-400';
        if (hf >= 1.5) return 'text-yellow-400';
        return 'text-red-400';
    };

    return (
        <div className="max-w-2xl mx-auto space-y-8">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold mb-2">Borrow gUSD</h1>
                <p className="text-gray-400">Borrow stablecoins against your Bitcoin collateral</p>
            </div>

            {/* Error */}
            {(writeError as any) && (
                <div className="bg-red-500/20 border border-red-500/50 text-red-200 p-4 rounded-xl">
                    Transaction failed. Please check your wallet.
                </div>
            )}
             {isConfirmed && (
                <div className="bg-green-500/20 border border-green-500/50 text-green-200 p-4 rounded-xl">
                    Borrow successful!
                </div>
            )}

            {/* Vault Selection (if multiple) */}
            {userVaultIds && (userVaultIds as string[]).length > 1 && (
                <div className="card">
                     <label className="block text-sm text-gray-400 mb-2">Select Vault</label>
                     <select 
                        className="input"
                        value={selectedVaultId}
                        onChange={(e) => setSelectedVaultId(e.target.value)}
                    >
                        {(userVaultIds as string[]).map(id => (
                            <option key={id} value={id}>{id.slice(0, 10)}...</option>
                        ))}
                     </select>
                </div>
            )}

            {/* Vault Info */}
            <div className="card">
                <h3 className="text-lg font-semibold mb-4">Your Vault</h3>
                {selectedVaultId ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                            <p className="text-sm text-gray-400">Collateral</p>
                            <p className="font-bold text-btc">{vault.btcAmount.toFixed(4)} BTC</p>
                            <p className="text-xs text-gray-500">${vault.btcValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-400">Current Debt</p>
                            <p className="font-bold text-ghost-400">{vault.currentDebt.toFixed(2)} gUSD</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-400">Max Borrow ({PROTOCOL.LTV}% LTV)</p>
                            <p className="font-bold">{vault.maxBorrow.toFixed(2)} gUSD</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-400">Health Factor</p>
                            <p className={`font-bold ${getHealthColor(vault.healthFactor)}`}>
                                {vault.healthFactor >= 999 ? '∞' : vault.healthFactor.toFixed(2)}
                            </p>
                        </div>
                    </div>
                ) : (
                    <p className="text-gray-500">No vault selected. <a href="/vault" className="text-btc hover:underline">Create one?</a></p>
                )}
            </div>

            {/* Borrow Form */}
            <div className="card">
                <h3 className="text-lg font-semibold mb-4">Borrow Amount</h3>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm text-gray-400 mb-2">Amount to Borrow (gUSD)</label>
                        <div className="relative">
                            <input
                                type="number"
                                value={borrowAmount}
                                onChange={(e) => setBorrowAmount(e.target.value)}
                                placeholder="0.00"
                                className="input text-2xl"
                                min="0"
                                max={vault.availableToBorrow}
                                disabled={!selectedVaultId || vault.availableToBorrow <= 0}
                            />
                            <button
                                onClick={() => setBorrowAmount(vault.availableToBorrow.toString())}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-ghost-400 text-sm font-medium hover:text-ghost-300"
                            >
                                MAX
                            </button>
                        </div>
                        <p className="text-sm text-gray-500 mt-2">
                            Available: {vault.availableToBorrow.toFixed(2)} gUSD
                        </p>
                    </div>

                    {/* Health Factor Preview */}
                    {borrowAmount && parseFloat(borrowAmount) > 0 && (
                        <div className="bg-white/5 rounded-xl p-4">
                            <p className="text-sm text-gray-400 mb-2">New Health Factor</p>
                            <div className="flex items-center gap-4">
                                <span className={getHealthColor(vault.healthFactor)}>
                                    {vault.healthFactor >= 999 ? '∞' : vault.healthFactor.toFixed(2)}
                                </span>
                                <span className="text-gray-500">→</span>
                                <span className={getHealthColor(newHealthFactor)}>
                                    {newHealthFactor >= 999 ? '∞' : newHealthFactor.toFixed(2)}
                                </span>
                            </div>
                            {newHealthFactor < 1.2 && (
                                <p className="text-red-400 text-sm mt-2">
                                    ⚠️ Warning: This brings you close to liquidation
                                </p>
                            )}
                        </div>
                    )}

                    <button
                        onClick={handleBorrow}
                        disabled={isPending || isConfirming || !borrowAmount || parseFloat(borrowAmount) <= 0 || parseFloat(borrowAmount) > vault.availableToBorrow}
                        className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isPending || isConfirming ? 'Confirming...' : 'Borrow gUSD'}
                    </button>
                </div>
            </div>

            {/* Info */}
            <div className="card bg-blue-500/10 border-blue-500/20">
                <h4 className="font-semibold mb-2">💡 How Borrowing Works</h4>
                <ul className="text-sm text-gray-300 space-y-1">
                    <li>• Maximum LTV is {PROTOCOL.LTV}% of your BTC collateral value</li>
                    <li>• Liquidation occurs when health factor falls below 1.0</li>
                    <li>• Interest accrues continuously at the current borrow rate</li>
                    <li>• Repay anytime to improve your health factor</li>
                </ul>
            </div>
        </div>
    );
}