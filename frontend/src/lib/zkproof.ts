/**
 * Client-Side ZK Proof Generation using snarkjs
 * 
 * Generates Groth16 proofs directly in the browser using 
 * WebAssembly circuit artifacts.
 */

import * as snarkjs from 'snarkjs';

// Circuit artifact paths (served from /public/circuits/)
const CIRCUIT_WASM = '/circuits/vault.wasm';
const CIRCUIT_ZKEY = '/circuits/vault_final.zkey';

export interface ProofData {
    a: [string, string];
    b: [[string, string], [string, string]];
    c: [string, string];
    input: [string, string];
    vaultId: string;
}

export interface VaultInputs {
    btcAmount: string;      // In satoshis
    btcTxHash: string;      // 64-char hex string
    ownerSecret: string;    // Owner's secret (or hash)
    lockHeight: number;
}

/**
 * Converts a 256-bit hex string to 4 x 64-bit chunks for the circuit
 */


function hexTo4Chunks(hex: string): string[] {
    // Remove 0x prefix if present
    const cleanHex = hex.replace(/^0x/, '').padStart(64, '0');

    // Split into 4 chunks of 16 hex chars (64 bits each)
    const chunks: string[] = [];
    for (let i = 0; i < 4; i++) {
        const chunk = cleanHex.slice(i * 16, (i + 1) * 16);
        chunks.push(BigInt('0x' + chunk).toString());
    }
    return chunks;
}



/**
 * Generates a Groth16 proof locally in the browser
 * 
 * @param inputs - The vault creation inputs
 * @returns ProofData ready for smart contract submission
 */
export async function generateProofLocal(inputs: VaultInputs): Promise<ProofData> {
    // Prepare circuit inputs
    const txHashChunks = hexTo4Chunks(inputs.btcTxHash);

    const ownerSecret = inputs.ownerSecret.startsWith("0x") ? inputs.ownerSecret : "0x" + inputs.ownerSecret;
    const circuitInputs = {
        btcAmount: inputs.btcAmount,
        btcTxHash: txHashChunks,
        ownerSecret: BigInt(ownerSecret).toString(),
        lockHeight: inputs.lockHeight.toString(),
    };

    try {
        // Generate the proof using snarkjs
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            circuitInputs,
            CIRCUIT_WASM,
            CIRCUIT_ZKEY
        );

        // Format proof for Solidity verifier
        // snarkjs returns proof in a different format than what Solidity expects
        const proofData: ProofData = {
            a: [proof.pi_a[0], proof.pi_a[1]],
            b: [
                [proof.pi_b[0][1], proof.pi_b[0][0]], // Note: reversed for Solidity
                [proof.pi_b[1][1], proof.pi_b[1][0]]
            ],
            c: [proof.pi_c[0], proof.pi_c[1]],
            input: [publicSignals[0], publicSignals[1]], // [vaultCommitment, btcAmount]
            vaultId: '0x' + BigInt(publicSignals[0]).toString(16).padStart(64, '0'),
        };

        return proofData;

    } catch (error) {
        throw new Error(`Client-side proof generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
