pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "@studydefi/money-legos/dydx/contracts/DydxFlashloanBase.sol";
import "@studydefi/money-legos/dydx/contracts/ICallee.sol";

import { KyberNetworkProxy as IKyberNetworkProxy } from '@studydefi/money-legos/kyber/contracts/KyberNetworkProxy.sol';

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IUniswapV2Router02.sol";
import "./IWeth.sol";


contract FlashLoan is ICallee, DydxFlashloanBase {
    // Direction for the arbitrage
    enum Direction { 
        KyberToUniswap, // 0 -> Buy ETH on Kyber, Sell it on Uniswap
        UniswapToKyber  // 1 -> But ETH on Uniswap, Sell in on Kyber
    }

    // Custom Data that will be sent over the call action
    struct ArbInfo {
        Direction direction;
        uint repayAmount;
    }

    IKyberNetworkProxy kyber;
    IUniswapV2Router02 uniswap;
    IWeth weth;
    IERC20 dai;
    address constant KYBER_ETH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    constructor(
        address kyberAddress,
        address uniswapAddress,
        address wethAddress,
        address daiAddress,
    ) public {
        kyber = IKyberNetworkProxy(kyberAddress);
        uniswap = IUniswapV2Router02(uniswapAddress);
        weth = IWeth(wethAddress);
        dai = IERC20(daiAddress);
    }

    // fallback function <--> Compatible Syntaxis for Solidity v0.5.0
    function() external payable {}

    // This is the function that will be called postLoan
    // i.e. Encode the logic to handle your flashloaned funds here
    // The arbitrage opeartion will be executed in this function
    function callFunction(
        address sender,
        Account.Info memory account,
        bytes memory data
    ) public {
        ArbInfo memory arbInfo = abi.decode(data, (ArbInfo));

        // Get the DAI Balance on this contract after the flashloan was executed!
        uint daiBalance = dai.balanceOf(address(this));

        // Determine the direction of the Arbitrage Operation
        if(arbInfo.direction == Direction.KyberToUniswap) {
            // Buy ETH on Kyber, Sell it on Uniswap

            // BUY ETH on Kyber
            dai.approve(kyber,daiBalance);
            (uint expectedRate, ) = kyber.expectedRate(
                dai, 
                IERC20(KYBER_ETH_ADDRESS), 
                balanceDai
            );
            kyber.swapTokenToEther(dai, balanceDai, expectedRate);

            // Sell ETH on Uniswap
            address[] memory path = new address[](2);   // path array to swap from ETH to DAI
            path[0] = address(weth);
            path[1] = address(dai);
            // Calculate the minium amount of DAI in exchange for all the ETH this contract is holding
            uint[] memory minOuts = uniswap.getAmountsOut(address(this).balance, path); // Will return only one value, because the path array only makes one swap <-> From WETH to DAI
            // Swap all the ETH for the most possible amount of DAI
            uniswap.swapExactETHForTokens.value(address(this).balance)(
                minOuts[1], 
                path, 
                address(this), 
                now
            );
        }

        // Validate there is enough DAI balance on this contract to repay the dy/dx flashloan
        require(daiBalance >= arbInfo.repayAmount, "Not enough DAI to repay the dy/dx flashloan");

    }

    // This function is called to initiate the entire process, ask for the flashloan, then run the arbitrage operation, repay the flashloan and withdraw the profits
    function initiateFlashLoan(
        address _solo, 
        address _token, 
        uint256 _amount,
        Direction _direction
    ) external {
        ISoloMargin solo = ISoloMargin(_solo);

        // Get marketId from token address
        uint256 marketId = _getMarketIdFromTokenAddress(_solo, _token);

        // Calculate repay amount (_amount + (2 wei))
        // Approve transfer from
        uint256 repayAmount = _getRepaymentAmountInternal(_amount);
        IERC20(_token).approve(_solo, repayAmount);

        // 1. Withdraw $
        // 2. Call callFunction(...)
        // 3. Deposit back $
        Actions.ActionArgs[] memory operations = new Actions.ActionArgs[](3);

        operations[0] = _getWithdrawAction(marketId, _amount);
        operations[1] = _getCallAction(
            // Encode ArbInfo for callFunction
            abi.encode(ArbInfo({Direction: _direction, repayAmount: repayAmount}))
        );
        operations[2] = _getDepositAction(marketId, repayAmount);

        Account.Info[] memory accountInfos = new Account.Info[](1);
        accountInfos[0] = _getAccountInfo();

        solo.operate(accountInfos, operations);
    }
}