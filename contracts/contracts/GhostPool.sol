// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title GhostPool - Liquidity Pool for GhostYield
/// @notice Lenders deposit USDC to earn yield from borrowers
/// @dev Uses share-based accounting for fair interest distribution
contract GhostPool is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ==================== EVENTS ====================
    event Deposit(address indexed lender, uint256 amount, uint256 shares);
    event Withdraw(address indexed lender, uint256 amount, uint256 shares);
    event Borrow(address indexed borrower, uint256 amount);
    event Repay(address indexed borrower, uint256 principal, uint256 interest);
    event InterestAccrued(uint256 totalInterest, uint256 timestamp);
    event GhostLendingSet(address indexed ghostLending);

    // ==================== STATE ====================
    IERC20 public immutable usdc;
    address public ghostLending;

    // Pool accounting
    uint256 public totalDeposited;
    uint256 public totalShares;
    uint256 public totalBorrowed;
    uint256 public totalInterestEarned;
    uint256 public lastInterestUpdate;

    // Lender balances (shares-based)
    mapping(address => uint256) public shares;
    mapping(address => uint256) public depositTimestamp;

    // Interest rate model (basis points, 100 = 1%)
    uint256 public constant BASE_RATE = 200; // 2% base APY
    uint256 public constant RATE_SLOPE = 1000; // +10% at 100% utilization
    uint256 public constant OPTIMAL_UTILIZATION = 8000; // 80%
    uint256 public constant RATE_SLOPE_EXCESS = 3000; // +30% above optimal
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    // Protocol fee (10% of interest)
    uint256 public constant PROTOCOL_FEE = 1000; // 10%
    uint256 public protocolFees;

    // ==================== MODIFIERS ====================
    modifier onlyGhostLending() {
        require(msg.sender == ghostLending, "Only GhostLending");
        _;
    }

    modifier updateInterest() {
        _accrueInterest();
        _;
    }

    // ==================== CONSTRUCTOR ====================
    constructor(address _usdc) Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid USDC address");
        usdc = IERC20(_usdc);
        lastInterestUpdate = block.timestamp;
    }

    // ==================== ADMIN ====================

    /// @notice Set the GhostLending contract address
    /// @param _ghostLending Address of GhostLending contract
    function setGhostLending(address _ghostLending) external onlyOwner {
        require(_ghostLending != address(0), "Invalid address");
        ghostLending = _ghostLending;
        emit GhostLendingSet(_ghostLending);
    }

    /// @notice Withdraw protocol fees
    /// @param to Address to send fees
    function withdrawProtocolFees(address to) external onlyOwner {
        require(to != address(0), "Invalid address");
        uint256 amount = protocolFees;
        protocolFees = 0;
        usdc.safeTransfer(to, amount);
    }

    // ==================== LENDER FUNCTIONS ====================

    /// @notice Deposit USDC to earn yield
    /// @param amount Amount of USDC to deposit
    function deposit(uint256 amount) external nonReentrant updateInterest {
        require(amount > 0, "Amount must be > 0");

        // Calculate shares to mint
        uint256 sharesToMint;
        if (totalShares == 0) {
            sharesToMint = amount;
        } else {
            sharesToMint = (amount * totalShares) / totalDeposited;
        }

        // Transfer USDC from lender
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        // Update state
        shares[msg.sender] += sharesToMint;
        totalShares += sharesToMint;
        totalDeposited += amount;
        depositTimestamp[msg.sender] = block.timestamp;

        emit Deposit(msg.sender, amount, sharesToMint);
    }

    /// @notice Withdraw USDC + earned interest
    /// @param shareAmount Number of shares to redeem
    function withdraw(uint256 shareAmount) external nonReentrant updateInterest {
        require(shareAmount > 0, "Shares must be > 0");
        require(shares[msg.sender] >= shareAmount, "Insufficient shares");

        // Calculate USDC to return
        uint256 amountToReturn = (shareAmount * totalDeposited) / totalShares;
        
        // Check available liquidity
        uint256 availableLiquidity = usdc.balanceOf(address(this)) - protocolFees;
        require(amountToReturn <= availableLiquidity, "Insufficient liquidity");

        // Update state
        shares[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        totalDeposited -= amountToReturn;

        // Transfer USDC to lender
        usdc.safeTransfer(msg.sender, amountToReturn);

        emit Withdraw(msg.sender, amountToReturn, shareAmount);
    }

    /// @notice Get lender's current balance (principal + interest)
    /// @param lender Address of lender
    /// @return Current USDC value of lender's shares
    function balanceOf(address lender) external view returns (uint256) {
        if (totalShares == 0 || shares[lender] == 0) return 0;
        return (shares[lender] * totalDeposited) / totalShares;
    }

    // ==================== GHOSTLENDING INTEGRATION ====================

    /// @notice Borrow USDC from pool (called by GhostLending)
    /// @param borrower Address receiving the funds
    /// @param amount Amount to borrow
    function borrow(address borrower, uint256 amount) 
        external 
        onlyGhostLending 
        nonReentrant 
        updateInterest 
    {
        require(amount > 0, "Amount must be > 0");
        
        uint256 availableLiquidity = usdc.balanceOf(address(this)) - protocolFees;
        require(amount <= availableLiquidity, "Insufficient liquidity");

        totalBorrowed += amount;
        usdc.safeTransfer(borrower, amount);

        emit Borrow(borrower, amount);
    }

    /// @notice Repay borrowed USDC (called by GhostLending)
    /// @param repayer Address repaying
    /// @param principal Principal amount being repaid
    /// @param interest Interest amount being repaid
    function repay(address repayer, uint256 principal, uint256 interest) 
        external 
        onlyGhostLending 
        nonReentrant 
        updateInterest 
    {
        require(principal > 0, "Principal must be > 0");
        require(totalBorrowed >= principal, "Invalid principal");

        uint256 totalAmount = principal + interest;
        usdc.safeTransferFrom(repayer, address(this), totalAmount);

        // Protocol takes fee from interest
        uint256 protocolFee = (interest * PROTOCOL_FEE) / BASIS_POINTS;
        uint256 lenderInterest = interest - protocolFee;

        totalBorrowed -= principal;
        totalDeposited += lenderInterest; // Interest goes to lenders
        protocolFees += protocolFee;
        totalInterestEarned += interest;

        emit Repay(repayer, principal, interest);
    }

    // ==================== VIEW FUNCTIONS ====================

    /// @notice Get current pool utilization rate
    /// @return Utilization in basis points (0-10000)
    function getUtilization() public view returns (uint256) {
        if (totalDeposited == 0) return 0;
        return (totalBorrowed * BASIS_POINTS) / totalDeposited;
    }

    /// @notice Get current borrow APY
    /// @return APY in basis points
    function getBorrowAPY() public view returns (uint256) {
        uint256 utilization = getUtilization();
        
        if (utilization <= OPTIMAL_UTILIZATION) {
            // Below optimal: gradual increase
            return BASE_RATE + (utilization * RATE_SLOPE) / BASIS_POINTS;
        } else {
            // Above optimal: steep increase
            uint256 baseAPY = BASE_RATE + (OPTIMAL_UTILIZATION * RATE_SLOPE) / BASIS_POINTS;
            uint256 excessUtil = utilization - OPTIMAL_UTILIZATION;
            return baseAPY + (excessUtil * RATE_SLOPE_EXCESS) / BASIS_POINTS;
        }
    }

    /// @notice Get current supply APY for lenders
    /// @return APY in basis points
    function getSupplyAPY() public view returns (uint256) {
        uint256 utilization = getUtilization();
        uint256 borrowAPY = getBorrowAPY();
        
        // Supply APY = Borrow APY * Utilization * (1 - Protocol Fee)
        uint256 grossAPY = (borrowAPY * utilization) / BASIS_POINTS;
        return (grossAPY * (BASIS_POINTS - PROTOCOL_FEE)) / BASIS_POINTS;
    }

    /// @notice Get available liquidity for borrowing
    /// @return Available USDC
    function getAvailableLiquidity() external view returns (uint256) {
        uint256 balance = usdc.balanceOf(address(this));
        return balance > protocolFees ? balance - protocolFees : 0;
    }

    /// @notice Get pool statistics
    function getPoolStats() external view returns (
        uint256 _totalDeposited,
        uint256 _totalBorrowed,
        uint256 _utilization,
        uint256 _supplyAPY,
        uint256 _borrowAPY
    ) {
        return (
            totalDeposited,
            totalBorrowed,
            getUtilization(),
            getSupplyAPY(),
            getBorrowAPY()
        );
    }

    // ==================== INTERNAL ====================

    /// @notice Accrue interest based on time elapsed
    function _accrueInterest() internal {
        if (totalBorrowed == 0) {
            lastInterestUpdate = block.timestamp;
            return;
        }

        uint256 timeElapsed = block.timestamp - lastInterestUpdate;
        if (timeElapsed == 0) return;

        uint256 borrowAPY = getBorrowAPY();
        uint256 interestAccrued = (totalBorrowed * borrowAPY * timeElapsed) / (BASIS_POINTS * SECONDS_PER_YEAR);

        if (interestAccrued > 0) {
            // Protocol fee
            uint256 protocolFee = (interestAccrued * PROTOCOL_FEE) / BASIS_POINTS;
            uint256 lenderInterest = interestAccrued - protocolFee;

            totalDeposited += lenderInterest;
            protocolFees += protocolFee;
            totalInterestEarned += interestAccrued;

            emit InterestAccrued(interestAccrued, block.timestamp);
        }

        lastInterestUpdate = block.timestamp;
    }
}
