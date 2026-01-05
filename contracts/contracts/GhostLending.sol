// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./GhostUSD.sol";

interface IGroth16Verifier {
    function verify(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[2] calldata input
    ) external view returns (bool);
}

interface IGhostPool {
    function borrow(address borrower, uint256 amount) external;
    function repay(address repayer, uint256 principal, uint256 interest) external;
}

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function version() external view returns (uint256);
    function getRoundData(uint80 _roundId) external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

contract GhostLending is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // Protocol parameters
    uint256 public constant LTV = 50; // 50% loan-to-value
    uint256 public constant LIQUIDATION_THRESHOLD = 65; // 65% liquidation threshold
    uint256 public constant LIQUIDATION_PENALTY = 10; // 10% penalty
    uint256 public constant INTEREST_RATE = 2e16; // 2% base rate (annual)
    
    // Scaling factors
    uint256 public constant USDC_SCALE = 1e12; // Scale 18 decimals down to 6 for USDC
    uint256 public constant BTC_PRICE_SCALE = 1e10; // Chainlink (8) to 18 decimals
    uint256 public constant INTEREST_PRECISION = 1e18;
    
    // External contracts
    IGroth16Verifier public immutable verifier;
    GhostUSD public immutable ghostUSD;
    AggregatorV3Interface public priceFeed;
    IGhostPool public ghostPool;
    
    // Protocol state
    uint256 public totalBorrowed;
    uint256 public totalCollateralBTC;
    
    struct Position {
        bytes32 vaultId;
        address user;
        uint256 collateralBTC;    // In satoshis (1e8)
        uint256 debtAmount;       // In wei (1e18)
        uint256 lastUpdate;
        uint256 accruedInterest;
        bool active;
    }
    
    mapping(bytes32 => Position) public positions;
    mapping(address => bytes32[]) public userVaults;
    bytes32[] public allVaults;
    
    // Events
    event VaultCreated(bytes32 indexed vaultId, address indexed user, uint256 btcAmount);
    event Borrowed(bytes32 indexed vaultId, address indexed user, uint256 amount);
    event Repaid(bytes32 indexed vaultId, address indexed user, uint256 amount);
    event Liquidated(bytes32 indexed vaultId, address indexed liquidator, uint256 debt, uint256 collateral);
    event PriceFeedUpdated(address indexed newFeed);
    event GhostPoolUpdated(address indexed newPool);
    
    constructor(
        address _verifier, 
        address _ghostUSD,
        address _priceFeed
    ) Ownable(msg.sender) {
        require(_verifier != address(0), "Invalid verifier");
        require(_ghostUSD != address(0), "Invalid token");
        require(_priceFeed != address(0), "Invalid price feed");
        
        verifier = IGroth16Verifier(_verifier);
        ghostUSD = GhostUSD(_ghostUSD);
        priceFeed = AggregatorV3Interface(_priceFeed);
    }

    function setGhostPool(address _ghostPool) external onlyOwner {
        require(_ghostPool != address(0), "Invalid address");
        ghostPool = IGhostPool(_ghostPool);
        emit GhostPoolUpdated(_ghostPool);
    }
    
    function createVault(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[2] memory input,
        bytes32 vaultId
    ) external {
        require(input[0] == uint256(vaultId), "Invalid commitment");
        require(verifier.verify(a, b, c, input), "Invalid proof");
        require(positions[vaultId].user == address(0), "Vault exists");
        
        uint256 btcAmount = input[1];
        require(btcAmount > 0, "Invalid amount");
        
        Position storage pos = positions[vaultId];
        pos.vaultId = vaultId;
        pos.user = msg.sender;
        pos.collateralBTC = btcAmount;
        pos.active = true;
        pos.lastUpdate = block.timestamp;
        
        userVaults[msg.sender].push(vaultId);
        allVaults.push(vaultId);
        totalCollateralBTC += btcAmount;
        
        emit VaultCreated(vaultId, msg.sender, btcAmount);
    }
    
    function borrow(bytes32 vaultId, uint256 amount) external nonReentrant {
        Position storage pos = positions[vaultId];
        require(pos.active, "Vault not active");
        require(pos.user == msg.sender, "Not owner");
        require(amount > 0, "Invalid amount");
        require(address(ghostPool) != address(0), "Pool not set");
        
        _accrueInterest(vaultId);
        
        (, int256 price, , , ) = priceFeed.latestRoundData();
        require(price > 0, "Invalid price");
        uint256 btcPrice = uint256(price) * BTC_PRICE_SCALE; 
        
        uint256 collateralValue = (pos.collateralBTC * btcPrice) / 1e8;
        uint256 maxBorrow = (collateralValue * LTV) / 100;
        uint256 totalDebt = pos.debtAmount + pos.accruedInterest;
        
        require(totalDebt + amount <= maxBorrow, "Exceeds collateral");
        
        // Mint GhostUSD as debt receipt
        ghostUSD.mint(msg.sender, amount);
        
        // Borrow real USDC from pool (Scale down 18 decimals to 6 decimals)
        require(amount >= USDC_SCALE, "Amount too small");
        uint256 usdcAmount = amount / USDC_SCALE;
        ghostPool.borrow(msg.sender, usdcAmount);

        pos.debtAmount += amount;
        totalBorrowed += amount;
        
        emit Borrowed(vaultId, msg.sender, amount);
    }
    
    function repay(bytes32 vaultId, uint256 amount) external nonReentrant {
        Position storage pos = positions[vaultId];
        require(pos.active, "Vault not active");
        require(amount > 0, "Invalid amount");
        require(address(ghostPool) != address(0), "Pool not set");
        
        _accrueInterest(vaultId);
        
        uint256 totalDebt = pos.debtAmount + pos.accruedInterest;
        uint256 repayAmount = amount > totalDebt ? totalDebt : amount;
        
        // 1. Burn GhostUSD (Debt Receipt)
        // User must approve GhostUSD
        ghostUSD.transferFrom(msg.sender, address(this), repayAmount);
        ghostUSD.burn(address(this), repayAmount);

        // 2. Repay USDC to Pool
        // User must approve USDC to Pool? No, GhostPool.repay calls transferFrom(repayer, ...).
        // So user needs to approve USDC for GhostPool contract.
        // Wait, GhostLending calls `ghostPool.repay`. `GhostPool.repay` does `usdc.transferFrom(repayer, ...)`
        // `repayer` passed is `msg.sender` (the user).
        // So User must approve USDC for GhostPool.
        
        // Calculate principal vs interest split
        uint256 interestPaid = 0;
        uint256 principalPaid = 0;

        if (repayAmount <= pos.accruedInterest) {
            interestPaid = repayAmount;
            pos.accruedInterest -= interestPaid;
        } else {
            interestPaid = pos.accruedInterest;
            principalPaid = repayAmount - interestPaid;
            pos.accruedInterest = 0;
            pos.debtAmount -= principalPaid;
        }
        
        // Send USDC to pool (Scale down 18 decimals to 6 decimals)
        uint256 usdcPrincipal = principalPaid / USDC_SCALE;
        uint256 usdcInterest = interestPaid / USDC_SCALE;
        
        // Ensure we don't revert on 0 transfer if precision loss makes it 0, 
        // Logic: If usdcPrincipal + usdcInterest > 0, call it.
        ghostPool.repay(msg.sender, usdcPrincipal, usdcInterest);
        
        totalBorrowed -= repayAmount;
        
        if (pos.debtAmount == 0 && pos.accruedInterest == 0) {
            pos.active = false;
            totalCollateralBTC -= pos.collateralBTC;
        }
        
        emit Repaid(vaultId, msg.sender, repayAmount);
    }
    
    function liquidate(bytes32 vaultId) external nonReentrant {
         Position storage pos = positions[vaultId];
        require(pos.active, "Vault not active");
        
        _accrueInterest(vaultId);
        
        uint256 healthFactor = _calculateHealthFactor(pos);
        require(healthFactor < 100, "Vault is healthy");
        
        uint256 totalDebt = pos.debtAmount + pos.accruedInterest;
        uint256 penalty = (totalDebt * LIQUIDATION_PENALTY) / 100;
        uint256 totalOwed = totalDebt + penalty;
        
        // Liquidator burns GhostUSD and assumes liability/asset transfer logic
        ghostUSD.transferFrom(msg.sender, address(this), totalOwed);
        ghostUSD.burn(address(this), totalDebt);
        
        pos.active = false;
        totalBorrowed -= totalDebt;
        totalCollateralBTC -= pos.collateralBTC;
        
        emit Liquidated(vaultId, msg.sender, totalDebt, pos.collateralBTC);
    }
    
    function getHealthFactor(bytes32 vaultId) external view returns (uint256) {
        Position storage pos = positions[vaultId];
        if (!pos.active) return type(uint256).max;
        return _calculateHealthFactor(pos);
    }
    
    function getMaxBorrow(bytes32 vaultId) external view returns (uint256) {
        Position storage pos = positions[vaultId];
        if (!pos.active) return 0;
        
        (, int256 price, , , ) = priceFeed.latestRoundData();
        uint256 btcPrice = uint256(price) * BTC_PRICE_SCALE; 
        
        uint256 collateralValue = (pos.collateralBTC * btcPrice) / 1e8;
        uint256 maxBorrow = (collateralValue * LTV) / 100;
        uint256 currentDebt = pos.debtAmount + _pendingInterest(pos);
        
        return maxBorrow > currentDebt ? maxBorrow - currentDebt : 0;
    }
    
    function getUserVaults(address user) external view returns (bytes32[] memory) {
        return userVaults[user];
    }
    
    function setPriceFeed(address _priceFeed) external onlyOwner {
        require(_priceFeed != address(0), "Invalid address");
        priceFeed = AggregatorV3Interface(_priceFeed);
        emit PriceFeedUpdated(_priceFeed);
    }
    
    function _accrueInterest(bytes32 vaultId) internal {
        Position storage pos = positions[vaultId];
        uint256 pending = _pendingInterest(pos);
        pos.accruedInterest += pending;
        pos.lastUpdate = block.timestamp;
    }
    
    function _pendingInterest(Position storage pos) internal view returns (uint256) {
        if (pos.debtAmount == 0) return 0;
        uint256 timeElapsed = block.timestamp - pos.lastUpdate;
        return (pos.debtAmount * INTEREST_RATE * timeElapsed) / (365 days * INTEREST_PRECISION);
    }
    
    function _calculateHealthFactor(Position storage pos) internal view returns (uint256) {
        uint256 totalDebt = pos.debtAmount + _pendingInterest(pos) + pos.accruedInterest;
        if (totalDebt == 0) return type(uint256).max;
        
        (, int256 price, , , ) = priceFeed.latestRoundData();
        uint256 btcPrice = uint256(price) * BTC_PRICE_SCALE; 
        
        uint256 collateralValue = (pos.collateralBTC * btcPrice) / 1e8;
        uint256 liquidationValue = (collateralValue * LIQUIDATION_THRESHOLD) / 100;
        
        return (liquidationValue * 100) / totalDebt;
    }
}