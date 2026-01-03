// Contract addresses - update these after deployment or via .env
export const CONTRACTS = {
  GHOST_LENDING: (import.meta.env.VITE_GHOST_LENDING_ADDRESS as `0x${string}`),
  GHOST_USD: (import.meta.env.VITE_GHOST_USD_ADDRESS as `0x${string}`),
  GHOST_POOL: (import.meta.env.VITE_GHOST_POOL_ADDRESS as `0x${string}`),
  VAULT_NFT: (import.meta.env.VITE_VAULT_NFT_ADDRESS as `0x${string}`),
  VERIFIER: (import.meta.env.VITE_VERIFIER_ADDRESS as `0x${string}`),
  PRICE_FEED: (import.meta.env.VITE_PRICE_FEED_ADDRESS as `0x${string}`),
  USDC: (import.meta.env.VITE_USDC_ADDRESS as `0x${string}`),
} as const;

// Backend API URL
export const API_URL = (import.meta.env.VITE_API_URL as string);

// Chain config
export const CHAIN_ID = 84532; // Base Sepolia

// Protocol parameters
export const PROTOCOL = {
  LTV: 50, // 50%
  LIQUIDATION_THRESHOLD: 65, // 65%
  LIQUIDATION_PENALTY: 10, // 10%
  BASE_INTEREST_RATE: 2, // 2% APY
} as const;

export const GHOST_LENDING_ABI = [
  {
    "inputs": [
      { "internalType": "uint256[2]", "name": "a", "type": "uint256[2]" },
      { "internalType": "uint256[2][2]", "name": "b", "type": "uint256[2][2]" },
      { "internalType": "uint256[2]", "name": "c", "type": "uint256[2]" },
      { "internalType": "uint256[2]", "name": "input", "type": "uint256[2]" },
      { "internalType": "bytes32", "name": "vaultId", "type": "bytes32" }
    ],
    "name": "createVault",
    "outputs": [],
    "stateMutability": "external",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "user", "type": "address" }],
    "name": "getUserVaults",
    "outputs": [{ "internalType": "bytes32[]", "name": "", "type": "bytes32[]" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "bytes32", "name": "vaultId", "type": "bytes32" }],
    "name": "getHealthFactor",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }],
    "name": "positions",
    "outputs": [
      { "internalType": "bytes32", "name": "vaultId", "type": "bytes32" },
      { "internalType": "address", "name": "user", "type": "address" },
      { "internalType": "uint256", "name": "collateralBTC", "type": "uint256" },
      { "internalType": "uint256", "name": "debtAmount", "type": "uint256" },
      { "internalType": "uint256", "name": "lastUpdate", "type": "uint256" },
      { "internalType": "uint256", "name": "accruedInterest", "type": "uint256" },
      { "internalType": "bool", "name": "active", "type": "bool" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "bytes32", "name": "vaultId", "type": "bytes32" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "borrow",
    "outputs": [],
    "stateMutability": "external",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "bytes32", "name": "vaultId", "type": "bytes32" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "repay",
    "outputs": [],
    "stateMutability": "external",
    "type": "function"
  }
] as const;

export const ERC20_ABI = [
  {
    "inputs": [
      { "internalType": "address", "name": "spender", "type": "address" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "approve",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "owner", "type": "address" },
      { "internalType": "address", "name": "spender", "type": "address" }
    ],
    "name": "allowance",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "account", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

export const GHOST_POOL_ABI = [
  {
    "inputs": [{ "internalType": "uint256", "name": "amount", "type": "uint256" }],
    "name": "deposit",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "shareAmount", "type": "uint256" }],
    "name": "withdraw",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getPoolStats",
    "outputs": [
      { "internalType": "uint256", "name": "_totalDeposited", "type": "uint256" },
      { "internalType": "uint256", "name": "_totalBorrowed", "type": "uint256" },
      { "internalType": "uint256", "name": "_utilization", "type": "uint256" },
      { "internalType": "uint256", "name": "_supplyAPY", "type": "uint256" },
      { "internalType": "uint256", "name": "_borrowAPY", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "lender", "type": "address" }],
    "name": "shares",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "lender", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalShares",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

export const PRICE_FEED_ABI = [
  {
    "inputs": [],
    "name": "latestRoundData",
    "outputs": [
      { "internalType": "uint80", "name": "roundId", "type": "uint80" },
      { "internalType": "int256", "name": "answer", "type": "int256" },
      { "internalType": "uint256", "name": "startedAt", "type": "uint256" },
      { "internalType": "uint256", "name": "updatedAt", "type": "uint256" },
      { "internalType": "uint80", "name": "answeredInRound", "type": "uint80" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "decimals",
    "outputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const;