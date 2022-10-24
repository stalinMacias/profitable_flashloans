require('dotenv').config()
const common = require('./utils.js')

const abis = require('./abis');
const { mainnet: addresses } = require('./addressess');

const { ChainId, Token, TokenAmount, Pair } = require('@uniswap/sdk');

const Web3 = require('web3');
const web3 = new Web3(
  new Web3.providers.WebsocketProvider(process.env.INFURA_API_URL)
);


// Create an instance of the KyberNetworkProxy smart contract
const kyber = new web3.eth.Contract(
  abis.kyber.kyberNetworkProxy,
  addresses.kyber.kyberNetworkProxy
)

const AMOUNT_ETH = 100;
let RECENT_ETH_PRICE; // The ETH Price will be continously pulled using the Binance API every time a new block is received

// AMOUNT_ETH & AMOUNT_DAI should be equals in order to perform the arbitrage succesfully!
const AMOUNT_ETH_WEI = web3.utils.toWei(AMOUNT_ETH.toString())
let AMOUNT_DAI_WEI; // The value of DAI should be equals to the value of ETH in USD dollars <--> The value of this var will be continously updated depending the latest price of ETH


const init = async () => {
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

  web3.eth.subscribe('newBlockHeaders')
    .on('data', async block => {
      console.log(`New block received. Block # ${block.number}`);

      RECENT_ETH_PRICE = await common.retrieveLatestEthPrice(); // Pull the latest eth price using the Binance API
      AMOUNT_DAI_WEI = web3.utils.toWei((AMOUNT_ETH * RECENT_ETH_PRICE).toString()) // Calculate the required amount of DAI based on the latest price of ETH
      console.log(`Current ETH Price pulled from the Binance API: ${RECENT_ETH_PRICE}`);
      console.log(`AMOUNT_DAI_WEI based on ETH Price from the Binance API: ${web3.utils.fromWei(AMOUNT_DAI_WEI)}`);

      /*
      * Querying the Kyber markets to get the token's prices
      * - First result is from DAI to ETH and reprents the rate of Buying ETH
      * - Second result is from ETH to DAI and reprents the rate of Selling ETH
      */
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

      /*
      * Querying the Uniswap DAI/WETH pair to get the token's prices
      * - First result is from DAI to ETH and reprents the rate of Buying ETH    (DAI is the input token ; ETH is the output token) => The pair receives DAI and gives ETH
      * - Second result is from ETH to DAI and reprents the rate of Selling ETH  (ETH is the input token ; DAI is the output token) => The pair receives ETH and gives DAI
      */
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

      console.log("\n\n");

    })
    .on('error', error => {
      console.log(error);
    });
}
init();