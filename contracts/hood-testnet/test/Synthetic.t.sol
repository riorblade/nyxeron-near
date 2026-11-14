// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestUSDG, SyntheticStock, SyntheticMarket} from "../src/Synthetic.sol";

// Just the cheatcodes these tests use (no forge-std dependency).
interface Vm {
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert(bytes calldata) external;
}

contract SyntheticTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant POSTER = address(0xB0B);
    address constant WAREHOUSE = address(0xAAA);

    TestUSDG usdg;
    SyntheticMarket market;
    SyntheticStock tsla;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdg = new TestUSDG();
        market = new SyntheticMarket(usdg);
        tsla = new SyntheticStock("Synthetic Tesla (testnet)", "sTSLA", address(market));
        market.list(address(tsla));
        market.setPoster(POSTER);
        vm.prank(POSTER);
        market.setPrice(address(tsla), 400_000_000); // $400
        usdg.mint(WAREHOUSE, 1_000_000_000); // $1,000
    }

    function desc(uint256 amount, uint256 minOut) internal view returns (SyntheticMarket.SwapExecutionParams memory e) {
        e.desc.srcToken = address(usdg);
        e.desc.dstToken = address(tsla);
        e.desc.dstReceiver = WAREHOUSE;
        e.desc.amount = amount;
        e.desc.minReturnAmount = minOut;
    }

    function buy(uint256 amount, uint256 minOut) internal returns (uint256 out) {
        vm.prank(WAREHOUSE);
        usdg.approve(address(market), amount);
        vm.prank(WAREHOUSE);
        (out,) = market.swap(desc(amount, minOut));
    }

    function eq(uint256 a, uint256 b, string memory what) internal pure {
        require(a == b, what);
    }

    function test_buys_at_the_posted_price() public {
        uint256 out = buy(4_000_000, 0.01e18); // $4 at $400 = 0.01 share
        eq(out, 0.01e18, "out");
        eq(tsla.balanceOf(WAREHOUSE), 0.01e18, "shares");
        eq(tsla.balanceOfUI(WAREHOUSE), 0.01e18, "ui");
        eq(usdg.balanceOf(WAREHOUSE), 996_000_000, "paid");
        eq(usdg.balanceOf(address(market)), 4_000_000, "market kept");
        eq(tsla.uiMultiplier(), 1e18, "multiplier");
    }

    function test_refuses_less_than_min_return() public {
        vm.prank(WAREHOUSE);
        usdg.approve(address(market), 4_000_000);
        SyntheticMarket.SwapExecutionParams memory e = desc(4_000_000, 0.01e18 + 1);
        vm.prank(WAREHOUSE);
        vm.expectRevert(bytes("min return"));
        market.swap(e);
    }

    function test_refuses_a_stale_price() public {
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(bytes("stale price"));
        market.quote(address(tsla), 1_000_000);
    }

    function test_refuses_without_payment() public {
        SyntheticMarket.SwapExecutionParams memory e = desc(4_000_000, 0);
        vm.prank(WAREHOUSE);
        vm.expectRevert(bytes("allowance"));
        market.swap(e);
    }

    function test_refuses_another_src_token() public {
        SyntheticMarket.SwapExecutionParams memory e = desc(4_000_000, 0);
        e.desc.srcToken = address(tsla);
        vm.expectRevert(bytes("src"));
        market.swap(e);
    }

    function test_refuses_an_unlisted_token() public {
        SyntheticStock other = new SyntheticStock("Other", "sX", address(market));
        SyntheticMarket.SwapExecutionParams memory e = desc(4_000_000, 0);
        e.desc.dstToken = address(other);
        vm.expectRevert(bytes("not listed"));
        market.swap(e);
    }

    function test_only_the_poster_or_owner_sets_prices() public {
        vm.prank(WAREHOUSE);
        vm.expectRevert(bytes("poster"));
        market.setPrice(address(tsla), 1);
    }

    function test_only_the_market_mints_stock() public {
        vm.expectRevert(bytes("market"));
        tsla.mint(WAREHOUSE, 1);
    }

    function test_only_the_owner_mints_dollars() public {
        vm.prank(WAREHOUSE);
        vm.expectRevert(bytes("owner"));
        usdg.mint(WAREHOUSE, 1);
    }

    function test_only_the_owner_lists() public {
        SyntheticStock other = new SyntheticStock("Other", "sX", address(market));
        vm.prank(WAREHOUSE);
        vm.expectRevert(bytes("owner"));
        market.list(address(other));
    }

    function test_lists_only_its_own_stocks() public {
        SyntheticStock foreign = new SyntheticStock("Foreign", "sF", address(0xDEAD));
        vm.expectRevert(bytes("not ours"));
        market.list(address(foreign));
    }
}
