import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs";
// @ts-ignore
import { buildPoseidon } from "circomlibjs";

let poseidon: any;
async function initPoseidon() {
    if (!poseidon) {
        poseidon = await buildPoseidon();
    }
    return poseidon;
}

function hexTo4Chunks(hex: string): bigint[] {
    const cleanHex = hex.replace(/^0x/, "").padStart(64, "0");
    const chunks: bigint[] = [];
    for (let i = 0; i < 4; i++) {
        const chunk = cleanHex.slice(i * 16, (i + 1) * 16);
        chunks.push(BigInt("0x" + chunk));
    }
    return chunks;
}

interface CharmProof {
    a: [string, string];
    b: [[string, string], [string, string]];
    c: [string, string];
    input: [string, string];
    vaultId: string;
}

interface VaultParams {
    btcAmount: string;      // In satoshis
    btcTxHash: string;      // Bitcoin transaction hash
    lockHeight: number;     // Block height to lock until
    ownerPubkey: string;    // Owner's Bitcoin public key
}

const VAULT_APP_PATH = path.resolve(process.cwd(), "../vault");
const CHARMS_BIN = process.env.CHARMS_BIN || "/home/sati/.cargo/bin/charms";

/**
 * Calculates the Vault ID (commitment) using Poseidon hash
 */
async function calculateVaultCommitment(btcTxHash: string, ownerPubkey: string, btcAmount: string) {
    const p = await initPoseidon();
    const txHashChunks = hexTo4Chunks(btcTxHash);
    const ownerSecret = ownerPubkey.startsWith("0x") ? ownerPubkey : "0x" + ownerPubkey;

    // Hash input: [txid_chunk0, txid_chunk1, txid_chunk2, txid_chunk3, owner, amount]
    const hashInput = [
        ...txHashChunks,
        BigInt(ownerSecret),
        BigInt(Math.round(parseFloat(btcAmount)))
    ];

    const commitment = p(hashInput);
    const commitmentStr = BigInt(p.F.toString(commitment)).toString(16).padStart(64, '0');
    return {
        commitmentStr,
        vaultId: "0x" + commitmentStr
    };
}

/**
 * Generates a ZK proof for a Bitcoin vault using Charms CLI
 */
export async function generateVaultProof(params: VaultParams): Promise<CharmProof> {
    const { btcAmount, btcTxHash, lockHeight, ownerPubkey } = params;
    const { commitmentStr, vaultId } = await calculateVaultCommitment(btcTxHash, ownerPubkey, btcAmount);


    // Set environment variables for Charms
    const env = {
        ...process.env,
        BTC_AMOUNT: btcAmount,
        BTC_TX_HASH: btcTxHash,
        LOCK_HEIGHT: lockHeight.toString(),
        OWNER_PUBKEY: ownerPubkey,
        APP_VK: await getVerificationKey(),
        IN_UTXO_0: btcTxHash,
        APP_ID: commitmentStr, // Charms uses hex without 0x
    };

    // Build the app first
    await runCharmsCommand(["app", "build"], env);

    // Run the spell to generate proof
    const proofOutput = await runCharmsSpell("create-vault.yaml", env);

    // Parse proof from output
    const proof = parseProofOutput(proofOutput, btcAmount, vaultId);

    return proof;
}

/**
 * Gets the verification key for the Charms app
 */
export async function getVerificationKey(binPath?: string): Promise<string> {
    const args = binPath ? ["app", "vk", binPath] : ["app", "vk"];
    const output = await runCharmsCommand(args, process.env);
    const lines = output.trim().split("\n");
    return lines[lines.length - 1].trim(); // Get the last line (actual hex)
}

/**
 * Lists all UTXOs (vaults) for a given address
 */
export async function listVaults(address: string): Promise<string[]> {
    const output = await runCharmsCommand(
        ["wallet", "list-unspent", "--address", address],
        process.env
    );

    try {
        const utxos = JSON.parse(output);
        return utxos.map((u: { txid: string; vout: number }) => `${u.txid}:${u.vout}`);
    } catch {
        return [];
    }
}

/**
 * Fetches transaction hex from local node or public API
 */
async function getTxHex(txid: string): Promise<string> {
    console.log(`Searching for hex of tx: ${txid}`);
    // Try local node first
    try {
        const rpcUrl = process.env.BITCOIN_RPC;
        if (rpcUrl) {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };

            // If URL contains credentials, use Basic Auth
            try {
                const urlObj = new URL(rpcUrl);
                if (urlObj.username && urlObj.password) {
                    const auth = Buffer.from(`${urlObj.username}:${urlObj.password}`).toString('base64');
                    headers['Authorization'] = `Basic ${auth}`;
                }
            } catch (e) {
                console.warn('Failed to parse BITCOIN_RPC for auth in getTxHex:', e);
            }

            const response = await fetch(rpcUrl, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    jsonrpc: "1.0",
                    id: "gettx",
                    method: "getrawtransaction",
                    params: [txid]
                })
            });
            const data: any = await response.json();
            if (data.result && typeof data.result === "string") {
                console.log(`Found tx hex in local node`);
                return data.result;
            }
        }
    } catch (e) {
        console.warn(`Local node RPC failed for getrawtransaction:`, e);
    }

    // Fallback to mempool.space
    try {
        console.log(`Fetching tx hex from mempool.space...`);
        const response = await fetch(`https://mempool.space/testnet4/api/tx/${txid}/hex`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const hex = await response.text();
        if (hex.length < 100) throw new Error("Invalid hex response");
        console.log(`Found tx hex on mempool.space`);
        return hex;
    } catch (error) {
        console.error(`Failed to fetch tx hex for ${txid}:`, error);
        throw new Error(`Could not find transaction ${txid} on testnet4. Make sure it's confirmed or in mempool.`);
    }
}

/**
 * Generates an unsigned transaction (PSBT) for creating a vault
 */
export async function createVaultPsbt(
    spellName: string,
    fundingUtxo: string,
    fundingUtxoValue: number,
    changeAddress: string,
    env: Record<string, string>
): Promise<{ psbt: string }> {
    console.log(`Starting PSBT generation for UTXO: ${fundingUtxo}`);

    const txid = fundingUtxo.split(":")[0];

    // Calculate commitment and vault IDs first so they are available for app build
    const { commitmentStr } = await calculateVaultCommitment(
        txid,
        env.OWNER_PUBKEY,
        env.BTC_AMOUNT
    );

    const fullEnv: Record<string, string | undefined> = {
        ...process.env,
        ...env,
        APP_ID: commitmentStr,
        APP_VK: await getVerificationKey(),
        IN_UTXO_0: fundingUtxo,
        ADDR_0: changeAddress,
        TIMESTAMP: env.TIMESTAMP || "1736000000",
        LOCK_HEIGHT: env.LOCK_HEIGHT || "100",
    };

    console.log(`Step 1: Building app binaries (wasm32-wasip1) with APP_ID: ${commitmentStr}...`);
    // Use charms app build which produces the correct WASI binary with _start export
    const appBins = await runCharmsCommand(["app", "build"], fullEnv);
    console.log(`Step 1 Complete. Bins: ${appBins.trim().slice(0, 60)}...`);

    // Update VK based on the specific binary
    fullEnv.APP_VK = await getVerificationKey(appBins.trim());
    fullEnv.APP_BINS = appBins.trim();

    console.log(`Step 2: Fetching previous transaction hex for ${txid}...`);
    const prevTxHex = await getTxHex(txid);
    console.log(`Step 2 Complete. Hex length: ${prevTxHex.length}`);

    // Update fullEnv with app bins
    fullEnv.APP_BINS = appBins.trim();

    // Manually substitute variables in the YAML file since charms CLI doesn't do it
    const spellTemplatePath = path.join(VAULT_APP_PATH, "spells", spellName);
    let spellContent = fs.readFileSync(spellTemplatePath, "utf-8");

    // Replace all usage of ${VAR} with value from fullEnv
    Object.entries(fullEnv).forEach(([key, value]) => {
        if (value) {
            spellContent = spellContent.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
        }
    });

    const tempSpellPath = path.join(VAULT_APP_PATH, "spells", `temp_${Date.now()}_${spellName}`);
    fs.writeFileSync(tempSpellPath, spellContent);

    // Use charms spell prove to generate the transaction
    // --mock flag bypasses real prover API - useful for testing without burning UTXOs
    const useMock = process.env.CHARMS_MOCK_MODE === 'true';
    const args = [
        "spell", "prove",
        "--spell", tempSpellPath,
        "--funding-utxo", fundingUtxo,
        "--funding-utxo-value", fundingUtxoValue.toString(),
        "--app-bins", appBins.trim(),
        "--change-address", changeAddress,
        "--prev-txs", prevTxHex,
        "--chain", "bitcoin",
        ...(useMock ? ["--mock"] : [])
    ];

    // Note: We expect the output to contain the transaction hex or PSBT
    // Currently charms spell prove prints the transaction package
    console.log(`Step 3: Running spell prove with args: ${args.join(' ')}`);
    try {
        const output = await runCharmsCommand(args, fullEnv);
        console.log(`Step 3 Complete. Output length: ${output.length}`);
        console.log(`Step 3 Raw Output (first 500 chars):\n${output.substring(0, 500)}`);
        console.log(`Step 3 Raw Output (last 500 chars):\n${output.substring(output.length - 500)}`);

        // Clean up temp file
        if (fs.existsSync(tempSpellPath)) {
            fs.unlinkSync(tempSpellPath);
        }

        // Try to parse as JSON array first (new format: [{bitcoin: hex}, {bitcoin: hex}])
        try {
            const parsed = JSON.parse(output.trim());
            if (Array.isArray(parsed) && parsed.length === 2) {
                console.log('Parsed as JSON array with 2 transactions');
                // Extract the bitcoin hex from each transaction object
                const commitTx = parsed[0].bitcoin || parsed[0];
                const spellTx = parsed[1].bitcoin || parsed[1];
                console.log('Commit TX length:', commitTx.length);
                console.log('Spell TX length:', spellTx.length);
                return {
                    commitTx: commitTx,  // First transaction (needs signing)
                    spellTx: spellTx,    // Second transaction (spell, partially signed by prover)
                    needsPackageBroadcast: true
                };
            }
        } catch (e) {
            console.log('Not JSON array format, trying regex...');
        }

        // Parse the transaction from output. Using regex to find hex string
        // Standard charms output for prove usually has the tx hex at the end or in a JSON block
        const txMatch = output.match(/[0-9a-fA-F]{200,}/); // Look for long hex string
        if (!txMatch) {
            // Fallback for different output formats
            const jsonMatch = output.match(/\{.*\}/s);
            if (jsonMatch) {
                try {
                    const data = JSON.parse(jsonMatch[0]);
                    if (data.tx) return { psbt: data.tx };
                } catch (e) { }
            }
            throw new Error(`Failed to parse PSBT from charms output: ${output}`);
        }

        return { psbt: txMatch[0] };
    } catch (error) {
        if (fs.existsSync(tempSpellPath)) {
            fs.unlinkSync(tempSpellPath);
        }
        throw error;
    }
}

/**
 * Casts a spell to Bitcoin network (legacy, uses local wallet)
 */
export async function castSpell(
    spellName: string,
    fundingUtxo: string,
    env: Record<string, string>
): Promise<{ commitTx: string; executeTx: string }> {
    const appBins = await runCharmsCommand(["app", "build"], env);

    const fullEnv = {
        ...process.env,
        ...env,
        APP_BINS: appBins.trim(),
        FUNDING_UTXO_ID: fundingUtxo,
    };

    const output = await runCharmsSpell(spellName, fullEnv, true);

    // Parse transaction package from output
    const txMatch = output.match(/\["([0-9a-f]+)",\s*"([0-9a-f]+)"\]/);
    if (!txMatch) {
        throw new Error("Failed to parse transaction package");
    }

    return {
        commitTx: txMatch[1],
        executeTx: txMatch[2],
    };
}

// Helper functions

async function runCargoCommand(
    args: string[],
    env: NodeJS.ProcessEnv | Record<string, string | undefined>
): Promise<string> {
    return new Promise((resolve, reject) => {
        const fullEnv = {
            ...env,
            PATH: `${env.PATH}:/home/sati/.cargo/bin:/usr/local/bin:/usr/bin:/bin`
        };

        const proc = spawn("cargo", args, {
            cwd: VAULT_APP_PATH,
            env: fullEnv as NodeJS.ProcessEnv,
        });

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (data) => stdout += data.toString());
        proc.stderr.on("data", (data) => stderr += data.toString());

        proc.on("error", (err) => reject(new Error(`Failed to execute Cargo: ${err.message}`)));

        proc.on("close", (code) => {
            if (code === 0) resolve(stdout);
            else reject(new Error(`Cargo command failed with code ${code}: ${stderr}`));
        });
    });
}

async function runCharmsCommand(
    args: string[],
    env: NodeJS.ProcessEnv | Record<string, string | undefined>
): Promise<string> {
    return new Promise((resolve, reject) => {
        const fullEnv = {
            ...env,
            PATH: `${env.PATH}:${path.dirname(CHARMS_BIN)}:/usr/local/bin:/usr/bin:/bin`
        };

        const proc = spawn(CHARMS_BIN, args, {
            cwd: VAULT_APP_PATH,
            env: fullEnv as NodeJS.ProcessEnv,
        });

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        proc.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        proc.on("error", (err) => {
            reject(new Error(`Failed to execute Charms CLI: ${err.message}`));
        });

        proc.on("close", (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(`Charms command failed with code ${code}: ${stderr}`));
            }
        });
    });
}

async function runCharmsSpell(
    spellFile: string,
    env: Record<string, string | undefined>,
    cast: boolean = false
): Promise<string> {
    const spellPath = path.join(VAULT_APP_PATH, "spells", spellFile);
    const args = cast
        ? ["wallet", "cast", "--spell", spellPath]
        : ["app", "run", "--spell", spellPath];

    return runCharmsCommand(args, env);
}

function parseProofOutput(
    output: string,
    btcAmount: string,
    vaultId: string
): CharmProof {
    // Parse Groth16 proof components from Charms output
    // Format depends on Charms version - this handles the standard format

    const proofMatch = output.match(/proof:\s*\{([^}]+)\}/);

    if (proofMatch) {
        try {
            const proofData = JSON.parse(`{${proofMatch[1]}}`);
            return {
                a: proofData.a,
                b: proofData.b,
                c: proofData.c,
                input: [BigInt(vaultId).toString(), btcAmount],
                vaultId: vaultId,
            };
        } catch (error) {
            throw new Error(`Failed to parse proof from output: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    throw new Error("No valid proof found in Charms output");
}
