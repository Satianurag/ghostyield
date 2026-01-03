pragma circom 2.1.6;

include "poseidon.circom";
include "comparators.circom";

/**
 * VaultProof Circuit
 * 
 * Proves ownership of Bitcoin locked in a vault without revealing:
 * - The exact transaction hash
 * - The owner's private key
 * 
 * Public Inputs:
 *   - btcAmount: Amount of BTC locked (in satoshis)
 * 
 * Private Inputs:
 *   - btcTxHash: Bitcoin transaction hash (split into 4x64-bit chunks)
 *   - ownerSecret: Owner's secret (private key hash)
 *   - lockHeight: Block height when locked
 */
template VaultProof() {
    // Public inputs
    signal input btcAmount;
    
    // Private inputs (witness)
    signal input btcTxHash[4];    // 256-bit hash split into 4 x 64-bit chunks
    signal input ownerSecret;
    signal input lockHeight;
    
    // Public output - commitment hash
    signal output vaultCommitment;
    
    // Constraint: BTC amount must be positive (at least 1 satoshi)
    signal btcAmountCheck;
    component gtZero = GreaterThan(64);
    gtZero.in[0] <== btcAmount;
    gtZero.in[1] <== 0;
    btcAmountCheck <== gtZero.out;
    btcAmountCheck === 1;
    
    // Constraint: Lock height must be reasonable (> 0)
    signal lockHeightCheck;
    component gtZeroHeight = GreaterThan(32);
    gtZeroHeight.in[0] <== lockHeight;
    gtZeroHeight.in[1] <== 0;
    lockHeightCheck <== gtZeroHeight.out;
    lockHeightCheck === 1;
    
    // Create vault commitment using Poseidon hash
    // commitment = H(btcTxHash[0], btcTxHash[1], btcTxHash[2], btcTxHash[3], ownerSecret, btcAmount)
    component hasher = Poseidon(6);
    hasher.inputs[0] <== btcTxHash[0];
    hasher.inputs[1] <== btcTxHash[1];
    hasher.inputs[2] <== btcTxHash[2];
    hasher.inputs[3] <== btcTxHash[3];
    hasher.inputs[4] <== ownerSecret;
    hasher.inputs[5] <== btcAmount;
    
    vaultCommitment <== hasher.out;
}

component main { public [ btcAmount ] } = VaultProof();
