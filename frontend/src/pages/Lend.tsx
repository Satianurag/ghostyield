import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import { CONTRACTS, GHOST_POOL_ABI, ERC20_ABI } from '../config/contracts';

export default function Lend() {
    const { address } = useAccount();
    const [amount, setAmount] = useState('');
    const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');

    // 1. Get Pool Stats
    const { data: poolStats, refetch: refetchPool } = useReadContract({
        address: CONTRACTS.GHOST_POOL,
        abi: GHOST_POOL_ABI,
        functionName: 'getPoolStats',
    });

    // 2. Get User USDC Balance
    const { data: usdcBalanceData, refetch: refetchUSDC } = useReadContract({
        address: CONTRACTS.USDC,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: address ? [address] : undefined,
    });

    // 3. Get User Pool Balance (Shares value)
    const { data: poolBalanceData, refetch: refetchPoolBalance } = useReadContract({
        address: CONTRACTS.GHOST_POOL,
        abi: GHOST_POOL_ABI,
        functionName: 'balanceOf',
        args: address ? [address] : undefined,
    });

    // 4. Get User Shares (needed for withdraw)
    const { data: sharesData, refetch: refetchShares } = useReadContract({
        address: CONTRACTS.GHOST_POOL,
        abi: GHOST_POOL_ABI,
        functionName: 'shares',
        args: address ? [address] : undefined,
    });

    // 5. Get Allowance
    const { data: allowanceData, refetch: refetchAllowance } = useReadContract({
        address: CONTRACTS.USDC,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: address ? [address, CONTRACTS.GHOST_POOL] : undefined,
    });

    // 6. Get Total Shares
    const { data: totalSharesData, refetch: refetchTotalShares } = useReadContract({
        address: CONTRACTS.GHOST_POOL,
        abi: GHOST_POOL_ABI,
        functionName: 'totalShares',
    });

    // Process Data
    // For localhost prototype, we use DECIMALS = 6 (Real USDC).
    const DECIMALS = 6;

    const totalDeposited = poolStats ? Number(formatUnits((poolStats as any)[0], DECIMALS)) : 0;
    const totalBorrowed = poolStats ? Number(formatUnits((poolStats as any)[1], DECIMALS)) : 0;
    const supplyAPY = poolStats ? Number((poolStats as any)[3]) / 100 : 0;

    const utilization = poolStats ? Number((poolStats as any)[2]) / 100 : 0;

    const usdcBalance = usdcBalanceData ? Number(formatUnits(usdcBalanceData as bigint, DECIMALS)) : 0;

    const userDeposited = poolBalanceData ? Number(formatUnits(poolBalanceData as bigint, DECIMALS)) : 0;
    const userShares = sharesData ? (sharesData as bigint) : BigInt(0);
    const allowance = allowanceData ? Number(formatUnits(allowanceData as bigint, DECIMALS)) : 0;

    const needsApproval = activeTab === 'deposit' && parseFloat(amount || '0') > allowance;

    // Write Contract
    const { writeContract, data: hash, error: writeError, isPending } = useWriteContract();
    const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
        hash,
    });

    useEffect(() => {
        if (isConfirmed) {
            setAmount('');
            refetchPool();
            refetchUSDC();
            refetchPoolBalance();
            refetchShares();
            refetchAllowance();
            refetchTotalShares();
        }
    }, [isConfirmed]);

    const handleAction = () => {
        if (!amount) return;

        if (activeTab === 'deposit') {
            if (needsApproval) {
                writeContract({
                    address: CONTRACTS.USDC,
                    abi: ERC20_ABI,
                    functionName: 'approve',
                    args: [CONTRACTS.GHOST_POOL, parseUnits(amount, DECIMALS)],
                });
            } else {
                writeContract({
                    address: CONTRACTS.GHOST_POOL,
                    abi: GHOST_POOL_ABI,
                    functionName: 'deposit',
                    args: [parseUnits(amount, DECIMALS)],
                });
            }
        } else {
            // Withdraw
            let sharesToWithdraw;
            const amountNum = parseFloat(amount || '0');

            // Precise check for full withdrawal
            if (amountNum >= userDeposited || amount === userDeposited.toString()) {
                sharesToWithdraw = userShares;
            } else {
                // Calculate shares = (amount * totalShares) / totalDeposited
                const totalShares = totalSharesData ? (totalSharesData as bigint) : BigInt(0);
                const totalDepositedRaw = poolStats ? (poolStats as any)[0] as bigint : BigInt(0);

                if (totalDepositedRaw > BigInt(0)) {
                    // Use BigInt for precise calculation, scaling by 1e6 (DECIMALS)
                    sharesToWithdraw = (parseUnits(amount, DECIMALS) * totalShares) / totalDepositedRaw;
                } else {
                    sharesToWithdraw = BigInt(0);
                }
            }

            // Cap at user's actual shares to prevent revert
            if (sharesToWithdraw > userShares) sharesToWithdraw = userShares;

            if (sharesToWithdraw === BigInt(0)) {
                alert("Withdrawal amount too small or invalid.");
                return;
            }

            writeContract({
                address: CONTRACTS.GHOST_POOL,
                abi: GHOST_POOL_ABI,
                functionName: 'withdraw',
                args: [sharesToWithdraw],
            });
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold mb-2">Earn Yield</h1>
                <p className="text-gray-400">Deposit USDC to earn interest from Bitcoin borrowers</p>
            </div>

            {/* Error/Success */}
            {(writeError) && (
                <div className="bg-red-500/20 border border-red-500/50 text-red-200 p-4 rounded-xl">
                    {writeError.message}
                </div>
            )}
            {isConfirmed && (
                <div className="bg-green-500/20 border border-green-500/50 text-green-200 p-4 rounded-xl">
                    Transaction successful!
                </div>
            )}


            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="card">
                    <p className="text-gray-400 text-sm mb-1">Total Deposited</p>
                    <p className="font-bold">${totalDeposited.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                </div>
                <div className="card">
                    <p className="text-gray-400 text-sm mb-1">Total Borrowed</p>
                    <p className="font-bold">${totalBorrowed.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                </div>
                <div className="card">
                    <p className="text-gray-400 text-sm mb-1">Utilization</p>
                    <p className="font-bold text-purple-400">{utilization.toFixed(2)}%</p>
                </div>
                <div className="card">
                    <p className="text-gray-400 text-sm mb-1">Supply APY</p>
                    <p className="font-bold text-green-400">{supplyAPY.toFixed(2)}%</p>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
                {/* User Position */}
                <div className="card h-fit">
                    <h3 className="text-lg font-semibold mb-4">Your Position</h3>
                    <div className="space-y-4">
                        <div>
                            <p className="text-sm text-gray-400">Deposited Balance</p>
                            <p className="text-2xl font-bold">${userDeposited.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-400">Wallet Balance</p>
                            <p className="text-xl">${usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC</p>
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="card">
                    <div className="flex gap-4 mb-6 border-b border-white/10 pb-4">
                        <button
                            onClick={() => { setActiveTab('deposit'); setAmount(''); }}
                            className={`pb-1 px-2 ${activeTab === 'deposit' ? 'text-white border-b-2 border-purple-500' : 'text-gray-500'}`}
                        >
                            Deposit
                        </button>
                        <button
                            onClick={() => { setActiveTab('withdraw'); setAmount(''); }}
                            className={`pb-1 px-2 ${activeTab === 'withdraw' ? 'text-white border-b-2 border-purple-500' : 'text-gray-500'}`}
                        >
                            Withdraw
                        </button>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm text-gray-400 mb-2">Amount</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    className="input text-2xl"
                                    placeholder="0.00"
                                    min="0"
                                />
                                <button
                                    onClick={() => setAmount(activeTab === 'deposit' ? usdcBalance.toString() : userDeposited.toString())}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-400 text-sm font-medium"
                                >
                                    MAX
                                </button>
                            </div>
                        </div>

                        {activeTab === 'deposit' && amount && (
                            <div className="bg-white/5 rounded-lg p-3 text-sm">
                                <div className="flex justify-between text-gray-400">
                                    <span>Est. Annual Earnings</span>
                                    <span className="text-green-400">+${((parseFloat(amount) * supplyAPY) / 100).toFixed(2)}</span>
                                </div>
                            </div>
                        )}

                        <button
                            onClick={handleAction}
                            disabled={isPending || isConfirming || !amount || parseFloat(amount) <= 0}
                            className="btn-primary w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isPending || isConfirming
                                ? 'Processing...'
                                : activeTab === 'deposit'
                                    ? (needsApproval ? 'Approve USDC' : 'Deposit USDC')
                                    : 'Withdraw USDC'
                            }
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}