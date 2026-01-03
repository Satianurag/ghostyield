import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.20",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
            viaIR: true,
        },
    },
    networks: {
        hardhat: {
            forking: {
                url: "https://sepolia.base.org",
                enabled: true,
            },
            chainId: 84532, // Impersonate Base Sepolia
        },
        "base-sepolia": {
            url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
        },
    },
};

export default config;
