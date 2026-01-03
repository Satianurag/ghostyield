import { ethers, network } from "hardhat";

async function main() {
    console.log("🚀 Deploying GhostYield to Base Sepolia...\n");

    const [deployer] = await ethers.getSigners();
    console.log(`Deployer: ${deployer.address}`);
    console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

    // USDC address on Base Sepolia (Real Address)
    // On a fork, this contract exists and has state!
    // USDC address configuration
    let USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia USDC

    console.log(`   👉 Using USDC: ${USDC_ADDRESS}`);

    // 1. Deploy GhostUSD token
    console.log("1. Deploying GhostUSD...");
    const GhostUSD = await ethers.getContractFactory("GhostUSD");
    const ghostUSD = await GhostUSD.deploy();
    await ghostUSD.waitForDeployment();
    const ghostUSDAddress = await ghostUSD.getAddress();
    console.log(`   ✅ GhostUSD: ${ghostUSDAddress}`);

    // 2. Deploy Verifier (Production Groth16)
    console.log("2. Deploying Groth16Verifier...");
    const VerifierFactory = await ethers.getContractFactory("Groth16Verifier");
    const verifier = await VerifierFactory.deploy();
    await verifier.waitForDeployment();
    const verifierAddress = await verifier.getAddress();
    console.log(`   ✅ Verifier: ${verifierAddress}`);

    // 3. Chainlink Price Feed
    // BTC/USD on Base Sepolia
    const priceFeedAddress = "0xd94e4C1C3bB697AAE92744FAA4E43B5c2Ef11f16";
    console.log(`3. Using Real Price Feed: ${priceFeedAddress}`);

    // 4. Deploy GhostPool (Liquidity Pool)
    console.log("4. Deploying GhostPool...");
    const GhostPool = await ethers.getContractFactory("GhostPool");
    const ghostPool = await GhostPool.deploy(USDC_ADDRESS);
    await ghostPool.waitForDeployment();
    const ghostPoolAddress = await ghostPool.getAddress();
    console.log(`   ✅ GhostPool: ${ghostPoolAddress}`);

    // 5. Deploy GhostVaultNFT
    console.log("5. Deploying GhostVaultNFT...");
    const GhostVaultNFT = await ethers.getContractFactory("GhostVaultNFT");
    const vaultNFT = await GhostVaultNFT.deploy();
    await vaultNFT.waitForDeployment();
    const vaultNFTAddress = await vaultNFT.getAddress();
    console.log(`   ✅ GhostVaultNFT: ${vaultNFTAddress}`);

    // 6. Deploy GhostLending
    console.log("6. Deploying GhostLending...");
    const GhostLending = await ethers.getContractFactory("GhostLending");
    const ghostLending = await GhostLending.deploy(
        verifierAddress,
        ghostUSDAddress,
        priceFeedAddress
    );
    await ghostLending.waitForDeployment();
    const ghostLendingAddress = await ghostLending.getAddress();
    console.log(`   ✅ GhostLending: ${ghostLendingAddress}`);

    // 7. Configure contracts
    console.log("\n7. Configuring contracts...");

    // Set GhostLending as minter for GhostUSD
    await ghostUSD.setLendingContract(ghostLendingAddress);
    console.log("   ✅ GhostUSD: Lending contract set");

    // Set GhostLending in GhostPool
    await ghostPool.setGhostLending(ghostLendingAddress);
    console.log("   ✅ GhostPool: GhostLending set");

    // Set GhostLending in GhostVaultNFT
    await vaultNFT.setGhostLending(ghostLendingAddress);
    console.log("   ✅ GhostVaultNFT: GhostLending set");

    // Set GhostPool in GhostLending
    await ghostLending.setGhostPool(ghostPoolAddress);
    console.log("   ✅ GhostLending: GhostPool set");

    // Summary
    console.log("\n" + "=".repeat(50));
    console.log("           DEPLOYMENT COMPLETE 🎉");
    console.log("=".repeat(50) + "\n");

    console.log("Contract Addresses (add to .env):\n");
    console.log(`GHOSTUSD_ADDRESS="${ghostUSDAddress}"`);
    console.log(`VERIFIER_ADDRESS="${verifierAddress}"`);
    console.log(`PRICEFEED_ADDRESS="${priceFeedAddress}"`);

    console.log("\n" + "=".repeat(50));
    console.log("        Verify on Basescan:");
    console.log(`https://sepolia.basescan.org/address/${ghostLendingAddress}`);
    console.log("=".repeat(50));

    // Return addresses for testing
    return {
        ghostUSD: ghostUSDAddress,
        verifier: verifierAddress,
        priceFeed: priceFeedAddress,
        ghostPool: ghostPoolAddress,
        vaultNFT: vaultNFTAddress,
        ghostLending: ghostLendingAddress
    };
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
