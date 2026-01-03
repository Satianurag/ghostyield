// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract GhostUSD is ERC20, Ownable {
    address public lendingContract;
    
    constructor() ERC20("GhostUSD", "gUSD") Ownable(msg.sender) {}
    
    function setLendingContract(address _lending) external onlyOwner {
        require(_lending != address(0), "Invalid address");
        lendingContract = _lending;
    }
    
    function mint(address to, uint256 amount) external {
        require(msg.sender == lendingContract, "Only lending");
        _mint(to, amount);
    }
    
    function burn(address from, uint256 amount) external {
        require(msg.sender == lendingContract, "Only lending");
        _burn(from, amount);
    }
}
