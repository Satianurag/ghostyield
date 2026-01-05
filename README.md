<div align="center">

# 👻 GhostYield

### Unlock the Value of Your Bitcoin, Privately.

**GhostYield** is a cross-chain DeFi protocol that enables users to lock BTC on Bitcoin and borrow stablecoins on EVM chains, powered by **Charms Protocol** for programmable Bitcoin UTXOs and **Zero-Knowledge Proofs** for privacy.


[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Built with Charms](https://img.shields.io/badge/Built%20with-Charms%20SDK-orange)](https://docs.charms.xyz)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?logo=react)](https://react.dev)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-363636?logo=solidity)](https://soliditylang.org)
[![Rust](https://img.shields.io/badge/Rust-2021_Edition-DEA584?logo=rust)](https://www.rust-lang.org)

</div>

---

## 📖 Table of Contents

1.  [The Problem](#the-problem)
2.  [Our Solution](#our-solution)
3.  [Features](#features)
4.  [Tech Stack](#tech-stack)
5.  [System Architecture](#system-architecture)
6.  [User Flow & Sequence Diagrams](#user-flow--sequence-diagrams)
7.  [Project Structure](#project-structure)
8.  [Getting Started](#getting-started)
9.  [Usage](#usage)
10. [Smart Contracts](#smart-contracts)
11. [Charms Integration](#charms-integration)
12. [Roadmap](#roadmap)
13. [Contributing](#contributing)
14. [License](#license)

---

## ❓ The Problem

Bitcoin holders face a classic dilemma:
- **HODLing** locks capital, missing DeFi opportunities.
- **Bridging BTC** to other chains introduces custodial risk and complexity.
- **Wrapping BTC (wBTC)** requires trusting centralized custodians.

There's no native, trustless way to use your BTC as collateral without giving up custody or privacy.

---

## ✨ Our Solution

**GhostYield** solves this by:

1.  **Locking BTC natively on Bitcoin** using **Charms Protocol** spells, creating a programmable UTXO (a "Vault").
2.  **Generating a ZK proof** off-chain that proves the existence and value of the locked BTC, *without revealing the underlying transaction details*.
3.  **Minting a Vault NFT on an EVM chain** (Base Sepolia) using the ZK proof.
4.  **Borrowing `gUSD` (a stablecoin) against the Vault NFT**, collateralized by the locked BTC.
5.  **Repaying the loan** to unlock the BTC or face **liquidation** if the health factor drops.

> **Result**: Users get DeFi liquidity from their BTC while it stays safely locked on the Bitcoin network.

---

## 🚀 Features

| Feature          | Description                                                              |
| :--------------- | :----------------------------------------------------------------------- |
| ⚡ **Time-Locked Vaults** | Lock BTC on Bitcoin for a defined period using Charms Protocol.         |
| 🔒 **ZK-Verified Collateral** | Prove vault ownership without revealing sensitive data via Groth16 proofs. |
| 🖼️ **Transferable Vault NFTs** | Each vault is an ERC-721 NFT, enabling secondary markets for positions.  |
| 💵 **Stablecoin Borrowing** | Borrow `gUSD` at a 50% LTV against your BTC collateral.                  |
| ⚠️ **On-Chain Liquidations** | Automatic liquidation at 65% health factor protects lenders.            |
| 🏦 **Lending Pool** | Lenders can deposit USDC into the GhostPool to earn yield.               |
| 📊 **Real-Time Dashboard** | Monitor your vaults, health factors, and rewards in a unified UI.        |

---

## 🛠️ Tech Stack

| Layer              | Technology                                                                    |
| :----------------- | :---------------------------------------------------------------------------- |
| **Bitcoin**        | [Charms Protocol](https://charms.xyz) (v0.10.0 SDK), Spells (YAML)         |
| **ZK Proofs**      | [Circom](https://docs.circom.io) (v2.1.8) + [SnarkJS](https://github.com/iden3/snarkjs) (v0.7.5 Groth16) |
| **Smart Contracts**| Solidity 0.8.20, OpenZeppelin, Hardhat                                       |
| **EVM Network**    | Base Sepolia Testnet                                                          |
| **Backend**        | Node.js (Express), TypeScript, `circomlibjs` (Poseidon hash for vault IDs)   |
| **Frontend**       | React 18, Vite, TailwindCSS, RainbowKit, wagmi/viem                           |
| **Oracle**         | Chainlink BTC/USD Price Feed                                                  |

---

## 🏗️ System Architecture

The system consists of four main components that interact across two blockchains (Bitcoin and EVM).

```mermaid
flowchart TB
    subgraph "User Interface"
        UI["⚛️ React Frontend"]
        ZK["🔐 SnarkJS Prover (Browser)"]
    end

    subgraph "Backend Service"
        BE["🖥️ Express Backend"]
    end

    subgraph "Bitcoin Network"
        BTC["₿ Bitcoin L1"]
        CHARMS["🌟 Charms Protocol"]
        VAULT_LOGIC["📜 Vault Logic (Rust/WASM)"]
        SPELLS["📖 Spells (YAML)"]
    end

    subgraph "EVM Network (Base Sepolia)"
        VERIFIER["✅ Groth16Verifier.sol"]
        LENDING["💰 GhostLending.sol"]
        NFT["🖼️ GhostVaultNFT.sol"]
        GUSD["💵 GhostUSD.sol"]
        POOL["🏦 GhostPool.sol"]
        ORACLE["📡 Chainlink Oracle"]
    end

    UI <--> ZK
    UI <---> BE
    UI <--"wagmi/viem"--> LENDING
    UI <--"wagmi/viem"--> POOL
    BE <--"charms CLI"--> CHARMS
    CHARMS --> BTC
    CHARMS --> VAULT_LOGIC
    CHARMS --> SPELLS
    LENDING --> VERIFIER
    LENDING --> NFT
    LENDING --> POOL
    LENDING --> GUSD
    LENDING --> ORACLE
```

### Component Descriptions

| Component          | Responsibility                                                                 |
| :----------------- | :----------------------------------------------------------------------------- |
| **React Frontend** | User-facing application for creating vaults, borrowing, repaying, and lending.|
| **Express Backend**| Orchestrates Charms CLI for BTC transactions, generates ZK proofs.            |
| **Charms Protocol**| Manages programmable UTXOs (vaults) on Bitcoin via spells.                     |
| **Vault Logic**    | Rust/WASM module that defines valid vault state transitions on Charms.         |
| **Groth16Verifier**| On-chain Solidity verifier for ZK proofs.                                      |
| **GhostLending**   | Core lending contract: vault creation, borrow, repay, liquidate.               |
| **GhostVaultNFT**  | ERC-721 NFT representing vault positions, fully on-chain SVG metadata.          |
| **GhostPool**      | USDC liquidity pool for lenders.                                               |
| **GhostUSD**       | Protocol stablecoin minted to borrowers.                                        |
| **Chainlink**      | BTC/USD price feed for LTV and liquidation calculations.                        |

---

## 🔄 User Flow & Sequence Diagrams

### 1. Create Vault & Borrow Flow

This is the primary user journey: locking BTC and borrowing stablecoins.

```mermaid
sequenceDiagram
    participant User
    participant UI as React Frontend
    participant Backend as Node.js Backend
    participant Charms as Charms Protocol
    participant Bitcoin as Bitcoin L1
    participant EVM as GhostLending (EVM)

    User->>UI: 1. Initiate "Create Vault"<br/>(BTC Amount, Lock Period)
    UI->>Backend: 2. POST /api/vault/create
    Backend->>Charms: 3. `charms app build`<br/>(Compile Rust Vault)
    Charms-->>Backend: 4. App Binaries
    Backend->>Backend: 5. Generate Poseidon Hash<br/>(vaultId = H(txHash, owner, amount))
    Backend->>Charms: 6. `charms spell prove`<br/>(create-vault.yaml)
    Charms-->>Backend: 7. Signed BTC TX (PSBT)
    Charms->>Bitcoin: 8. Broadcast Commit & Execute TXs
    Bitcoin-->>Charms: 9. TX Confirmed
    Backend->>Backend: 10. Generate ZK Proof (SnarkJS)
    Backend-->>UI: 11. Return (Proof, VaultId)
    UI->>EVM: 12. `createVault(proof, vaultId)`
    EVM->>EVM: 13. Verify ZK Proof (Groth16Verifier)
    EVM->>EVM: 14. Mint GhostVaultNFT to User
    EVM-->>UI: 15. Vault Created Event
    User->>UI: 16. Click "Borrow"
    UI->>EVM: 17. `borrow(vaultId, amount)`
    EVM->>EVM: 18. Check LTV (50%), Get BTC Price
    EVM->>EVM: 19. Mint gUSD to User
    EVM-->>UI: 20. Borrowed Event
    UI-->>User: 21. Success! gUSD in Wallet
```

### 2. Repay & Unlock Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as React Frontend
    participant EVM as GhostLending (EVM)
    participant Backend as Node.js Backend
    participant Charms as Charms Protocol
    participant Bitcoin as Bitcoin L1

    User->>UI: 1. Click "Repay"
    UI->>EVM: 2. `repay(vaultId, amount)`
    EVM->>EVM: 3. Burn gUSD from User
    EVM->>EVM: 4. Update Position (Reduce Debt)
    EVM-->>UI: 5. Repaid Event
    alt Full Repayment
        EVM->>EVM: 6. Mark Vault as "Unlocked" (EVM Side)
        UI-->>User: 7. "Vault Unlocked on EVM"
        User->>UI: 8. Click "Claim BTC"
        UI->>Backend: 9. POST /api/vault/unlock
        Backend->>Charms: 10. `charms wallet cast`<br/>(unlock-vault.yaml)
        Charms->>Bitcoin: 11. Broadcast Unlock TX
        Bitcoin-->>Charms: 12. BTC Returned to User Address
        Backend-->>UI: 13. Success!
        UI-->>User: 14. BTC Unlocked!
    end
```

### 3. Liquidation Flow

```mermaid
sequenceDiagram
    actor Liquidator
    participant UI as React Frontend
    participant EVM as GhostLending (EVM)
    participant Oracle as Chainlink

    Liquidator->>UI: 1. View "Risky Vaults"
    UI->>EVM: 2. `getHealthFactor(vaultId)`
    EVM->>Oracle: 3. Get BTC Price
    Oracle-->>EVM: 4. Price Data
    EVM-->>UI: 5. Health Factor < 1.0
    Liquidator->>UI: 6. Click "Liquidate"
    UI->>EVM: 7. `liquidate(vaultId)`
    EVM->>EVM: 8. Seize Collateral (BTC claim rights)
    EVM->>EVM: 9. Reward Liquidator (Bonus)
    EVM->>EVM: 10. Burn gUSD Debt
    EVM-->>UI: 11. Liquidated Event
```

---

## 📂 Project Structure

```
ghostyield/
├── backend/             # Node.js/Express API server
│   ├── src/
│   │   ├── index.ts     # Express entry point
│   │   └── charms.ts    # Charms CLI integration
│   └── package.json
│
├── contracts/           # Solidity smart contracts (Hardhat)
│   ├── contracts/
│   │   ├── GhostLending.sol    # Core lending logic
│   │   ├── GhostVaultNFT.sol   # ERC-721 vault representation
│   │   ├── GhostPool.sol       # USDC liquidity pool
│   │   ├── GhostUSD.sol        # gUSD stablecoin
│   │   ├── Groth16Verifier.sol # ZK proof verifier
│   │   └── ChainlinkPriceFeed.sol
│   ├── scripts/         # Deployment & utility scripts
│   └── hardhat.config.ts
│
├── frontend/            # React + Vite frontend
│   ├── src/
│   │   ├── pages/       # Dashboard, CreateVault, Borrow, Repay, Lend
│   │   ├── lib/         # Wallet, contract hooks
│   │   └── main.tsx
│   └── package.json
│
├── vault/               # Charms Protocol Integration (Rust)
│   ├── src/
│   │   └── main.rs      # Vault state machine (Charms SDK)
│   ├── spells/          # Charms spell definitions (YAML)
│   │   ├── create-vault.yaml
│   │   ├── borrow-spell.yaml
│   │   ├── repay-spell.yaml
│   │   ├── unlock-vault.yaml
│   │   └── liquidate-spell.yaml
│   └── Cargo.toml
│
├── circuits/            # Circom ZK circuits
│   └── vault.circom     # Poseidon commitment circuit
│
└── frontend/public/circuits/  # Compiled ZK artifacts
    ├── vault.wasm            # Circuit WASM for browser
    ├── vault_final.zkey      # Proving key
    └── verification_key.json # Verification key
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** >= 18.x
- **Rust** toolchain (for vault compilation)
- **Charms CLI** installed ([Installation Guide](https://docs.charms.xyz))
- **Docker** (optional, for local Bitcoin node)

### Installation

```bash
# Clone the repo
git clone https://github.com/your-username/ghostyield.git
cd ghostyield

# Install dependencies for each component
cd contracts && npm install
cd ../backend && npm install
cd ../frontend && npm install
cd ../circuits && npm install

# Build the Rust vault (requires wasm32-wasip1 target)
# Note: The backend will attempt to build this automatically if `cargo` is available, 
# but manual build is recommended to ensure the environment is correct.
cd ../vault
rustup target add wasm32-wasip1
# This generates the .wasm artifact used by Charms CLI
cargo build --release --target wasm32-wasip1
```

### Environment Setup

The demo is configured for **Base Sepolia** (EVM) and **Bitcoin Testnet4**.

**`backend/.env`** (Use your local Bitcoin node cookie)
```env
PORT=3001
BITCOIN_RPC="http://__cookie__:your_cookie_token@localhost:48332"
```

**`frontend/.env`**
```env
VITE_RPC_URL="https://sepolia.base.org"
VITE_GHOST_LENDING_ADDRESS="0x5233E2cC449738087DB0ffdf8b71DcDbFFEc1329"
VITE_GHOST_USD_ADDRESS="0xe0A9306aec330f8dE987CeDad6D5093699ae27Fa"
VITE_GHOST_POOL_ADDRESS="0xcB1b77F9f779488Eadf2955ED44cdAB86a35ED75"
VITE_VAULT_NFT_ADDRESS="0xb4A0b184FcC7c7cB1BC83091e50Fed7000694e9A"
VITE_VERIFIER_ADDRESS="0x40eA104388c14e2037C7F79aFA88970Dc70e732E"
VITE_PRICE_FEED_ADDRESS="0xd94e4C1C3bB697AAE92744FAA4E43B5c2Ef11f16"
VITE_USDC_ADDRESS="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
VITE_API_URL="http://localhost:3001"
VITE_RAINBOW_PROJECT_ID="your_walletconnect_id"
```

### Running Locally

```bash
# Terminal 1: Start the backend
# Ensure charms CLI is authenticated to your node
cd backend
npm run dev    # Runs on http://localhost:3001

# Terminal 2: Start the frontend
cd frontend
npm run dev    # Runs on http://localhost:5173
```

---

## 📜 Smart Contracts

| Contract             | Address (Base Sepolia)                       | Description                            |
| :------------------- | :------------------------------------------- | :------------------------------------- |
| `GhostLending`       | `0x5233E2cC449738087DB0ffdf8b71DcDbFFEc1329` | Core lending pool & vault management   |
| `GhostVaultNFT`      | `0xb4A0b184FcC7c7cB1BC83091e50Fed7000694e9A` | ERC-721 vault position tokens          |
| `GhostPool`          | `0xcB1b77F9f779488Eadf2955ED44cdAB86a35ED75` | USDC liquidity for lenders             |
| `GhostUSD`           | `0xe0A9306aec330f8dE987CeDad6D5093699ae27Fa` | Borrowed stablecoin                    |
| `Groth16Verifier`    | `0x40eA104388c14e2037C7F79aFA88970Dc70e732E` | On-chain ZK proof verification         |
| `ChainlinkPriceFeed` | `0xd94e4C1C3bB697AAE92744FAA4E43B5c2Ef11f16` | BTC/USD price oracle adapter           |

> **Note:** The addresses above are from a previous deployment. You MUST deploy your own contracts and update them in `frontend/.env` and `frontend/src/config/contracts.ts`.

### Deploying Contracts

```bash
cd contracts
npx hardhat compile
npx hardhat run scripts/deploy.ts --network base-sepolia
```

---

## 🌟 Charms Integration

GhostYield uses the **Charms SDK** (`v0.10.0`) to define programmable vault logic on Bitcoin.

### Vault State Machine (`vault/src/main.rs`)

The Rust module defines valid state transitions:

| Transition                       | Condition                           |
| :------------------------------- | :---------------------------------- |
| `(empty)` → `Active`            | Vault created with BTC locked       |
| `Active` → `Borrowed`           | Debt taken against collateral       |
| `Borrowed` → `Active`           | Debt fully repaid                  |
| `Active` → `Unlocked`           | Lock period expired, BTC claimable  |
| `Borrowed` → `Liquidated`       | Health factor < 1                  |

### Spells (`vault/spells/`)

Charms spells are YAML templates that define UTXO transformations:

- `create-vault.yaml`: Lock BTC and mint an Active vault charm.
- `borrow-spell.yaml`: Transition vault from Active to Borrowed.
- `repay-spell.yaml`: Clear debt, transition back to Active.
- `unlock-vault.yaml`: Return BTC to owner after lock expires.
- `liquidate-spell.yaml`: Seize vault on health factor breach.

---

## 🗺️ Roadmap

- [x] Core vault logic (Charms SDK)
- [x] ZK proof generation (Circom/SnarkJS)
- [x] Smart contracts (Lending, NFT, Pool)
- [x] Frontend MVP (Dashboard, Create, Borrow, Repay, Lend)
- [ ] Mainnet deployment
- [ ] Multi-collateral support (other BTC L2s)
- [ ] Cross-chain repayments
- [ ] Mobile-optimized UI
- [ ] Governance token & DAO

---

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guidelines](CONTRIBUTING.md) first.

1.  Fork the repo
2.  Create a feature branch (`git checkout -b feature/amazing-feature`)
3.  Commit changes (`git commit -m 'Add amazing feature'`)
4.  Push to branch (`git push origin feature/amazing-feature`)
5.  Open a Pull Request

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---
