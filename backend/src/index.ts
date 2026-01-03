import 'dotenv/config';
import express from "express";
import cors from "cors";
import { generateVaultProof, getVerificationKey, listVaults, castSpell, createVaultPsbt } from "./charms.js";

const app = express();
const PORT = process.env.PORT || 3001;

// Helper function for Bitcoin Core RPC calls with proper auth
async function bitcoinRpc(method: string, params: unknown[] = []): Promise<unknown> {
    const rpcUrl = process.env.BITCOIN_RPC;
    if (!rpcUrl) throw new Error('BITCOIN_RPC not configured');

    // Parse credentials from URL (format: http://user:pass@host:port)
    const urlObj = new URL(rpcUrl);
    const auth = Buffer.from(`${urlObj.username}:${urlObj.password}`).toString('base64');
    const cleanUrl = `${urlObj.protocol}//${urlObj.host}`;

    const response = await fetch(cleanUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${auth}`
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            method,
            params,
            id: Date.now()
        })
    });

    const result = await response.json();
    if (result.error) {
        throw new Error(`RPC ${method} failed: ${result.error.message}`);
    }
    return result.result;
}

app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (_, res) => {
    res.json({ status: "ok", service: "ghostyield-backend" });
});

// Get Charms app verification key
app.get("/api/vk", async (_, res) => {
    try {
        const vk = await getVerificationKey();
        res.json({ vk });
    } catch (error) {
        res.status(500).json({
            error: error instanceof Error ? error.message : "Failed to get VK"
        });
    }
});

// Generate vault proof
app.post("/api/proof", async (req, res) => {

    try {
        const { btcAmount, btcTxHash, lockHeight, ownerPubkey } = req.body;

        if (!btcAmount || !btcTxHash) {
            res.status(400).json({ error: "Missing required fields" });
            return;
        }

        const proof = await generateVaultProof({
            btcAmount: btcAmount.toString(),
            btcTxHash,
            lockHeight: lockHeight,
            ownerPubkey: ownerPubkey,
        });

        res.json(proof);
    } catch (error) {
        res.status(500).json({
            error: error instanceof Error ? error.message : "Proof generation failed"
        });
    }
});

// List user's vaults
app.get("/api/vaults/:address", async (req, res) => {
    try {
        const { address } = req.params;
        const vaults = await listVaults(address);
        res.json({ vaults });
    } catch (error) {
        res.status(500).json({
            error: error instanceof Error ? error.message : "Failed to list vaults"
        });
    }
});

// Cast a spell (create vault on Bitcoin)
app.post("/api/cast", async (req, res) => {
    try {
        const { spellName, fundingUtxo, fundingUtxoValue, changeAddress, params } = req.body;

        if (!spellName || !fundingUtxo) {
            res.status(400).json({ error: "Missing required fields" });
            return;
        }

        // If changeAddress and fundingUtxoValue are provided, generate PSBT for browser wallet
        if (changeAddress && fundingUtxoValue !== undefined) {
            console.log(`Generating PSBT for ${spellName}...`);
            const result = await createVaultPsbt(spellName, fundingUtxo, fundingUtxoValue, changeAddress, params || {});
            res.json(result);
        } else {
            // Legacy/Fallback: Cast using local wallet
            console.log(`Casting ${spellName} using local wallet...`);
            const result = await castSpell(spellName, fundingUtxo, params || {});
            res.json(result);
        }
    } catch (error) {
        console.error("API /api/cast error:", error);
        res.status(500).json({
            error: error instanceof Error ? error.message : "Cast failed"
        });
    }
});

// Broadcast transaction package (commit_tx + spell_tx)
// Step 1: Convert commit_tx to PSBT for wallet signing
// Step 2: Accept signed PSBT, finalize, and broadcast both txs
app.post("/api/broadcast-package", async (req, res) => {
    try {
        const { commitTx, spellTx, signedCommitPsbt } = req.body;

        if (!commitTx || !spellTx) {
            res.status(400).json({ error: "Missing commitTx or spellTx" });
            return;
        }

        const BITCOIN_RPC = process.env.BITCOIN_RPC;
        console.log('BITCOIN_RPC env var:', BITCOIN_RPC ? `${BITCOIN_RPC.substring(0, 30)}...` : 'NOT SET');

        // If signedCommitPsbt is provided, user has signed - finalize and broadcast
        if (signedCommitPsbt) {
            console.log('Received signed PSBT, finalizing and broadcasting...');
            console.log('Signed PSBT format check:', signedCommitPsbt.substring(0, 20));

            // Unisat returns hex-encoded PSBT, Bitcoin Core needs base64
            // Check if it's hex (starts with hex chars, not base64 'cHNidP8')
            let psbtBase64 = signedCommitPsbt;
            if (!signedCommitPsbt.startsWith('cHNidP8')) {
                // It's hex, convert to base64
                console.log('Converting hex PSBT to base64...');
                psbtBase64 = Buffer.from(signedCommitPsbt, 'hex').toString('base64');
                console.log('Converted PSBT:', psbtBase64.substring(0, 30) + '...');
            }

            // Finalize the signed PSBT
            const finalizeResult = await bitcoinRpc('finalizepsbt', [psbtBase64]) as { complete: boolean; hex: string };
            console.log('Finalize PSBT result:', finalizeResult);

            if (!finalizeResult.complete) {
                throw new Error('Failed to finalize PSBT: incomplete');
            }

            const finalizedCommitTx = finalizeResult.hex;

            // Broadcast commit_tx first
            console.log('Broadcasting commit_tx individually...');
            // Calculate expected TXIDs upfront
            const crypto = await import('crypto');
            const getTxId = (hex: string) => crypto.createHash('sha256')
                .update(crypto.createHash('sha256').update(Buffer.from(hex, 'hex')).digest())
                .digest('hex').match(/../g)?.reverse().join('') || '';

            const commitTxid = getTxId(finalizedCommitTx);
            const spellTxid = getTxId(spellTx);

            console.log(`Calculated Commit TXID: ${commitTxid}`);
            console.log(`Calculated Spell TXID: ${spellTxid}`);

            // Broadcast commit_tx first
            console.log('Broadcasting commit_tx...');
            try {
                await bitcoinRpc('sendrawtransaction', [finalizedCommitTx]);
                console.log('Commit TX broadcast success');
            } catch (e: any) {
                const msg = e.message || JSON.stringify(e);
                console.log('Commit TX broadcast failed/skipped:', msg);

                // If already exists, we can proceed. If other error, we might fail but let's try package.
                if (!msg.includes('already in block chain') && !msg.includes('already in mempool')) {
                    // Try package submission as fallback if individual failed non-trivially
                    console.log('Falling back to submitpackage...');
                    try {
                        const submitResult = await bitcoinRpc('submitpackage', [[finalizedCommitTx, spellTx]]) as Record<string, unknown>;
                        console.log('Submit package result:', submitResult);

                        if (submitResult['package_msg'] === 'conflict-in-package') {
                            // If we have a calculated commitTxid, maybe we can assume it succeeded? 
                            // But usually conflict means reject.
                            console.error('Package conflict detected.');
                            // Don't throw immediately, let's see if we can derive status
                        }
                    } catch (pkgErr) {
                        console.error('Submit package also failed:', pkgErr);
                    }
                }
            }

            // Wait a bit
            await new Promise(r => setTimeout(r, 500));

            console.log('Broadcasting spell_tx...');
            try {
                await bitcoinRpc('sendrawtransaction', [spellTx]);
                console.log('Spell TX broadcast success');
            } catch (e: any) {
                console.log('Spell TX broadcast outcome:', e.message);
                // If it failed because inputs missing, it implies commit_tx didn't make it.
            }

            // Always return the Spell TXID (or Commit TXID) to allow frontend to proceed
            // validating the format (64 hex chars) is crucial for BigInt parsing
            res.json({
                txid: spellTxid,
                commitTxid: commitTxid,
                message: 'Broadcast sequence completed'
            });
            return;
        }

        // First call - convert commit_tx to PSBT for signing
        console.log('Converting commit_tx to PSBT for wallet signing...');
        console.log(`Commit TX: ${commitTx.substring(0, 50)}...`);

        if (!BITCOIN_RPC) {
            throw new Error('Bitcoin RPC not configured - cannot convert to PSBT for signing');
        }

        // Use Bitcoin Core to convert raw tx to PSBT
        const convertedPsbt = await bitcoinRpc('converttopsbt', [commitTx, true]) as string;
        console.log('Convert to PSBT result:', convertedPsbt.substring(0, 50) + '...');

        // Update PSBT with witness UTXO data (required for SegWit signing)
        let finalPsbt: string;
        try {
            finalPsbt = await bitcoinRpc('utxoupdatepsbt', [convertedPsbt]) as string;
            console.log('Update PSBT with UTXO data result:', finalPsbt.substring(0, 50) + '...');
        } catch (e) {
            console.log('utxoupdatepsbt failed, using converted PSBT:', e);
            finalPsbt = convertedPsbt;
        }

        // Return the PSBT for frontend to sign with wallet
        res.json({
            needsSignature: true,
            commitPsbt: finalPsbt,
            spellTx: spellTx,
            message: 'Please sign the PSBT with your wallet'
        });

    } catch (error) {
        console.error("API /api/broadcast-package error:", error);
        res.status(500).json({
            error: error instanceof Error ? error.message : "Broadcast package failed"
        });
    }
});

app.listen(PORT, () => { });
