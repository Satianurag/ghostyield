import { ethers } from "hardhat";

async function main() {
    const args = process.argv.slice(2);
    const receiverAddress = args[0] || process.env.ADDR;

    if (!receiverAddress) {
        console.error("Please provide an address to fund: npx hardhat run scripts/fund.ts --network localhost -- <ADDRESS>");
        process.exit(1);
    }

    console.log(`Funding account: ${receiverAddress}...`);

    const [deployer] = await ethers.getSigners();

    // 1. Send ETH
    const tx = await deployer.sendTransaction({
        to: receiverAddress,
        value: ethers.parseEther("1000.0"), // Send 1000 ETH
    });
    await tx.wait();
    console.log("✅ Sent 1000 ETH");

    const balance = await ethers.provider.getBalance(receiverAddress);
    console.log(`New ETH Balance: ${ethers.formatEther(balance)} ETH`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
