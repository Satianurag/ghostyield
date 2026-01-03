//! GhostYield Vault - Charms Application Entry Point
//!
//! This is the main entry point for the Charms Protocol application.
//! It uses the charms_sdk::main! macro to wire up the app_contract function.

#![no_main]

charms_sdk::main!(ghostyield_vault::app_contract);
