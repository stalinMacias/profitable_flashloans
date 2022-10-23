require('dotenv').config()
const common = require('./utils.js')

const abis = require('./abis');
const { mainnet : address } = require('./addressess');

const Web3 = require('web3');
const web3 = new Web3(
  new Web3.providers.WebsocketProvider(process.env.INFURA_API_URL)
);


// Create an instance of the KyberNetworkProxy smart contract
const kyber = new web3.eth.Contract(
  abis.kyber.kyberNetworkProxy,
  address.kyber.kyberNetworkProxy
)

const AMOUNT_ETH = 100;
let RECENT_ETH_PRICE; // The ETH Price will be continously pulled using the Binance API every time a new block is received

// AMOUNT_ETH & AMOUNT_DAI should be equals in order to perform the arbitrage succesfully!
const AMOUNT_ETH_WEI = web3.utils.toWei(AMOUNT_ETH.toString())
let AMOUNT_DAI_WEI; // The value of DAI should be equals to the value of ETH in USD dollars <--> The value of this var will be continously updated depending the latest price of ETH


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
        address.tokens.dai,
        '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        AMOUNT_DAI_WEI
      ).call(),
      // from ETH to DAI  <--> How many DAIs are required to buy 1 ETH    ===> SELL ETH
      kyber.methods.getExpectedRate(
        '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        address.tokens.dai,
        AMOUNT_ETH_WEI
      ).call()
    ]);

    const kyberRates = {
      buy : parseFloat(1 / (kyberResults[0].expectedRate / (10 ** 18))),
      sell : parseFloat(kyberResults[1].expectedRate / (10 ** 18))
    }
    console.log("\n ETH/DAI price on Kyber");
    console.log(kyberRates);



    console.log("\n\n");

  })
  .on('error', error => {
    console.log(error);
  });