// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/// @title ChainlinkPriceFeed - Production BTC/USD Price Oracle
/// @notice Fetches real BTC price from Chainlink oracle
/// @dev Supports any Chainlink-compatible price feed on any EVM network
contract ChainlinkPriceFeed {
    AggregatorV3Interface public immutable priceFeed;
    
    /// @notice Known Chainlink BTC/USD Feed Addresses:
    /// - Ethereum Sepolia: 0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43
    /// - Base Mainnet: 0x64c911996D3c6aC71E9b8Fa58dd79bA856AE9C18 (BTC/USD)
    /// - Base Sepolia: Check docs.chain.link for latest address
    /// @dev Pass the appropriate address for your target network
    
    uint256 public constant PRICE_DECIMALS = 8;
    uint256 public constant TARGET_DECIMALS = 18;
    
    event PriceFetched(int256 price, uint256 timestamp);
    
    /// @param _priceFeedAddress Chainlink AggregatorV3 price feed address
    constructor(address _priceFeedAddress) {
        require(_priceFeedAddress != address(0), "Invalid price feed address");
        priceFeed = AggregatorV3Interface(_priceFeedAddress);
    }
    
    /// @notice Gets the latest BTC/USD price
    /// @return price Price in 18 decimals
    function getBTCPrice() external view returns (uint256 price) {
        (
            /* uint80 roundID */,
            int256 answer,
            /* uint256 startedAt */,
            uint256 updatedAt,
            /* uint80 answeredInRound */
        ) = priceFeed.latestRoundData();
        
        // Ensure price is fresh (within 1 hour)
        require(block.timestamp - updatedAt < 3600, "Stale price");
        require(answer > 0, "Invalid price");
        
        // Convert from 8 decimals to 18 decimals
        price = uint256(answer) * (10 ** (TARGET_DECIMALS - PRICE_DECIMALS));
    }
    
    /// @notice Gets price with full round data
    function getLatestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return priceFeed.latestRoundData();
    }
    
    /// @notice Gets price feed decimals
    function decimals() external view returns (uint8) {
        return priceFeed.decimals();
    }
    
    /// @notice Gets price feed description
    function description() external view returns (string memory) {
        return priceFeed.description();
    }
}
