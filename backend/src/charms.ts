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

/**
 * Generates a ZK proof for a Bitcoin vault using Charms CLI
 */
export async function generateVaultProof(params: VaultParams): Promise<CharmProof> {
    const { btcAmount, btcTxHash, lockHeight, ownerPubkey } = params;

    const p = await initPoseidon();
    const txHashChunks = hexTo4Chunks(btcTxHash);

    // commitment = H(btcTxHash[0], btcTxHash[1], btcTxHash[2], btcTxHash[3], ownerSecret, btcAmount)
    // Note: ownerPubkey is used as ownerSecret in this context
    const ownerSecret = ownerPubkey.startsWith("0x") ? ownerPubkey : "0x" + ownerPubkey;
    const hashInput = [
        ...txHashChunks,
        BigInt(ownerSecret),
        BigInt(btcAmount)
    ];

    const commitment = p(hashInput);
    const commitmentStr = BigInt(p.F.toString(commitment)).toString(16).padStart(64, '0');
    const vaultId = "0x" + commitmentStr;


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
export async function getVerificationKey(): Promise<string> {
    const output = await runCharmsCommand(["app", "vk"], process.env);
    return output.trim();
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
 * Fetches transaction hex from public API (mempool.space)
 */
async function getTxHex(txid: string): Promise<string> {
    try {
        const response = execSync(`curl -s https://mempool.space/testnet4/api/tx/${txid}/hex`).toString().trim();
        if (response.length < 100) throw new Error("Invalid hex received");
        return response;
    } catch (error) {
        console.error(`Failed to fetch tx hex for ${txid}:`, error);
        throw new Error(`Could not find transaction ${txid} on testnet4. Make sure it's confirmed.`);
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
    const appBins = await runCharmsCommand(["app", "build"], env);
    const txid = fundingUtxo.split(":")[0];
    const prevTxHex = await getTxHex(txid);

    const fullEnv = {
        ...process.env,
        ...env,
        APP_BINS: appBins.trim(),
    };

    const spellPath = path.join(VAULT_APP_PATH, "spells", spellName);

    // Use charms spell prove to generate the transaction
    const args = [
        "spell", "prove",
        "--spell", spellPath,
        "--funding-utxo", fundingUtxo,
        "--funding-utxo-value", fundingUtxoValue.toString(),
        "--change-address", changeAddress,
        "--prev-txs", prevTxHex,
        "--chain", "bitcoin"
    ];

    // Note: We expect the output to contain the transaction hex or PSBT
    // Currently charms spell prove prints the transaction package
    const output = await runCharmsCommand(args, fullEnv);

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

async function runCharmsCommand(
    args: string[],
    env: NodeJS.ProcessEnv | Record<string, string | undefined>
): Promise<string> {
    return new Promise((resolve, reject) => {
        const proc = spawn("charms", args, {
            cwd: VAULT_APP_PATH,
            env: env as NodeJS.ProcessEnv,
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
