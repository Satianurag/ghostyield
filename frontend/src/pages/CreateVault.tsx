import { useState, useEffect } from 'react';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount, useChainId, useSwitchChain } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { API_URL, CONTRACTS, GHOST_LENDING_ABI, PRICE_FEED_ABI } from '../config/contracts';
import { formatUnits } from 'viem';
import { useBitcoinWallet, UTXO } from '../hooks/useBitcoinWallet';
import { usePriceFeed } from '../hooks/usePriceFeed';
import { generateProofLocal, ProofData, deriveSecret } from '../lib/zkproof';

interface CastResult {
    commitTx?: string;
    executeTx: string;
    psbt?: string;
}

type Step = 'lock' | 'casting' | 'proof' | 'create' | 'done';

export default function CreateVault() {
    const { isConnected: isEvmConnected } = useAccount();
    // Bitcoin Wallet Integration
    const btcWallet = useBitcoinWallet();
    const { price: livePrice } = usePriceFeed();
    const [selectedUtxo, setSelectedUtxo] = useState<UTXO | null>(null);

    const [btcAmount, setBtcAmount] = useState('');
    const [lockDuration, setLockDuration] = useState('30');
    const [fundingUtxo, setFundingUtxo] = useState('');
    const [ownerPubkey, setOwnerPubkey] = useState('');
    const [secret, setSecret] = useState<string | null>(null);

    const [castResult, setCastResult] = useState<CastResult | null>(null);
    const [proofData, setProofData] = useState<ProofData | null>(null);
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState<Step>('lock');
    const [error, setError] = useState<string | null>(null);
    const [proofProgress, setProofProgress] = useState('');

    // Auto-populate from Bitcoin wallet when connected
    useEffect(() => {
        if (btcWallet.isConnected && btcWallet.publicKey) {
            setOwnerPubkey(btcWallet.publicKey);
        }
    }, [btcWallet.isConnected, btcWallet.publicKey]);

    // Fetch UTXOs when wallet connects
    useEffect(() => {
        if (btcWallet.isConnected && btcWallet.address) {
            btcWallet.fetchUtxos();
        }
    }, [btcWallet.isConnected, btcWallet.address]);

    // Update fundingUtxo when UTXO is selected
    useEffect(() => {
        if (selectedUtxo) {
            setFundingUtxo(`${selectedUtxo.txid}:${selectedUtxo.vout}`);
        }
    }, [selectedUtxo]);

    const { data: priceData, isLoading: isPriceLoading } = useReadContract({
        address: CONTRACTS.PRICE_FEED,
        abi: PRICE_FEED_ABI,
        functionName: 'latestRoundData',
    });

    const { data: priceDecimals } = useReadContract({
        address: CONTRACTS.PRICE_FEED,
        abi: PRICE_FEED_ABI,
        functionName: 'decimals',
    });

    const btcDecimals = priceDecimals || 8;
    const btcPriceRaw = priceData ? (priceData as any)[1] : BigInt(0);
    const chainlinkPrice = btcPriceRaw ? Number(formatUnits(btcPriceRaw, btcDecimals)) : 0;

    // Use live price for display if available, fallback to chainlink
    const btcPrice = livePrice || chainlinkPrice;
    const estimatedValue = btcAmount ? parseFloat(btcAmount) * btcPrice : 0;
    const maxBorrow = estimatedValue * 0.5; // 50% LTV

    const stepLabels = ['Lock BTC', 'Cast Spell', 'Generate Proof', 'Create Vault'];
    const stepKeys: Step[] = ['lock', 'casting', 'proof', 'create'];

    // Step 1: Request PSBT from backend, sign with wallet, and broadcast
    const handleLockBTC = async () => {
        if (!btcAmount || !fundingUtxo) {
            setError('Please enter BTC amount and select a funding UTXO');
            return;
        }

        if (!btcWallet.isConnected) {
            setError('Please connect your Bitcoin wallet');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const lockHeight = parseInt(lockDuration) * 144; // ~144 blocks per day

            // 1. Derive Production-Grade ZK Secret
            setProofProgress('Step 1/4: Deriving secure secret via wallet signature...');
            const message = `GhostYield: Derive Secret for Vault\nBTC: ${btcAmount}\nUTXO: ${fundingUtxo}`;
            const signature = await btcWallet.signMessage(message);
            const derivedSecret = await deriveSecret(signature);
            setSecret(derivedSecret);

            // 2. Request PSBT from backend
            setProofProgress('Step 2/4: Preparing Bitcoin transaction...');
            const response = await fetch(`${API_URL}/api/cast`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    spellName: 'create-vault.yaml',
                    fundingUtxo,
                    fundingUtxoValue: selectedUtxo?.value || 0,
                    changeAddress: btcWallet.address,
                    params: {
                        BTC_AMOUNT: Math.round(parseFloat(btcAmount) * 1e8).toString(),
                        LOCK_HEIGHT: lockHeight.toString(),
                        OWNER_PUBKEY: ownerPubkey,
                        // Deterministic numeric timestamp from UTXO to prevent "different spell" error and satisfy u64 type.
                        TIMESTAMP: parseInt(fundingUtxo.split(':')[0].substring(0, 8), 16).toString(),
                    }
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to generate transaction');
            }

            const result = await response.json();
            console.log('Backend response:', result);

            // Handle two-transaction package format from Charms
            if (result.needsPackageBroadcast && result.commitTx && result.spellTx) {
                console.log('Got two-transaction package from Charms');
                console.log('Commit TX length:', result.commitTx.length);
                console.log('Spell TX length:', result.spellTx.length);

                // Step 1: Send to backend to convert commit_tx to PSBT
                setProofProgress('Preparing transaction for signing...');

                const step1Response = await fetch(`${API_URL}/api/broadcast-package`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        commitTx: result.commitTx,
                        spellTx: result.spellTx
                    })
                });

                if (!step1Response.ok) {
                    const errorData = await step1Response.json();
                    throw new Error(errorData.error || 'Failed to prepare transaction');
                }

                const step1Result = await step1Response.json();
                console.log('Step 1 result:', step1Result);

                // If needs signature, have user sign with wallet
                if (step1Result.needsSignature && step1Result.commitPsbt) {
                    console.log('PSBT needs user signature, requesting wallet sign...');
                    setProofProgress('Please sign the transaction in your Bitcoin wallet...');

                    let signedPsbt;
                    try {
                        signedPsbt = await btcWallet.signPsbt(step1Result.commitPsbt);
                        console.log('User signed PSBT successfully');
                    } catch (signError) {
                        console.error('Wallet signing failed:', signError);
                        throw new Error(`Wallet signing failed: ${signError instanceof Error ? signError.message : 'Unknown error'}`);
                    }

                    // Step 2: Send signed PSBT back to backend for finalize + broadcast
                    setProofProgress('Broadcasting signed transaction package...');

                    const step2Response = await fetch(`${API_URL}/api/broadcast-package`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            commitTx: result.commitTx,
                            spellTx: step1Result.spellTx,
                            signedCommitPsbt: signedPsbt
                        })
                    });

                    if (!step2Response.ok) {
                        const errorData = await step2Response.json();
                        throw new Error(errorData.error || 'Broadcast failed');
                    }

                    const finalResult = await step2Response.json();
                    console.log('Package broadcast successful! TXID:', finalResult.txid);

                    setCastResult({ executeTx: finalResult.txid });
                    setStep('casting');
                    setProofProgress('');
                    setLoading(false);
                    return;
                }

                // Direct broadcast succeeded (txid returned)
                if (step1Result.txid) {
                    console.log('Direct broadcast successful! TXID:', step1Result.txid);
                    setCastResult({ executeTx: step1Result.txid });
                    setStep('casting');
                    setProofProgress('');
                    setLoading(false);
                    return;
                }

                throw new Error('Unexpected response from broadcast endpoint');
            }

            // Fallback for legacy PSBT format
            if (!result.psbt) {
                throw new Error('Backend did not return a valid transaction format');
            }

            // 2. Sign PSBT with wallet
            console.log('Attempting to sign PSBT, length:', result.psbt.length);
            setProofProgress('Please sign the transaction in your Bitcoin wallet...');

            let signedPsbt;
            try {
                signedPsbt = await btcWallet.signPsbt(result.psbt);
                console.log('Signed PSBT successfully, length:', signedPsbt.length);
            } catch (signError) {
                console.error('Sign PSBT failed:', signError);
                throw new Error(`Signing failed: ${signError instanceof Error ? signError.message : 'Unknown signing error'}`);
            }

            // 3. Broadcast transaction
            console.log('Attempting to broadcast signed PSBT...');
            setProofProgress('Broadcasting transaction to Bitcoin testnet4...');

            let txid;
            try {
                txid = await btcWallet.broadcastPsbt(signedPsbt);
                console.log('Broadcast successful! TXID:', txid);
            } catch (broadcastError) {
                console.error('Broadcast failed:', broadcastError);
                throw new Error(`Broadcast failed: ${broadcastError instanceof Error ? broadcastError.message : 'Unknown broadcast error'}`);
            }

            setCastResult({ executeTx: txid });
            setStep('casting');
            setProofProgress('');
            setLoading(false);
        } catch (err) {
            console.error('Full error:', err);
            setError(err instanceof Error ? err.message : 'Failed to process transaction');
            setProofProgress('');
            setLoading(false);
        } finally {
            // setLoading is handled inside catch/success to avoid premature clearing
        }
    };

    // Step 2: Generate ZK proof locally using snarkjs WASM
    // proofProgress moved up

    const handleGenerateProof = async () => {
        if (!castResult) {
            setError('Cast spell first');
            return;
        }

        setLoading(true);
        setError(null);
        setProofProgress('Initializing proof generation...');

        try {
            setProofProgress('Step 3/4: Generating ZK proof locally...');

            // Generate proof locally in the browser using snarkjs
            const proof = await generateProofLocal({
                btcAmount: Math.round(parseFloat(btcAmount) * 1e8).toString(),
                btcTxHash: castResult.executeTx,
                ownerSecret: secret || ownerPubkey, // Fallback to pubkey if secret derivation failed
                lockHeight: parseInt(lockDuration) * 144,
            });

            setProofProgress('Proof generated successfully!');
            setProofData(proof);
            setStep('proof');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to generate proof');
        } finally {
            setLoading(false);
            setProofProgress('');
        }
    };

    const { writeContract, data: hash, error: writeError } = useWriteContract();
    const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
        hash,
    });

    const chainId = useChainId();
    const { switchChainAsync } = useSwitchChain();

    // Step 3: Create vault on Base using the proof
    const handleCreateVault = async () => {
        if (!proofData) {
            setError('Generate proof first');
            return;
        }

        setLoading(true);
        setError(null);

        // Ensure we are on the correct chain (Base Sepolia)
        // This avoids internal "getChainId" calls that might fail in some connector versions
        if (chainId !== 84532) {
            try {
                console.log('Switching chain to 84532...');
                await switchChainAsync({ chainId: 84532 });
                // We return here because the chain switch might cause a re-render/re-connection
                // Users will click "Create Vault" again once on the right chain
                setLoading(false);
                return;
            } catch (switchError) {
                console.error('Failed to switch chain:', switchError);
                setError('Please switch your wallet to Base Sepolia testnet');
                setLoading(false);
                return;
            }
        }

        try {
            writeContract({
                address: CONTRACTS.GHOST_LENDING,
                abi: GHOST_LENDING_ABI,
                functionName: 'createVault',
                args: [
                    [BigInt(proofData.a[0]), BigInt(proofData.a[1])],
                    [
                        [BigInt(proofData.b[0][0]), BigInt(proofData.b[0][1])],
                        [BigInt(proofData.b[1][0]), BigInt(proofData.b[1][1])]
                    ],
                    [BigInt(proofData.c[0]), BigInt(proofData.c[1])],
                    [BigInt(proofData.input[0]), BigInt(proofData.input[1])],
                    proofData.vaultId as `0x${string}`
                ],
                chainId: 84532,
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create vault');
            setLoading(false);
        }
    };

    // Update step when confirmed
    if (isConfirmed && step !== 'done') {
        setStep('done');
        setLoading(false);
    }

    const getCurrentStepIndex = () => {
        return stepKeys.indexOf(step === 'done' ? 'create' : step);
    };

    return (
        <div className="max-w-2xl mx-auto space-y-8">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold mb-2">Create Vault</h1>
                <p className="text-gray-400">Lock BTC on Bitcoin to use as collateral on Base</p>
            </div>

            {!isEvmConnected && btcWallet.isConnected && (
                <div className="bg-amber-500/10 border border-amber-500/30 text-amber-200 p-4 rounded-xl flex items-center gap-4">
                    <span className="text-2xl">⚠️</span>
                    <div>
                        <p className="font-semibold text-amber-400">EVM Wallet Required</p>
                        <p className="text-sm text-amber-200/70">You must connect your EVM wallet (MetaMask) to mint the Vault NFT on-chain after locking your BTC.</p>
                        <div className="mt-2">
                            <ConnectButton />
                        </div>
                    </div>
                </div>
            )}

            {/* Progress Steps */}
            <div className="flex items-center justify-between">
                {stepLabels.map((label, i) => (
                    <div key={i} className="flex items-center">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${i <= getCurrentStepIndex()
                            ? 'bg-btc text-black'
                            : 'bg-white/10 text-gray-500'
                            }`}>
                            {i <= getCurrentStepIndex() - 1 ? '✓' : i + 1}
                        </div>
                        <span className={`ml-2 text-sm ${i <= getCurrentStepIndex() ? 'text-white' : 'text-gray-500'
                            }`}>
                            {label}
                        </span>
                        {i < 3 && <div className="w-8 h-0.5 bg-white/10 mx-2" />}
                    </div>
                ))}
            </div>

            {/* Error */}
            {(error || writeError) && (
                <div className="bg-red-500/20 border border-red-500/50 text-red-200 p-4 rounded-xl">
                    {error || writeError?.message}
                </div>
            )}

            {/* Step 1: Lock BTC */}
            {step === 'lock' && (
                <div className="card space-y-6">
                    <div className="bg-btc/10 border border-btc/30 rounded-xl p-4">
                        <h3 className="text-btc font-semibold mb-2">🔐 Step 1: Lock BTC on Bitcoin</h3>
                        <p className="text-sm text-gray-300">
                            This will create a time-locked vault on Bitcoin using Charms Protocol.
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-2">BTC Amount to Lock</label>
                        <input
                            type="number"
                            step="0.00000001"
                            min="0"
                            value={btcAmount}
                            onChange={(e) => setBtcAmount(e.target.value)}
                            className="input text-2xl"
                            placeholder="0.00"
                        />
                        {btcAmount && (
                            <p className="text-sm text-gray-500 mt-2">
                                {isPriceLoading ? (
                                    <span className="animate-pulse">Fetching BTC price...</span>
                                ) : btcPrice > 0 ? (
                                    <>≈ ${estimatedValue.toLocaleString()} • Max borrow: ${maxBorrow.toLocaleString()} gUSD</>
                                ) : (
                                    <span className="text-red-400">Price feed unavailable</span>
                                )}
                            </p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-2">
                            Funding UTXO
                            {btcWallet.isConnected && (
                                <button
                                    onClick={() => btcWallet.fetchUtxos()}
                                    className="ml-2 text-ghost-400 hover:text-ghost-300 text-xs"
                                >
                                    🔄 Refresh
                                </button>
                            )}
                        </label>

                        {btcWallet.isConnected && btcWallet.utxos.length > 0 ? (
                            <div className="space-y-2">
                                <select
                                    value={selectedUtxo ? `${selectedUtxo.txid}:${selectedUtxo.vout}` : ''}
                                    onChange={(e) => {
                                        const utxo = btcWallet.utxos.find(
                                            u => `${u.txid}:${u.vout}` === e.target.value
                                        );
                                        setSelectedUtxo(utxo || null);
                                    }}
                                    className="input font-mono text-sm"
                                >
                                    <option value="">Select a UTXO from your wallet</option>
                                    {btcWallet.utxos.map((utxo) => (
                                        <option key={`${utxo.txid}:${utxo.vout}`} value={`${utxo.txid}:${utxo.vout}`}>
                                            {utxo.txid.slice(0, 8)}...:{utxo.vout} ({(utxo.value / 1e8).toFixed(8)} BTC)
                                        </option>
                                    ))}
                                </select>
                                {selectedUtxo && (
                                    <p className="text-xs text-green-400">
                                        ✓ Selected: {(selectedUtxo.value / 1e8).toFixed(8)} BTC available
                                    </p>
                                )}
                            </div>
                        ) : btcWallet.isConnected && btcWallet.utxos.length === 0 ? (
                            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                                <p className="text-sm text-yellow-300">
                                    No UTXOs found. Get testnet4 BTC from{' '}
                                    <a
                                        href="https://mempool.space/testnet4/faucet"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="underline"
                                    >
                                        mempool.space faucet
                                    </a>
                                </p>
                            </div>
                        ) : (
                            <div>
                                <input
                                    type="text"
                                    value={fundingUtxo}
                                    onChange={(e) => setFundingUtxo(e.target.value)}
                                    className="input font-mono text-sm"
                                    placeholder="txid:vout (e.g., abc123...def:0)"
                                />
                                <p className="text-xs text-yellow-400 mt-2">
                                    💡 Connect your Bitcoin wallet for easier UTXO selection
                                </p>
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-2">Lock Duration</label>
                        <select
                            value={lockDuration}
                            onChange={(e) => setLockDuration(e.target.value)}
                            className="input"
                        >
                            <option value="7">7 days</option>
                            <option value="30">30 days</option>
                            <option value="90">90 days</option>
                            <option value="180">180 days</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-2">
                            Owner Public Key
                            {btcWallet.isConnected && (
                                <span className="ml-2 text-green-400 text-xs">✓ Auto-filled from Wallet</span>
                            )}
                        </label>
                        <input
                            type="text"
                            value={ownerPubkey}
                            readOnly
                            className={`input font-mono text-sm cursor-not-allowed opacity-70 ${btcWallet.isConnected ? 'border-green-500/30 bg-green-500/5' : ''}`}
                            placeholder="Recipient Bitcoin local public key"
                        />
                    </div>

                    <button
                        onClick={handleLockBTC}
                        disabled={loading || !btcAmount || !fundingUtxo}
                        className="btn-primary w-full disabled:opacity-50"
                    >
                        {loading ? (proofProgress || 'Processing...') : '🔮 Lock BTC with Wallet'}
                    </button>
                    {proofProgress && (
                        <p className="text-center text-sm text-btc animate-pulse mt-2">
                            {proofProgress}
                        </p>
                    )}
                </div>
            )}

            {/* Step 2: Casting Complete */}
            {step === 'casting' && castResult && (
                <div className="card space-y-6">
                    <div className="bg-green-500/20 border border-green-500/50 rounded-xl p-4">
                        <h3 className="text-green-400 font-semibold mb-2">✓ BTC Locked on Bitcoin!</h3>
                        <p className="text-sm text-gray-300">
                            Your {btcAmount} BTC is now locked in a Charms vault.
                        </p>
                    </div>

                    <div className="bg-white/5 rounded-xl p-4 space-y-3">
                        <div>
                            <span className="text-xs text-gray-500 block">Commit Transaction</span>
                            <a
                                href={`https://mempool.space/testnet/tx/${castResult.commitTx}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-sm text-btc break-all hover:underline flex items-center gap-2"
                            >
                                {castResult.commitTx}
                                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                            </a>
                        </div>
                        <div>
                            <span className="text-xs text-gray-500 block">Execute Transaction</span>
                            <a
                                href={`https://mempool.space/testnet/tx/${castResult.executeTx}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-sm text-btc break-all hover:underline flex items-center gap-2"
                            >
                                {castResult.executeTx}
                                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                            </a>
                        </div>
                    </div>

                    {proofProgress && (
                        <div className="bg-ghost-500/20 border border-ghost-500/50 rounded-xl p-4 mb-4">
                            <div className="flex items-center gap-3">
                                <div className="animate-spin w-5 h-5 border-2 border-ghost-400 border-t-transparent rounded-full" />
                                <span className="text-ghost-400">{proofProgress}</span>
                            </div>
                            <p className="text-xs text-gray-500 mt-2">
                                Generating ZK proof locally in your browser (15-30 seconds)...
                            </p>
                        </div>
                    )}

                    <button
                        onClick={handleGenerateProof}
                        disabled={loading}
                        className="btn-primary w-full disabled:opacity-50"
                    >
                        {loading ? proofProgress || 'Generating Proof...' : '🔒 Generate ZK Proof Locally'}
                    </button>
                </div>
            )}

            {/* Step 3: Proof Ready */}
            {step === 'proof' && proofData && (
                <div className="card space-y-6">
                    <div className="bg-green-500/20 border border-green-500/50 rounded-xl p-4">
                        <h3 className="text-green-400 font-semibold mb-2">✓ ZK Proof Generated!</h3>
                        <p className="text-sm text-gray-300">
                            Your proof is ready. Now create the vault on Base.
                        </p>
                    </div>

                    <div className="bg-white/5 rounded-xl p-4 space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-400">Vault ID</span>
                            <span className="font-mono">{proofData.vaultId.slice(0, 10)}...{proofData.vaultId.slice(-8)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-400">BTC Locked</span>
                            <span className="text-btc font-bold">{btcAmount} BTC</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-400">Collateral Value</span>
                            <span>${estimatedValue.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-400">Max Borrow</span>
                            <span className="text-ghost-400 font-bold">${maxBorrow.toLocaleString()} gUSD</span>
                        </div>
                    </div>

                    <button
                        onClick={handleCreateVault}
                        disabled={loading || isConfirming}
                        className="btn-primary w-full disabled:opacity-50"
                    >
                        {loading ? 'Creating Vault...' : isConfirming ? 'Confirming Transaction...' : '🚀 Create Vault on Base'}
                    </button>
                </div>
            )}

            {/* Step 4: Done */}
            {step === 'done' && (
                <div className="card text-center py-12">
                    <span className="text-6xl mb-4 block">🎉</span>
                    <h2 className="text-2xl font-bold mb-2">Vault Created!</h2>
                    <p className="text-gray-400 mb-6">
                        Your {btcAmount} BTC is now available as collateral on Base
                    </p>
                    <a href="/borrow" className="btn-primary inline-block">
                        Borrow gUSD →
                    </a>
                </div>
            )}

            {/* Info */}
            <div className="card bg-btc/10 border-btc/20">
                <h4 className="font-semibold mb-2">🔐 How It Works</h4>
                <ul className="text-sm text-gray-300 space-y-1">
                    <li>1. <strong>Lock BTC:</strong> Cast a Charms spell to lock BTC in a time-locked vault</li>
                    <li>2. <strong>Generate Proof:</strong> Create a ZK proof of your locked BTC</li>
                    <li>3. <strong>Create Vault:</strong> Submit the proof to create a vault on Base</li>
                    <li>4. <strong>Borrow:</strong> Borrow up to 50% of your BTC value in gUSD</li>
                </ul>
            </div>
        </div>
    );
}
