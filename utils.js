const axios = require('axios')

async function retrieveLatestEthPrice() {
  const resp = await axios({
    url: 'https://api.binance.com/api/v3/ticker/price',
    params: {
      symbol: 'ETHUSDT'
    },
    method: 'get'
  })
  return resp.data.price
}

module.exports = {
  retrieveLatestEthPrice
};