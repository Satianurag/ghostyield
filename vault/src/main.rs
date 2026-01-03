//! GhostYield Vault - Charms Protocol Integration
use charms_sdk::data::{check, App, Data, Transaction, NFT};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VaultStatus { Active, Borrowed, Unlocked, Liquidated }

impl Default for VaultStatus { fn default() -> Self { VaultStatus::Active } }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhostVault {
    pub owner: String,
    pub amount: u64,
    pub lock_until: u32,
    pub status: VaultStatus,
    #[serde(skip_serializing_if = "Option::is_none")] pub created_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub debt_amount: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub borrowed_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub lending_contract: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub unlocked_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub repaid_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub liquidated_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub liquidator: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub debt_at_liquidation: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CharmData { vault: GhostVault }

pub fn app_contract(app: &App, tx: &Transaction, _x: &Data, _w: &Data) -> bool {
    match app.tag {
        NFT => validate_vault_transition(app, tx),
        _ => false,
    }
}

fn validate_vault_transition(app: &App, tx: &Transaction) -> bool {
    let input_vaults = get_vault_inputs(tx, app);
    let output_vaults = get_vault_outputs(tx, app);
    
    if input_vaults.is_empty() && output_vaults.len() == 1 {
        let vault = &output_vaults[0];
        check!(vault.status == VaultStatus::Active);
        check!(vault.amount > 0);
        return true;
    }
    
    if input_vaults.len() == 1 && output_vaults.len() == 1 {
        let input = &input_vaults[0];
        let output = &output_vaults[0];
        check!(input.owner == output.owner);
        check!(input.amount == output.amount);
        
        return match (&input.status, &output.status) {
            (VaultStatus::Active, VaultStatus::Borrowed) => true,
            (VaultStatus::Borrowed, VaultStatus::Active) => true,
            (VaultStatus::Active, VaultStatus::Unlocked) => true,
            (VaultStatus::Borrowed, VaultStatus::Liquidated) => true,
            _ => false,
        };
    } else if input_vaults.len() == 1 && output_vaults.is_empty() {
        let input = &input_vaults[0];
        check!(input.status == VaultStatus::Unlocked);
        return true;
    }
    
    false
}

fn get_vault_inputs(tx: &Transaction, app: &App) -> Vec<GhostVault> {
    let mut vaults = Vec::new();
    for (_utxo_id, charms) in &tx.ins {
        if let Some(data) = charms.get(app) {
            if let Some(vault) = parse_vault_data(data) {
                vaults.push(vault);
            }
        }
    }
    vaults
}

fn get_vault_outputs(tx: &Transaction, app: &App) -> Vec<GhostVault> {
    let mut vaults = Vec::new();
    for charms in &tx.outs {
        if let Some(data) = charms.get(app) {
            if let Some(vault) = parse_vault_data(data) {
                vaults.push(vault);
            }
        }
    }
    vaults
}

fn parse_vault_data(data: &Data) -> Option<GhostVault> {
    let charm_data: CharmData = data.value().ok()?;
    Some(charm_data.vault)
}

use std::io::{self, Read};
use charms_sdk::data::util;

fn main() {
    eprintln!("Vault app starting...");
    let mut input_bytes = Vec::new();
    if let Err(e) = io::stdin().read_to_end(&mut input_bytes) {
        eprintln!("Error reading from stdin: {}", e);
        panic!("STDIN_READ_FAILED");
    }
    
    if input_bytes.is_empty() {
        eprintln!("Input is empty - likely simple transfer");
        return; 
    }

    eprintln!("Input size: {} bytes. Deserializing...", input_bytes.len());

    // Attempt to deserialize using charms_sdk::data::util
    let result: Result<(App, Transaction, Data, Data), _> = util::read(input_bytes.as_slice());
    
    match result {
        Ok((app, tx, x, w)) => {
            eprintln!("Deserialization successful. App tag: {:?}", app.tag);
            let success = app_contract(&app, &tx, &x, &w);
            if !success {
                eprintln!("App contract not satisfied logic check failed.");
                panic!("CONTRACT_NOT_SATISFIED");
            }
            eprintln!("App contract satisfied!");
        }
        Err(e) => {
            eprintln!("Failed to deserialize input tuple: {}", e);
            panic!("DESERIALIZATION_FAILED");
        }
    }
}
