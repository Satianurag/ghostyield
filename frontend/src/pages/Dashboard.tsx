import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Link } from 'react-router-dom';
import { CONTRACTS, GHOST_LENDING_ABI, PRICE_FEED_ABI, API_URL } from '../config/contracts';
import { formatUnits } from 'viem';
import { useBitcoinWallet } from '../hooks/useBitcoinWallet';
import { useState } from 'react';

export default function Dashboard() {
    const { address } = useAccount();
    const btcWallet = useBitcoinWallet();

    // 1. Get User Vault IDs
    const { data: userVaultIds } = useReadContract({
        address: CONTRACTS.GHOST_LENDING,
        abi: GHOST_LENDING_ABI,
        functionName: 'getUserVaults',
        args: address ? [address] : undefined,
        query: { enabled: !!address }
    });

    const vaultIds = (userVaultIds as string[]) || [];

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

    // 4. Get Vault Positions
    const { data: vaultPositions } = useReadContracts({
        contracts: vaultIds.map(id => ({
            address: CONTRACTS.GHOST_LENDING,
            abi: GHOST_LENDING_ABI,
            functionName: 'positions',
            args: [id]
        })) as any
    });

    // 5. Get Health Factors
    const { data: healthFactors } = useReadContracts({
        contracts: vaultIds.map(id => ({
            address: CONTRACTS.GHOST_LENDING,
            abi: GHOST_LENDING_ABI,
            functionName: 'getHealthFactor',
            args: [id]
        })) as any
    });

    // --- Process Data ---

    const btcPriceRaw = priceData ? priceData[1] : BigInt(0);
    const btcDecimals = priceDecimals || 8;
    const btcPrice = Number(formatUnits(btcPriceRaw, btcDecimals));

    let totalCollateralBTC = 0;
    let totalDebtGUSD = 0;

    // Process vaults
    const realVaults = vaultIds.map((id, index) => {
        const positionResult = vaultPositions?.[index];
        const healthResult = healthFactors?.[index];

        if (!positionResult || positionResult.status !== 'success' || !healthResult || healthResult.status !== 'success') return null;

        const position = positionResult.result as any; // positions return tuple
        const health = healthResult.result as bigint;

        // Position structure: [vaultId, user, collateralBTC, debtAmount, lastUpdate, accruedInterest, active]
        const btcAmount = Number(formatUnits(position[2], 8)); // Assuming 8 decimals for BTC
        const debt = Number(formatUnits(position[3], 18)); // gUSD is 18 decimals
        const hf = Number(formatUnits(health, 18)); // Assuming 18 decimals for Health Factor

        totalCollateralBTC += btcAmount;
        totalDebtGUSD += debt;

        return {
            id,
            btcAmount: btcAmount.toFixed(4),
            debtAmount: debt.toFixed(2),
            healthFactor: hf,
            status: position[6] ? 'active' : 'closed'
        };
    }).filter((v): v is NonNullable<typeof v> => v !== null);

    const totalBTCValue = totalCollateralBTC * btcPrice;

    // Global Health Factor (Minimum of all vaults or Safe if no debt)
    const minHealthFactor = realVaults.length > 0 && totalDebtGUSD > 0
        ? Math.min(...realVaults.map(v => v.healthFactor))
        : (totalDebtGUSD === 0 ? 999 : 0); // 999 for Safe if no debt

    const stats = {
        totalBTC: totalCollateralBTC.toFixed(4),
        totalBTCValue: `$${totalBTCValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
        totalDebt: totalDebtGUSD.toFixed(2),
        healthFactor: minHealthFactor,
        btcPrice: `$${btcPrice.toLocaleString()}`
    };

    const getHealthColor = (hf: number) => {
        if (hf >= 999) return 'text-green-400';
        if (hf >= 2) return 'text-green-400';
        if (hf >= 1.5) return 'text-yellow-400';
        return 'text-red-400';
    };


    const [unlockingId, setUnlockingId] = useState<string | null>(null);
    const [selectedUtxo, setSelectedUtxo] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    const handleUnlockBTC = async (vaultId: string) => {
        if (!btcWallet.isConnected) {
            setError('Please connect your Bitcoin wallet first');
            return;
        }

        if (!selectedUtxo) {
            setError('Please select a funding UTXO for transaction fees');
            return;
        }

        try {
            setUnlockingId(vaultId);
            setError(null);

            const utxo = btcWallet.utxos.find(u => `${u.txid}:${u.vout}` === selectedUtxo);
            if (!utxo) throw new Error('Selected UTXO not found');

            // 1. Get Unlock PSBT from backend
            const response = await fetch(`${API_URL}/api/cast`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    spellName: 'unlock-vault.yaml',
                    fundingUtxo: selectedUtxo,
                    fundingUtxoValue: utxo.value,
                    changeAddress: btcWallet.address,
                    params: {
                        VAULT_ID: vaultId,
                        OWNER_PUBKEY: btcWallet.address,
                    }
                })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Failed to get unlock transaction');
            }
            const data = await response.json();

            // 2. Sign and Broadcast
            const signed = await btcWallet.signPsbt(data.psbt);
            const txid = await btcWallet.broadcastPsbt(signed);

            alert(`Unlock transaction broadcasted! TXID: ${txid}`);
            window.location.reload();
        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Failed to unlock BTC');
        } finally {
            setUnlockingId(null);
        }
    };

    const getHealthLabel = (hf: number) => {
        if (hf >= 999) return 'Safe';
        if (hf >= 2) return 'Healthy';
        if (hf >= 1.5) return 'Caution';
        return 'At Risk';
    };

    return (
        <div className="max-w-7xl mx-auto space-y-8">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-400">
                    <p>Manage your Bitcoin lending positions</p>
                    {address && (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-500/10 rounded-md border border-blue-500/20">
                            <span className="w-2 h-2 rounded-full bg-blue-500" />
                            <span className="font-mono text-blue-300">EVM: {address.slice(0, 6)}...{address.slice(-4)}</span>
                        </div>
                    )}
                    {btcWallet.address && (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-btc/10 rounded-md border border-btc/20">
                            <span className="w-2 h-2 rounded-full bg-btc" />
                            <span className="font-mono text-btc">BTC: {btcWallet.address.slice(0, 6)}...{btcWallet.address.slice(-4)}</span>
                        </div>
                    )}
                </div>
            </div>

            {error && (
                <div className="bg-red-500/20 border border-red-500/50 text-red-200 p-4 rounded-xl">
                    {error}
                </div>
            )}

            {!address && btcWallet.isConnected && (
                <div className="bg-amber-500/10 border border-amber-500/30 text-amber-200 p-4 rounded-xl flex items-center gap-4">
                    <span className="text-2xl">⚠️</span>
                    <div>
                        <p className="font-semibold text-amber-400">EVM Wallet Disconnected</p>
                        <p className="text-sm text-amber-200/70">Connect your EVM wallet (MetaMask) to view your on-chain vaults and manage loans. GhostYield uses EVM NFTs to represent your Bitcoin collateral.</p>
                        <div className="mt-2">
                            <ConnectButton />
                        </div>
                    </div>
                </div>
            )}

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="card">
                    <p className="text-gray-400 text-sm mb-1">Total Collateral</p>
                    <p className="text-2xl font-bold text-btc">{stats.totalBTC} BTC</p>
                    <p className="text-gray-500 text-sm">{stats.totalBTCValue}</p>
                </div>

                <div className="card">
                    <p className="text-gray-400 text-sm mb-1">Total Borrowed</p>
                    <p className="text-2xl font-bold text-ghost-400">{stats.totalDebt} gUSD</p>
                    <p className="text-gray-500 text-sm">Global LTV</p>
                </div>

                <div className="card">
                    <p className="text-gray-400 text-sm mb-1">Min Health Factor</p>
                    <p className={`text-2xl font-bold ${getHealthColor(stats.healthFactor)}`}>
                        {stats.healthFactor >= 999 ? '∞' : stats.healthFactor.toFixed(2)}
                    </p>
                    <p className="text-gray-500 text-sm">{getHealthLabel(stats.healthFactor)}</p>
                </div>

                <div className="card">
                    <p className="text-gray-400 text-sm mb-1">BTC Price</p>
                    <p className="text-2xl font-bold">{stats.btcPrice}</p>
                    <p className="text-gray-500 text-sm">via Chainlink</p>
                </div>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Link to="/vault" className="card hover:border-btc/50 transition-colors group">
                    <div className="flex items-center gap-4">
                        <span className="text-4xl">🔐</span>
                        <div>
                            <p className="font-semibold group-hover:text-btc transition-colors">Create Vault</p>
                            <p className="text-gray-400 text-sm">Lock BTC as collateral</p>
                        </div>
                    </div>
                </Link>

                <Link to="/borrow" className="card hover:border-ghost-500/50 transition-colors group">
                    <div className="flex items-center gap-4">
                        <span className="text-4xl">💵</span>
                        <div>
                            <p className="font-semibold group-hover:text-ghost-400 transition-colors">Borrow</p>
                            <p className="text-gray-400 text-sm">Get gUSD against BTC</p>
                        </div>
                    </div>
                </Link>

                <Link to="/lend" className="card hover:border-purple-500/50 transition-colors group">
                    <div className="flex items-center gap-4">
                        <span className="text-4xl">📈</span>
                        <div>
                            <p className="font-semibold group-hover:text-purple-400 transition-colors">Earn Yield</p>
                            <p className="text-gray-400 text-sm">Deposit USDC, earn APY</p>
                        </div>
                    </div>
                </Link>
            </div>

            {/* Vaults List */}
            <div>
                <h2 className="text-xl font-bold mb-4">Your Vaults</h2>

                {realVaults.length === 0 ? (
                    <div className="card text-center py-12">
                        <span className="text-6xl mb-4 block">👻</span>
                        <p className="text-gray-400 mb-4">
                            {(userVaultIds as any)?.length > 0
                                ? "Loading vaults..."
                                : "No vaults found on-chain"}
                        </p>
                        <Link to="/vault" className="btn-primary inline-block">
                            Create Your First Vault
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {realVaults.map((vault, i) => (
                            <div key={i} className="card flex items-center justify-between">
                                <div className="flex items-center gap-6">
                                    <div>
                                        <p className="text-sm text-gray-400">Vault ID</p>
                                        <p className="font-mono">{vault.id.slice(0, 10)}...</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-400">Collateral</p>
                                        <p className="font-bold text-btc">{vault.btcAmount} BTC</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-400">Debt</p>
                                        <p className="font-bold text-ghost-400">{vault.debtAmount} gUSD</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-400">Health</p>
                                        <p className={`font-bold ${getHealthColor(vault.healthFactor)}`}>
                                            {vault.healthFactor >= 999 ? '∞' : vault.healthFactor.toFixed(2)}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    {vault.status === 'closed' ? (
                                        <div className="flex flex-col gap-2">
                                            <select
                                                className="input text-xs py-1"
                                                value={selectedUtxo}
                                                onChange={(e) => setSelectedUtxo(e.target.value)}
                                            >
                                                <option value="">Select funding UTXO...</option>
                                                {btcWallet.utxos.map(u => (
                                                    <option key={`${u.txid}:${u.vout}`} value={`${u.txid}:${u.vout}`}>
                                                        {u.value} sats ({u.txid.slice(0, 8)}...)
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={() => handleUnlockBTC(vault.id)}
                                                disabled={unlockingId === vault.id || !selectedUtxo}
                                                className="btn-primary text-sm py-2 px-4 !bg-btc !border-btc hover:!bg-btc/80 disabled:opacity-50"
                                            >
                                                {unlockingId === vault.id ? 'Unlocking...' : '🔓 Unlock BTC'}
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex gap-2">
                                            <Link to="/borrow" className="btn-secondary text-sm py-2 px-4">
                                                Borrow
                                            </Link>
                                            <Link to="/repay" className="btn-primary text-sm py-2 px-4">
                                                Repay
                                            </Link>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}