// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/// @title GhostVaultNFT - Tokenized Vault Positions
/// @notice Each NFT represents a Bitcoin vault position in GhostYield
/// @dev Positions are transferable, enabling secondary market for vault positions
contract GhostVaultNFT is ERC721Enumerable, Ownable {
    using Strings for uint256;

    // ==================== EVENTS ====================
    event VaultMinted(uint256 indexed tokenId, bytes32 indexed vaultId, address indexed owner);
    event VaultMetadataUpdated(uint256 indexed tokenId, uint256 btcAmount, uint256 debtAmount);

    // ==================== STATE ====================
    address public ghostLending;
    uint256 private _tokenIdCounter;

    struct VaultMetadata {
        bytes32 vaultId;           // Unique vault identifier
        uint256 btcAmount;         // BTC collateral in satoshis
        uint256 debtAmount;        // Current debt in wei
        uint256 createdAt;         // Timestamp of creation
        string btcAddress;         // Bitcoin lock address
    }

    mapping(uint256 => VaultMetadata) public vaultData;
    mapping(bytes32 => uint256) public vaultIdToTokenId;

    // ==================== MODIFIERS ====================
    modifier onlyGhostLending() {
        require(msg.sender == ghostLending, "Only GhostLending");
        _;
    }

    // ==================== CONSTRUCTOR ====================
    constructor() ERC721("GhostVault", "GVAULT") Ownable(msg.sender) {}

    // ==================== ADMIN ====================

    /// @notice Set the GhostLending contract address
    /// @param _ghostLending Address of GhostLending contract
    function setGhostLending(address _ghostLending) external onlyOwner {
        require(_ghostLending != address(0), "Invalid address");
        ghostLending = _ghostLending;
    }

    // ==================== MINTING ====================

    /// @notice Mint a new vault NFT (called by GhostLending)
    /// @param to Owner of the vault
    /// @param vaultId Unique vault identifier
    /// @param btcAmount BTC collateral amount in satoshis
    /// @param btcAddress Bitcoin lock address
    /// @return tokenId The minted token ID
    function mint(
        address to,
        bytes32 vaultId,
        uint256 btcAmount,
        string calldata btcAddress
    ) external onlyGhostLending returns (uint256) {
        require(vaultIdToTokenId[vaultId] == 0, "Vault already exists");

        _tokenIdCounter++;
        uint256 tokenId = _tokenIdCounter;

        _safeMint(to, tokenId);

        vaultData[tokenId] = VaultMetadata({
            vaultId: vaultId,
            btcAmount: btcAmount,
            debtAmount: 0,
            createdAt: block.timestamp,
            btcAddress: btcAddress
        });

        vaultIdToTokenId[vaultId] = tokenId;

        emit VaultMinted(tokenId, vaultId, to);
        return tokenId;
    }

    /// @notice Update vault metadata (called by GhostLending on borrow/repay)
    /// @param vaultId Vault identifier
    /// @param btcAmount Updated BTC amount
    /// @param debtAmount Updated debt amount
    function updateMetadata(
        bytes32 vaultId,
        uint256 btcAmount,
        uint256 debtAmount
    ) external onlyGhostLending {
        uint256 tokenId = vaultIdToTokenId[vaultId];
        require(tokenId != 0, "Vault not found");

        vaultData[tokenId].btcAmount = btcAmount;
        vaultData[tokenId].debtAmount = debtAmount;

        emit VaultMetadataUpdated(tokenId, btcAmount, debtAmount);
    }

    /// @notice Burn a vault NFT when position is closed
    /// @param vaultId Vault identifier
    function burn(bytes32 vaultId) external onlyGhostLending {
        uint256 tokenId = vaultIdToTokenId[vaultId];
        require(tokenId != 0, "Vault not found");

        delete vaultData[tokenId];
        delete vaultIdToTokenId[vaultId];
        _burn(tokenId);
    }

    // ==================== VIEW FUNCTIONS ====================

    /// @notice Get vault data by token ID
    /// @param tokenId Token ID
    /// @return metadata Vault metadata
    function getVaultData(uint256 tokenId) external view returns (VaultMetadata memory) {
        require(tokenId != 0 && tokenId <= _tokenIdCounter, "Invalid token");
        return vaultData[tokenId];
    }

    /// @notice Get vault data by vault ID
    /// @param vaultId Vault identifier
    /// @return metadata Vault metadata
    function getVaultByVaultId(bytes32 vaultId) external view returns (VaultMetadata memory) {
        uint256 tokenId = vaultIdToTokenId[vaultId];
        require(tokenId != 0, "Vault not found");
        return vaultData[tokenId];
    }

    /// @notice Get owner of a vault by vault ID
    /// @param vaultId Vault identifier
    /// @return Owner address
    function ownerOfVault(bytes32 vaultId) external view returns (address) {
        uint256 tokenId = vaultIdToTokenId[vaultId];
        require(tokenId != 0, "Vault not found");
        return ownerOf(tokenId);
    }

    /// @notice Get all vaults owned by an address
    /// @param owner Owner address
    /// @return tokenIds Array of token IDs
    function getVaultsByOwner(address owner) external view returns (uint256[] memory) {
        uint256 balance = balanceOf(owner);
        uint256[] memory tokenIds = new uint256[](balance);
        
        for (uint256 i = 0; i < balance; i++) {
            tokenIds[i] = tokenOfOwnerByIndex(owner, i);
        }
        
        return tokenIds;
    }

    /// @notice Get token URI with on-chain SVG metadata
    /// @param tokenId Token ID
    /// @return URI Data URI with JSON metadata
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(tokenId != 0 && tokenId <= _tokenIdCounter, "Invalid token");

        VaultMetadata memory data = vaultData[tokenId];
        
        // Format BTC amount (8 decimals)
        string memory btcFormatted = _formatBTC(data.btcAmount);
        
        // Format debt (18 decimals)
        string memory debtFormatted = _formatDebt(data.debtAmount);

        // Calculate health indicator
        string memory healthColor = "#22c55e"; // Default green for static SVG

        // Build SVG
        string memory svg = _buildSVG(tokenId, btcFormatted, debtFormatted, healthColor);

        // Build JSON metadata
        string memory json = string(abi.encodePacked(
            '{"name":"GhostVault #', tokenId.toString(), '",',
            '"description":"Bitcoin collateral vault for GhostYield lending protocol",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)), '",',
            '"attributes":[',
                '{"trait_type":"BTC Collateral","value":"', btcFormatted, '"},',
                '{"trait_type":"Debt (gUSD)","value":"', debtFormatted, '"},',
                '{"trait_type":"Created","display_type":"date","value":', data.createdAt.toString(), '}',
            ']}'
        ));

        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }

    // ==================== INTERNAL ====================

    function _formatBTC(uint256 satoshis) internal pure returns (string memory) {
        uint256 wholePart = satoshis / 1e8;
        uint256 decimalPart = (satoshis % 1e8) / 1e4; // 4 decimal places
        return string(abi.encodePacked(wholePart.toString(), ".", _padZeros(decimalPart, 4)));
    }

    function _formatDebt(uint256 weiAmount) internal pure returns (string memory) {
        uint256 wholePart = weiAmount / 1e18;
        uint256 decimalPart = (weiAmount % 1e18) / 1e16; // 2 decimal places
        return string(abi.encodePacked(wholePart.toString(), ".", _padZeros(decimalPart, 2)));
    }

    function _padZeros(uint256 value, uint256 places) internal pure returns (string memory) {
        bytes memory result = new bytes(places);
        for (uint256 i = places; i > 0; i--) {
            result[i - 1] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        return string(result);
    }


    function _buildSVG(
        uint256 tokenId,
        string memory btcAmount,
        string memory debtAmount,
        string memory healthColor
    ) internal pure returns (string memory) {
        return string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250">',
            '<defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">',
            '<stop offset="0%" style="stop-color:#1a1a2e"/><stop offset="100%" style="stop-color:#16213e"/></linearGradient></defs>',
            '<rect width="400" height="250" fill="url(#bg)" rx="15"/>',
            '<text x="20" y="35" fill="#fff" font-family="monospace" font-size="20" font-weight="bold">GhostVault #', tokenId.toString(), '</text>',
            '<text x="20" y="70" fill="#888" font-family="sans-serif" font-size="12">BTC Collateral</text>',
            '<text x="20" y="95" fill="#f7931a" font-family="monospace" font-size="24" font-weight="bold">', btcAmount, ' BTC</text>',
            '<text x="20" y="140" fill="#888" font-family="sans-serif" font-size="12">Borrowed</text>',
            '<text x="20" y="165" fill="#4ade80" font-family="monospace" font-size="24" font-weight="bold">', debtAmount, ' gUSD</text>',
            '<circle cx="360" cy="40" r="15" fill="', healthColor, '"/>',
            '<text x="20" y="230" fill="#555" font-family="monospace" font-size="10">GhostYield Protocol</text>',
            '</svg>'
        ));
    }
}
