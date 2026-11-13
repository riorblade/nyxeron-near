// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Robinhood Chain testnet only. The real stock tokens and USDG don't exist there, so the warehouse buys these instead:
// test dollars, synthetic stocks that read like the real ones (balanceOfUI, uiMultiplier), and a market that sells
// them at a posted price through the same `swap` call KyberSwap's router takes. None of it is worth anything.

/// Minimal ERC-20 shared by the two tokens below.
abstract contract ERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "allowance");
            allowance[from][msg.sender] = allowed - value;
        }
        _move(from, to, value);
        return true;
    }

    function _move(address from, address to, uint256 value) internal {
        require(to != address(0), "to zero");
        require(balanceOf[from] >= value, "balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _mint(address to, uint256 value) internal {
        require(to != address(0), "to zero");
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }
}

/// Test dollars with USDG's 6 decimals. Only the deployer mints (it funds the warehouse).
contract TestUSDG is ERC20 {
    address public immutable owner;

    constructor() ERC20("Test USDG (Robinhood Chain testnet)", "tUSDG", 6) {
        owner = msg.sender;
    }

    function mint(address to, uint256 value) external {
        require(msg.sender == owner, "owner");
        _mint(to, value);
    }
}

/// A synthetic stock with the real tokens' 18 decimals and read functions. Only its market mints it.
contract SyntheticStock is ERC20 {
    address public immutable market;

    constructor(string memory name_, string memory symbol_, address market_) ERC20(name_, symbol_, 18) {
        market = market_;
    }

    function mint(address to, uint256 value) external {
        require(msg.sender == market, "market");
        _mint(to, value);
    }

    /// Splits and the like never happen here: 1 token = 1 share.
    function uiMultiplier() public pure returns (uint256) {
        return 1e18;
    }

    function balanceOfUI(address account) external view returns (uint256) {
        return (balanceOf[account] * uiMultiplier()) / 1e18;
    }
}

/// Sells synthetic stocks for test dollars at a price the poster keeps current. `swap` takes KyberSwap's
/// MetaAggregationRouterV2 argument, so the api builds, checks and proves a testnet purchase exactly like a mainnet one.
contract SyntheticMarket {
    struct SwapDescriptionV2 {
        address srcToken;
        address dstToken;
        address[] srcReceivers;
        uint256[] srcAmounts;
        address[] feeReceivers;
        uint256[] feeAmounts;
        address dstReceiver;
        uint256 amount;
        uint256 minReturnAmount;
        uint256 flags;
        bytes permit;
    }

    struct SwapExecutionParams {
        address callTarget;
        address approveTarget;
        bytes targetData;
        SwapDescriptionV2 desc;
        bytes clientData;
    }

    /// A price older than this is refused: the api posts a fresh one before it buys.
    uint256 public constant MAX_PRICE_AGE = 1 hours;

    address public immutable owner;
    ERC20 public immutable usdg;
    address public poster;
    mapping(address => bool) public listed;
    /// Micro-USDG per whole token (1e18 raw), and when it was posted.
    mapping(address => uint256) public priceMicro;
    mapping(address => uint256) public pricedAt;

    event Listed(address indexed token);
    event PosterSet(address indexed poster);
    event PriceSet(address indexed token, uint256 priceMicro);
    event Bought(address indexed buyer, address indexed token, address indexed to, uint256 usdgIn, uint256 out);

    constructor(ERC20 usdg_) {
        owner = msg.sender;
        usdg = usdg_;
    }

    function list(address token) external {
        require(msg.sender == owner, "owner");
        require(SyntheticStock(token).market() == address(this), "not ours");
        listed[token] = true;
        emit Listed(token);
    }

    function setPoster(address poster_) external {
        require(msg.sender == owner, "owner");
        poster = poster_;
        emit PosterSet(poster_);
    }

    function setPrice(address token, uint256 priceMicro_) external {
        require(msg.sender == poster || msg.sender == owner, "poster");
        require(listed[token], "not listed");
        require(priceMicro_ > 0, "zero price");
        priceMicro[token] = priceMicro_;
        pricedAt[token] = block.timestamp;
        emit PriceSet(token, priceMicro_);
    }

    /// Raw tokens (18 decimals) that `amountIn` micro-USDG buys now.
    function quote(address token, uint256 amountIn) public view returns (uint256) {
        require(listed[token], "not listed");
        uint256 price = priceMicro[token];
        require(price > 0 && block.timestamp - pricedAt[token] <= MAX_PRICE_AGE, "stale price");
        return (amountIn * 1e18) / price;
    }

    function swap(SwapExecutionParams calldata execution)
        external
        payable
        returns (uint256 returnAmount, uint256 gasUsed)
    {
        require(msg.value == 0, "no value");
        SwapDescriptionV2 calldata d = execution.desc;
        require(d.srcToken == address(usdg), "src");
        require(d.feeReceivers.length == 0, "fee");
        uint256 out = quote(d.dstToken, d.amount);
        require(out > 0 && out >= d.minReturnAmount, "min return");
        require(usdg.transferFrom(msg.sender, address(this), d.amount), "pay");
        SyntheticStock(d.dstToken).mint(d.dstReceiver, out);
        emit Bought(msg.sender, d.dstToken, d.dstReceiver, d.amount, out);
        return (out, 0);
    }
}
