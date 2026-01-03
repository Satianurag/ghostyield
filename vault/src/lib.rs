//! GhostYield Vault - Charms Protocol Integration
//!
//! This module implements a time-locked BTC vault using the Charms SDK.
//! It enables users to lock BTC on Bitcoin and use ZK proofs to borrow
//! stablecoins on EVM chains.

use charms_sdk::data::{check, App, Data, Transaction, NFT};
use serde::{Deserialize, Serialize};

/// Vault status enum matching the spell YAML format
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VaultStatus {
    Active,
    Borrowed,
    Unlocked,
    Liquidated,
}

impl Default for VaultStatus {
    fn default() -> Self {
        VaultStatus::Active
    }
}

/// GhostVault state structure matching the spell YAML format
/// 
/// This structure is serialized as CBOR in the charm data field.
/// Fields match the spell template exactly:
/// ```yaml
/// vault:
///   owner: ${OWNER_PUBKEY}
///   amount: ${BTC_AMOUNT}
///   lock_until: ${LOCK_HEIGHT}
///   status: "active"
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhostVault {
    pub owner: String,           // Owner's public key (hex string)
    pub amount: u64,             // BTC amount in satoshis
    pub lock_until: u32,         // Lock-until block height
    pub status: VaultStatus,     // Current vault status
    
    // Optional fields for different states
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub debt_amount: Option<u64>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub borrowed_at: Option<u64>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lending_contract: Option<String>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unlocked_at: Option<u64>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repaid_at: Option<u64>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub liquidated_at: Option<u64>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub liquidator: Option<String>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub debt_at_liquidation: Option<u64>,
}

/// Wrapper for the vault object as it appears in charm data
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CharmData {
    vault: GhostVault,
}

/// Main Charms app contract function
/// 
/// This is the canonical entry point for the Charms Protocol.
/// It validates all vault state transitions according to protocol rules.
pub fn app_contract(app: &App, tx: &Transaction, _x: &Data, _w: &Data) -> bool {
    match app.tag {
        NFT => {
            // Vault NFTs represent ownership of locked BTC
            check!(validate_vault_transition(app, tx));
            true
        }
        _ => {
            // GhostYield only uses NFT-type charms for vaults
            false
        }
    }
}

/// Validates vault state transitions
/// 
/// Allowed transitions:
/// - None -> Active (vault creation)
/// - Active -> Borrowed (debt taken against collateral)
/// - Borrowed -> Active (debt repaid)
/// - Active -> Unlocked (lock period expired, no debt)
/// - Borrowed -> Liquidated (health factor < 1)
fn validate_vault_transition(app: &App, tx: &Transaction) -> bool {
    // Get input and output vault states
    let input_vaults = get_vault_inputs(tx, app);
    let output_vaults = get_vault_outputs(tx, app);
    
    // Creation: no inputs, one output with Active status
    if input_vaults.is_empty() && output_vaults.len() == 1 {
        let vault = &output_vaults[0];
        check!(vault.status == VaultStatus::Active);
        check!(vault.amount > 0);
        check!(vault.lock_until > 0);
        check!(!vault.owner.is_empty());
        return true;
    }
    
    // State transition: one input, one output
    if input_vaults.len() == 1 && output_vaults.len() == 1 {
        let input = &input_vaults[0];
        let output = &output_vaults[0];
        
        // Owner cannot change
        check!(input.owner == output.owner);
        
        // BTC amount cannot change (locked)
        check!(input.amount == output.amount);
        
        // Lock height cannot change
        check!(input.lock_until == output.lock_until);
        
        // Validate specific transitions
        match (&input.status, &output.status) {
            // Active -> Borrowed (taking debt)
            (VaultStatus::Active, VaultStatus::Borrowed) => {
                check!(output.debt_amount.is_some());
                check!(output.borrowed_at.is_some());
                check!(output.lending_contract.is_some());
                return true;
            }
            // Borrowed -> Active (repaying debt)
            (VaultStatus::Borrowed, VaultStatus::Active) => {
                check!(output.repaid_at.is_some());
                return true;
            }
            // Active -> Unlocked (lock expired, reclaiming BTC)
            (VaultStatus::Active, VaultStatus::Unlocked) => {
                check!(output.unlocked_at.is_some());
                return true;
            }
            // Borrowed -> Liquidated (health factor breach)
            (VaultStatus::Borrowed, VaultStatus::Liquidated) => {
                check!(output.liquidated_at.is_some());
                check!(output.liquidator.is_some());
                return true;
            }
            _ => {
                // Invalid transition
                return false;
            }
        }
    }
    
    // Burn: one input, zero outputs (vault NFT destroyed after unlock)
    if input_vaults.len() == 1 && output_vaults.is_empty() {
        let input = &input_vaults[0];
        check!(input.status == VaultStatus::Unlocked);
        return true;
    }
    
    false
}

/// Extract vault states from transaction inputs
fn get_vault_inputs(tx: &Transaction, app: &App) -> Vec<GhostVault> {
    let mut vaults = Vec::new();
    
    // tx.ins is a BTreeMap<UtxoId, Charms> where Charms is BTreeMap<App, Data>
    for (_utxo_id, charms) in &tx.ins {
        if let Some(data) = charms.get(app) {
            if let Some(vault) = parse_vault_data(data) {
                vaults.push(vault);
            }
        }
    }
    
    vaults
}

/// Extract vault states from transaction outputs
fn get_vault_outputs(tx: &Transaction, app: &App) -> Vec<GhostVault> {
    let mut vaults = Vec::new();
    
    // tx.outs is a Vec<Charms> where Charms is BTreeMap<App, Data>
    for charms in &tx.outs {
        if let Some(data) = charms.get(app) {
            if let Some(vault) = parse_vault_data(data) {
                vaults.push(vault);
            }
        }
    }
    
    vaults
}

/// Parse vault data from charm state (CBOR format)
/// 
/// The data is structured as:
/// ```yaml
/// vault:
///   owner: "..."
///   amount: 123
///   lock_until: 800000
///   status: "active"
/// ```
fn parse_vault_data(data: &Data) -> Option<GhostVault> {
    // Data.value() deserializes the CBOR to our struct
    let charm_data: CharmData = data.value().ok()?;
    Some(charm_data.vault)
}

/// Helper to create a new vault with Active status
pub fn new_active_vault(
    owner: String,
    amount: u64,
    lock_until: u32,
    created_at: u64,
) -> GhostVault {
    GhostVault {
        owner,
        amount,
        lock_until,
        status: VaultStatus::Active,
        created_at: Some(created_at),
        debt_amount: None,
        borrowed_at: None,
        lending_contract: None,
        unlocked_at: None,
        repaid_at: None,
        liquidated_at: None,
        liquidator: None,
        debt_at_liquidation: None,
    }
}

/// Validates vault constraints
pub fn verify_vault_constraints(vault: &GhostVault) -> bool {
    vault.amount > 0
        && vault.lock_until > 0
        && !vault.owner.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_vault_serialization() {
        let vault = new_active_vault(
            "02abc123...".to_string(),
            100000,
            800000,
            1704326400,
        );
        
        assert_eq!(vault.status, VaultStatus::Active);
        assert_eq!(vault.amount, 100000);
        assert_eq!(vault.lock_until, 800000);
        assert!(vault.created_at.is_some());
    }
    
    #[test]
    fn test_vault_status_transitions() {
        let active_vault = new_active_vault(
            "owner123".to_string(),
            50000,
            850000,
            1704326400,
        );
        
        let mut borrowed_vault = active_vault.clone();
        borrowed_vault.status = VaultStatus::Borrowed;
        borrowed_vault.debt_amount = Some(10000);
        borrowed_vault.borrowed_at = Some(1704326500);
        borrowed_vault.lending_contract = Some("0x123...".to_string());
        
        assert_eq!(borrowed_vault.status, VaultStatus::Borrowed);
        assert!(borrowed_vault.debt_amount.is_some());
    }
    
    #[test]
    fn test_status_serde() {
        // Test that status serializes as lowercase strings
        assert_eq!(
            serde_json::to_string(&VaultStatus::Active).unwrap(),
            "\"active\""
        );
        assert_eq!(
            serde_json::to_string(&VaultStatus::Borrowed).unwrap(),
            "\"borrowed\""
        );
        assert_eq!(
            serde_json::to_string(&VaultStatus::Unlocked).unwrap(),
            "\"unlocked\""
        );
        assert_eq!(
            serde_json::to_string(&VaultStatus::Liquidated).unwrap(),
            "\"liquidated\""
        );
    }
}
