// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IMintableERC20 {
    function mint(address to, uint256 amount) external;
    function decimals() external view returns (uint8);
}

/**
 * @title TokenFaucet
 * @notice Faucet contract that mints test tokens to users
 * @dev Users can request tokens once per cooldown period
 */
contract TokenFaucet is Ownable {
    // Token info struct
    struct TokenInfo {
        address tokenAddress;
        string symbol;
        uint256 amountPerRequest;
        uint8 decimals;
    }
    
    // Array of supported tokens
    TokenInfo[] public tokens;
    
    // Cooldown period between requests (default 1 hour)
    uint256 public cooldownPeriod = 1 hours;
    
    // Last request timestamp per user
    mapping(address => uint256) public lastRequestTime;
    
    // Events
    event TokensRequested(address indexed user, uint256 timestamp);
    event TokenAdded(address indexed token, string symbol, uint256 amountPerRequest);
    event TokenRemoved(address indexed token);
    event CooldownUpdated(uint256 newCooldown);
    
    constructor() Ownable(msg.sender) {}
    
    /**
     * @notice Add a token to the faucet
     * @param tokenAddress Address of the token contract
     * @param symbol Token symbol for display
     * @param amountPerRequest Amount to mint per request (in token units, not wei)
     */
    function addToken(
        address tokenAddress,
        string memory symbol,
        uint256 amountPerRequest
    ) external onlyOwner {
        uint8 decimals = IMintableERC20(tokenAddress).decimals();
        tokens.push(TokenInfo({
            tokenAddress: tokenAddress,
            symbol: symbol,
            amountPerRequest: amountPerRequest,
            decimals: decimals
        }));
        emit TokenAdded(tokenAddress, symbol, amountPerRequest);
    }
    
    /**
     * @notice Remove a token from the faucet
     * @param index Index of the token to remove
     */
    function removeToken(uint256 index) external onlyOwner {
        require(index < tokens.length, "Invalid index");
        address tokenAddr = tokens[index].tokenAddress;
        tokens[index] = tokens[tokens.length - 1];
        tokens.pop();
        emit TokenRemoved(tokenAddr);
    }
    
    /**
     * @notice Update cooldown period
     * @param newCooldown New cooldown in seconds
     */
    function setCooldownPeriod(uint256 newCooldown) external onlyOwner {
        cooldownPeriod = newCooldown;
        emit CooldownUpdated(newCooldown);
    }
    
    /**
     * @notice Request tokens from the faucet
     * @dev Mints all supported tokens to the caller
     */
    function requestTokens() external {
        require(
            block.timestamp >= lastRequestTime[msg.sender] + cooldownPeriod,
            "Cooldown not expired"
        );
        
        lastRequestTime[msg.sender] = block.timestamp;
        
        for (uint256 i = 0; i < tokens.length; i++) {
            TokenInfo memory token = tokens[i];
            uint256 amount = token.amountPerRequest * (10 ** token.decimals);
            IMintableERC20(token.tokenAddress).mint(msg.sender, amount);
        }
        
        emit TokensRequested(msg.sender, block.timestamp);
    }
    
    /**
     * @notice Request tokens for a specific address (anyone can call)
     * @param recipient Address to receive tokens
     */
    function requestTokensFor(address recipient) external {
        require(recipient != address(0), "Invalid recipient");
        require(
            block.timestamp >= lastRequestTime[recipient] + cooldownPeriod,
            "Cooldown not expired"
        );
        
        lastRequestTime[recipient] = block.timestamp;
        
        for (uint256 i = 0; i < tokens.length; i++) {
            TokenInfo memory token = tokens[i];
            uint256 amount = token.amountPerRequest * (10 ** token.decimals);
            IMintableERC20(token.tokenAddress).mint(recipient, amount);
        }
        
        emit TokensRequested(recipient, block.timestamp);
    }
    
    /**
     * @notice Get number of supported tokens
     */
    function getTokenCount() external view returns (uint256) {
        return tokens.length;
    }
    
    /**
     * @notice Get all token info
     */
    function getAllTokens() external view returns (TokenInfo[] memory) {
        return tokens;
    }
    
    /**
     * @notice Check if user can request tokens
     */
    function canRequest(address user) external view returns (bool) {
        return block.timestamp >= lastRequestTime[user] + cooldownPeriod;
    }
    
    /**
     * @notice Get time until user can request again
     */
    function timeUntilNextRequest(address user) external view returns (uint256) {
        uint256 nextRequestTime = lastRequestTime[user] + cooldownPeriod;
        if (block.timestamp >= nextRequestTime) {
            return 0;
        }
        return nextRequestTime - block.timestamp;
    }
}
