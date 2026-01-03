import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import { CONTRACTS, GHOST_LENDING_ABI, ERC20_ABI } from '../config/contracts';

export default function Repay() {
    const { address } = useAccount();
    const [repayAmount, setRepayAmount] = useState('');
    const [selectedVaultId, setSelectedVaultId] = useState<string>('');

    // 1. Get User Vaults
    const { data: userVaultIds } = useReadContract({
        address: CONTRACTS.GHOST_LENDING,
        abi: GHOST_LENDING_ABI,
        functionName: 'getUserVaults',
        args: address ? [address] : undefined,
    });

    // Select first vault by default
    useEffect(() => {
        if (userVaultIds && (userVaultIds as string[]).length > 0 && !selectedVaultId) {
            setSelectedVaultId((userVaultIds as string[])[0]);
        }
    }, [userVaultIds]);

    // 2. Get Vault Position (Debt)
    const { data: positionData, refetch: refetchPosition } = useReadContract({
        address: CONTRACTS.GHOST_LENDING,
        abi: GHOST_LENDING_ABI,
        functionName: 'positions',
        args: selectedVaultId ? [selectedVaultId] : undefined,
        query: { enabled: !!selectedVaultId }
    });

    // 3. GhostUSD Balance & Allowance
    const { data: gUSDBalanceData, refetch: refetchBalance } = useReadContract({
        address: CONTRACTS.GHOST_USD,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: address ? [address] : undefined,
    });

    const { data: gUSDAllowanceData, refetch: refetchGUSDAllowance } = useReadContract({
        address: CONTRACTS.GHOST_USD,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: address ? [address, CONTRACTS.GHOST_LENDING] : undefined,
    });



    // Process Data
    let vault = {
        currentDebt: 0,
        accruedInterest: 0,
        totalDebt: 0
    };

    if (positionData) {
        const pos = positionData as any;
        const debt = Number(formatUnits(pos[3], 18));
        const interest = Number(formatUnits(pos[5], 18));
        vault = {
            currentDebt: debt,
            accruedInterest: interest,
            totalDebt: debt + interest
        };
    }

    const gUSDBalance = gUSDBalanceData ? Number(formatUnits(gUSDBalanceData as bigint, 18)) : 0;
    const gUSDAllowance = gUSDAllowanceData ? Number(formatUnits(gUSDAllowanceData as bigint, 18)) : 0;

    const amountToRepay = repayAmount ? parseFloat(repayAmount) : 0;
    const needsGUSDApproval = amountToRepay > gUSDAllowance;

    // Write Contracts
    const { writeContract, data: hash, error: writeError, isPending } = useWriteContract();
    const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
        hash,
    });

    useEffect(() => {
        if (isConfirmed) {
            refetchPosition();
            refetchBalance();
            refetchGUSDAllowance();
            setRepayAmount('');
        }
    }, [isConfirmed]);

    const handleApproveGUSD = () => {
        writeContract({
            address: CONTRACTS.GHOST_USD,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [CONTRACTS.GHOST_LENDING, parseUnits(repayAmount, 18)],
        });
    };


    const handleRepay = () => {
        if (!selectedVaultId || !repayAmount) return;
        writeContract({
            address: CONTRACTS.GHOST_LENDING,
            abi: GHOST_LENDING_ABI,
            functionName: 'repay',
            args: [selectedVaultId as `0x${string}`, parseUnits(repayAmount, 18)],
        });
    };

    return (
        <div className="max-w-2xl mx-auto space-y-8">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold mb-2">Repay Loan</h1>
                <p className="text-gray-400">Pay back your debt to reclaim your collateral</p>
            </div>

            {/* Error/Success */}
            {(writeError as any) && (
                <div className="bg-red-500/20 border border-red-500/50 text-red-200 p-4 rounded-xl">
                    Transaction failed. Please check your wallet.
                </div>
            )}
            {isConfirmed && (
                <div className="bg-green-500/20 border border-green-500/50 text-green-200 p-4 rounded-xl">
                    Transaction successful!
                </div>
            )}

            {/* Vault Selection */}
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

            {/* Debt Info */}
            <div className="card">
                <h3 className="text-lg font-semibold mb-4">Your Debt</h3>
                {selectedVaultId ? (
                    <div className="flex justify-between items-center">
                        <div className="space-y-1">
                            <p className="text-sm text-gray-400">Principal</p>
                            <p className="font-bold">{vault.currentDebt.toFixed(2)} gUSD</p>
                        </div>
                        <div className="space-y-1 text-right">
                            <p className="text-sm text-gray-400">Total Owed</p>
                            <p className="font-bold text-ghost-400">{vault.totalDebt.toFixed(2)} gUSD</p>
                        </div>
                    </div>
                ) : (
                    <p className="text-gray-500">No vault selected.</p>
                )}
            </div>

            {/* Repay Form */}
            <div className="card space-y-4">
                <div>
                    <label className="block text-sm text-gray-400 mb-2">Amount to Repay (gUSD)</label>
                    <div className="relative">
                        <input
                            type="number"
                            value={repayAmount}
                            onChange={(e) => setRepayAmount(e.target.value)}
                            placeholder="0.00"
                            className="input text-2xl"
                            min="0"
                            max={Math.min(vault.totalDebt, gUSDBalance)}
                            disabled={!selectedVaultId || vault.totalDebt <= 0}
                        />
                        <button
                            onClick={() => setRepayAmount(Math.min(vault.totalDebt, gUSDBalance).toString())}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-ghost-400 text-sm font-medium hover:text-ghost-300"
                        >
                            MAX
                        </button>
                    </div>
                    <div className="mt-2 space-y-1">
                        <p className="text-xs text-gray-500">Your gUSD Balance: {gUSDBalance.toFixed(2)}</p>
                    </div>
                </div>

                {needsGUSDApproval ? (
                    <button
                        onClick={handleApproveGUSD}
                        disabled={isPending || isConfirming || !repayAmount || parseFloat(repayAmount) <= 0}
                        className="btn-secondary w-full"
                    >
                        {isPending || isConfirming ? 'Approving...' : 'Approve gUSD'}
                    </button>
                ) : (
                    <button
                        onClick={handleRepay}
                        disabled={isPending || isConfirming || !repayAmount || parseFloat(repayAmount) <= 0 || parseFloat(repayAmount) > gUSDBalance}
                        className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isPending || isConfirming ? 'Repaying...' : 'Repay Loan'}
                    </button>
                )}
            </div>
        </div>
    );
}
