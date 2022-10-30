require('dotenv').config()
const common = require('./utils.js')

const abis = require('./abis');
const { mainnet: addresses } = require('./addressess');
const Flashloan = require("./contracts/builds/Flashloan.json");

const { ChainId, Token, TokenAmount, Pair } = require('@uniswap/sdk');

const Web3 = require('web3');
const web3 = new Web3(
  new Web3.providers.WebsocketProvider(process.env.INFURA_API_URL)
);

// Indicate web3 what private key should use when signing transactions
const { address : admin } = web3.eth.accounts.wallet.add(process.env.PRIVATE_KEY)


// Create a contract's pointer to the KyberNetworkProxy smart contract
const kyber = new web3.eth.Contract(
  abis.kyber.kyberNetworkProxy,
  addresses.kyber.kyberNetworkProxy
)

//const AMOUNT_ETH = 100;
let RECENT_ETH_PRICE_FROM_BINANCE; // The ETH Price will be continously pulled using the Binance API every time a new block is received

// AMOUNT_ETH & AMOUNT_DAI should be equals in order to perform the arbitrage succesfully!
//const AMOUNT_ETH_WEI = web3.utils.toWei(AMOUNT_ETH.toString())

const ONE_WEI = web3.utils.toBN(web3.utils.toWei('1'));
let AMOUNT_DAI_WEI; // Expressed in WEI format <--> The value of DAI should be equals to the value of ETH in USD dollars <--> The value of this var will be continously updated depending the latest price of ETH

const DIRECTION = {
  KyberToUniswap: 0,        // -> Buy ETH on Kyber, Sell it on Uniswap 
  UniswapToKyber: 1         // -> But ETH on Uniswap, Sell in on Kyber
}

// Calculate the price of ETH from Kyber
const updateEthPrice = async () => {
  const results = await kyber
    .methods
    .getExpectedRate(
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 
      addresses.tokens.dai, 
      1
    )
    .call();
  return web3.utils.toBN('1').mul(web3.utils.toBN(results.expectedRate)).div(ONE_WEI);
}

const init = async () => {
  const networkId = await web3.eth.net.getId();

  /*
  // Create a contract's pointer to the Flashloan smart contract
  // The Flashloan.sol contract must be deployed in the network, otherwise, the script execution will fail
  const flashloan = new web3.eth.Contract(
    Flashloan.abi,
    Flashloan.networks[networkId].address
  )
  */

  web3.eth.subscribe('newBlockHeaders')
    .on('data', async block => {
      console.log(`New block received. Block # ${block.number}`);

      ethPrice = await updateEthPrice();
      const AMOUNT_DAI_WEI = web3.utils.toBN(web3.utils.toWei(ethPrice.toString()));
      RECENT_ETH_PRICE_FROM_BINANCE = Math.round(await common.retrieveLatestEthPrice()); // Pull the latest eth price using the Binance API

      // Assign the contract's addresses for DAI & WETH tokens in the mainnet network
      const [dai, weth] = await Promise.all(
        [addresses.tokens.dai, addresses.tokens.weth].map(tokenAddress => (
          Token.fetchData(
            ChainId.MAINNET,
            tokenAddress,
          )
        )));

      // Fetch the contract's addresses for the DAI/WETH pair in Uniswap
      const daiWeth = await Pair.fetchData(
        dai,
        weth
      );

      const amountsEth = await Promise.all([
        kyber
          .methods
          .getExpectedRate(
            addresses.tokens.dai, 
            '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 
            AMOUNT_DAI_WEI
          ) 
          .call(),
        daiWeth.getOutputAmount(new TokenAmount(dai, AMOUNT_DAI_WEI)),
      ]);
      const ethFromKyber = AMOUNT_DAI_WEI.mul(web3.utils.toBN(amountsEth[0].expectedRate)).div(ONE_WEI);
      const ethFromUniswap = web3.utils.toBN(amountsEth[1][0].raw.toString());

      const amountsDai = await Promise.all([
        kyber
          .methods
          .getExpectedRate(
            '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 
            addresses.tokens.dai, 
            ethFromUniswap.toString()
          ) 
          .call(),
        daiWeth.getOutputAmount(new TokenAmount(weth, ethFromKyber.toString())),
      ]);
      const daiFromKyber = ethFromUniswap.mul(web3.utils.toBN(amountsDai[0].expectedRate)).div(ONE_WEI);
      const daiFromUniswap = web3.utils.toBN(amountsDai[1][0].raw.toString());

      console.log(`Kyber -> Uniswap. Dai input / output: ${web3.utils.fromWei(AMOUNT_DAI_WEI.toString())} / ${web3.utils.fromWei(daiFromUniswap.toString())}`);
      console.log(`Uniswap -> Kyber. Dai input / output: ${web3.utils.fromWei(AMOUNT_DAI_WEI.toString())} / ${web3.utils.fromWei(daiFromKyber.toString())}`);
      
      console.log(`Current ETH Price pulled from the Binance API: ${RECENT_ETH_PRICE_FROM_BINANCE}`);
      console.log(`AMOUNT_DAI_WEI based on the ETH Price from the Binance API: ${AMOUNT_DAI_WEI}`);
      console.log(`Current ETH Price pulled from Kyber: ${ethPrice}`);

      console.log(`ethFromKyber: ${web3.utils.fromWei(ethFromKyber)}`);
      console.log(`ethFromUniswap: ${web3.utils.fromWei(ethFromUniswap)}`);

      /**/

      /*
      * Querying the Kyber markets to get the token's prices
      * - First result is from DAI to ETH and reprents the rate of Buying ETH
      * - Second result is from ETH to DAI and reprents the rate of Selling ETH
      */
     /*
      const kyberResults = await Promise.all([
        // from DAI to ETH  <--> How many ETHs in exchange for 1 DAI        ===> BUY ETH
        kyber.methods.getExpectedRate(
          addresses.tokens.dai,
          '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          AMOUNT_DAI_WEI
        ).call(),
        // from ETH to DAI  <--> How many DAIs are required to buy 1 ETH    ===> SELL ETH
        kyber.methods.getExpectedRate(
          '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          addresses.tokens.dai,
          AMOUNT_ETH_WEI
        ).call()
      ]);

      const kyberRates = {
        buy: parseFloat(1 / (kyberResults[0].expectedRate / (10 ** 18))),
        sell: parseFloat(kyberResults[1].expectedRate / (10 ** 18))
      }
      console.log("\n ETH/DAI price on Kyber");
      console.log(kyberRates);
      */
      /*
      * Querying the Uniswap DAI/WETH pair to get the token's prices
      * - First result is from DAI to ETH and reprents the rate of Buying ETH    (DAI is the input token ; ETH is the output token) => The pair receives DAI and gives ETH
      * - Second result is from ETH to DAI and reprents the rate of Selling ETH  (ETH is the input token ; DAI is the output token) => The pair receives ETH and gives DAI
      */
     /*
      const uniswapResults = await Promise.all([
        daiWeth.getOutputAmount(new TokenAmount(dai, AMOUNT_DAI_WEI)),
        daiWeth.getOutputAmount(new TokenAmount(weth, AMOUNT_ETH_WEI))
      ]);
      
      const uniswapRates = {
        buy: parseFloat( AMOUNT_DAI_WEI / (uniswapResults[0][0].toExact() * 10 ** 18)),
        sell: parseFloat(uniswapResults[1][0].toExact() / AMOUNT_ETH),
      };
      console.log("\n ETH/DAI price on Uniswap");
      console.log(uniswapRates);
      */

      // Calculate the current ETH price by getting the average of the prices that were pulled from Kyber and the Binance API
      const currentEthPrice = ( ethPrice + RECENT_ETH_PRICE_FROM_BINANCE ) / 2;

      // Kyber -> Uniswap
      if(daiFromUniswap.gt(AMOUNT_DAI_WEI)) {
        // Prepare/Define the transaction
        const tx = flashloan.methods.initiateFlashloan(
          addresses.dydx.solo, 
          addresses.tokens.dai, 
          AMOUNT_DAI_WEI,
          DIRECTION.KYBER_TO_UNISWAP
        );

        // Estimating gasCost of the above transactions
        const [gasPrice, gasCost] = await Promise.all([
          web3.eth.getGasPrice(),
          tx.estimateGas({from: admin}),
        ]);

        // Calculating the total cost of executing the arbitrage transaction
        const txCost = web3.utils.toBN(gasCost).mul(web3.utils.toBN(gasPrice)).mul(currentEthPrice);

        // Expected profit for an arbitrage operation by buying in Kyber and selling in Uniswap
        const profit = daiFromUniswap.sub(AMOUNT_DAI_WEI).sub(txCost);

        if(profit > 0) {
          console.log('Arb opportunity found Kyber -> Uniswap!');
          console.log(`Expected profit: ${web3.utils.fromWei(profit)} Dai`);
          const data = tx.encodeABI();
          const txData = {
            from: admin,
            to: flashloan.options.address,
            data,
            gas: gasCost,
            gasPrice
          };
          const receipt = await web3.eth.sendTransaction(txData);
          console.log(`Transaction hash: ${receipt.transactionHash}`);
        }
      }

      // Uniswap -> Kyber
      if(daiFromKyber.gt(AMOUNT_DAI_WEI)) {
        // Prepare/Define the transaction
        const tx = flashloan.methods.initiateFlashloan(
          addresses.dydx.solo, 
          addresses.tokens.dai, 
          AMOUNT_DAI_WEI,
          DIRECTION.UNISWAP_TO_KYBER
        );
        
        // Estimating gasCost of the above transactions
        const [gasPrice, gasCost] = await Promise.all([
          web3.eth.getGasPrice(),
          tx.estimateGas({from: admin}),
        ]);

        // Calculating the total cost of executing the arbitrage transaction
        const txCost = web3.utils.toBN(gasCost).mul(web3.utils.toBN(gasPrice)).mul(currentEthPrice);

        // Expected profit for an arbitrage operation by buying in Uniswap and selling in Kyber
        const profit = daiFromKyber.sub(AMOUNT_DAI_WEI).sub(txCost);

        if(profit > 0) {
          console.log('Arb opportunity found Uniswap -> Kyber!');
          console.log(`Expected profit: ${web3.utils.fromWei(profit)} Dai`);
          const data = tx.encodeABI();
          const txData = {
            from: admin,
            to: flashloan.options.address,
            data,
            gas: gasCost,
            gasPrice
          };
          const receipt = await web3.eth.sendTransaction(txData);
          console.log(`Transaction hash: ${receipt.transactionHash}`);
        }
      }


      /*

      // Prepare/Define the transaction
      const [tx1, tx2] = Object.keys(DIRECTION).map(direction => flashloan.methods.initiateFlashloan(
        addresses.dydx.solo,
        addresses.tokens.dai,
        AMOUNT_DAI_WEI,   // AMOUNT OF DAI TO BORROW
        DIRECTION[direction]
      ))

      // Estimating gasCost of the above transactions
      const [gasPrice, gasCost1, gasCost2] = await Promise.all([
        web3.eth.getGasPrice(),
        tx1.estimateGas({from : admin}),
        tx2.estimateGas({from : admin})
      ])

      // Calculating the total cost of executing the arbitrage transaction
      const txCost1 = parseInt(gasCost1) * parseInt(gasPrice);
      const txCost2 = parseInt(gasCost2) * parseInt(gasPrice);

      //200000 is picked arbitrarily, will be replaced by the actual tx gas cost using Web3 estimateGas()
      //const txCost = 200000 * parseInt(gasPrice);
      

      const uniswapETHAveragePrice = (uniswapRates.buy + uniswapRates.sell) / 2;
      const kyberETHAveragePrice = (kyberRates.buy + kyberRates.sell) / 2;
      
      

      // arbitraging by buying in Kyber and selling in Uniswap
      const profit1 = (parseInt(AMOUNT_ETH_WEI) / 10 ** 18) * (uniswapRates.sell - kyberRates.buy) - (txCost1 / 10 ** 18) * currentEthPrice;
      
      // arbitraging by buying in Uniswap and selling in Kyber
      const profit2 = (parseInt(AMOUNT_ETH_WEI) / 10 ** 18) * (kyberRates.sell - uniswapRates.buy) - (txCost2 / 10 ** 18) * currentEthPrice;

      if(profit1 > 0) {
        console.log('Arbitrage opportunity found!');
        console.log(`Buy ETH on Kyber at ${kyberRates.buy} dai`);
        console.log(`Sell ETH on Uniswap at ${uniswapRates.sell} dai`);
        console.log(`Expected profit: ${profit1} dai`);
        //Execute arb Kyber <=> Uniswap
        const data = tx1.encodeABI()
        const txData = {
          from: admin,
          to: flashloan.options.address,
          data,
          gas: gasCost1,
          gasPrice
        }
        const receipt = await web3.eth.sendTransaction(txData);
      } else if(profit2 > 0) {
        console.log('Arbitrage opportunity found!');
        console.log(`Buy ETH from Uniswap at ${uniswapRates.buy} dai`);
        console.log(`Sell ETH from Kyber at ${kyberRates.sell} dai`);
        console.log(`Expected profit: ${profit2} dai`);
        //Execute arb Uniswap <=> Kyber
        const data = tx2.encodeABI()
        const txData = {
          from: admin,
          to: flashloan.options.address,
          data,
          gas: gasCost2,
          gasPrice
        }
        const receipt = await web3.eth.sendTransaction(txData);
      } else {
        console.log("At the moment there is no arbitrage opportunity");
      }

      */

      console.log("\n\n");

    })
    .on('error', error => {
      console.log(error);
    });
}
init();