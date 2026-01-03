import express from "express";
import cors from "cors";
import { generateVaultProof, getVerificationKey, listVaults, castSpell, createVaultPsbt } from "./charms.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (_, res) => {
    res.json({ status: "ok", service: "ghostyield-backend" });
});

// Get Charms app verification key
app.get("/api/vk", async (_, res) => {
    try {
        const vk = await getVerificationKey();
        res.json({ vk });
    } catch (error) {
        res.status(500).json({
            error: error instanceof Error ? error.message : "Failed to get VK"
        });
    }
});

// Generate vault proof
app.post("/api/proof", async (req, res) => {

    try {
        const { btcAmount, btcTxHash, lockHeight, ownerPubkey } = req.body;

        if (!btcAmount || !btcTxHash) {
            res.status(400).json({ error: "Missing required fields" });
            return;
        }

        const proof = await generateVaultProof({
            btcAmount: btcAmount.toString(),
            btcTxHash,
            lockHeight: lockHeight,
            ownerPubkey: ownerPubkey,
        });

        res.json(proof);
    } catch (error) {
        res.status(500).json({
            error: error instanceof Error ? error.message : "Proof generation failed"
        });
    }
});

// List user's vaults
app.get("/api/vaults/:address", async (req, res) => {
    try {
        const { address } = req.params;
        const vaults = await listVaults(address);
        res.json({ vaults });
    } catch (error) {
        res.status(500).json({
            error: error instanceof Error ? error.message : "Failed to list vaults"
        });
    }
});

// Cast a spell (create vault on Bitcoin)
app.post("/api/cast", async (req, res) => {
    try {
        const { spellName, fundingUtxo, fundingUtxoValue, changeAddress, params } = req.body;

        if (!spellName || !fundingUtxo) {
            res.status(400).json({ error: "Missing required fields" });
            return;
        }

        // If changeAddress and fundingUtxoValue are provided, generate PSBT for browser wallet
        if (changeAddress && fundingUtxoValue !== undefined) {
            console.log(`Generating PSBT for ${spellName}...`);
            const result = await createVaultPsbt(spellName, fundingUtxo, fundingUtxoValue, changeAddress, params || {});
            res.json(result);
        } else {
            // Legacy/Fallback: Cast using local wallet
            console.log(`Casting ${spellName} using local wallet...`);
            const result = await castSpell(spellName, fundingUtxo, params || {});
            res.json(result);
        }
    } catch (error) {
        console.error("API /api/cast error:", error);
        res.status(500).json({
            error: error instanceof Error ? error.message : "Cast failed"
        });
    }
});

app.listen(PORT, () => { });
