import express from 'express'
import {
  getAllIgActivities,
  getSetting,
  getSettings,
  getUser, newIgActivity,
  newUser,
  updateAccountSettings,
  userFindOne
} from "../lib/mongoDB";
import {closeActivity} from "../lib/rest";
import {APIClient} from "ig-trading-api";
import {step0} from "../lib/restV3";
import {lightstreamer2} from "../lib/lightstreamer2";
import {lightstreamer} from "../lib/lightstreamer";
import moment from "moment";
import momentTimeZone from "moment-timezone";
import axios from "axios";

const router = express.Router()

router.get('/start/:id', async function(req, res) {
  const accountId = req.params.id;
  // recupero dal db le informazioni relative all'utente accountId
  const accountData = await userFindOne(accountId)
  // quindi avvio su ig uno streamer che gestirà tutti gli eventi lanciati dalla piattaforma
  const response = await lightstreamer(accountData)

  if (response){
    console.log("avvio lightstreamer")
  }

  res.send(response)
});

router.get('/start2/:id', async function(req, res) {
  const accountId = req.params.id;
  // recupero dal db le informazioni relative all'utente accountId
  const accountData = await userFindOne(accountId)
  // quindi avvio su ig uno streamer che gestirà tutti gli eventi lanciati dalla piattaforma
  const response = await lightstreamer2(accountData)

  if (response){
    console.log("avvio lightstreamer2")
  }

  res.send(response)
});


router.get('/watchList/:id', async function(req, res) {
  const accountId = req.params.id;

  try{
    const accountData = await userFindOne(accountId)
    const watchlist = await getSetting(accountData.id)
    const igActivities = await getAllIgActivities(accountData)
    res.send({list: watchlist, ig: igActivities})
  }catch (err){
    res.send(err)
  }
})

/*router.get('/updateWatchList/:id', async function(req, res) {
  const accountId = req.params.id;

  const accountData = await userFindOne(accountId)
  if (accountData){
    const watchlist = await getCompleteWatchlist(accountData)
    console.log(watchlist.data.markets)
    res.send(watchlist.data.markets)
    return null
  }
  res.send("ok")
})*/

router.get('/getSettings/:id', async function(req, res) {
  const accountId = req.params.id;

  const resSettings = await getSettings()
  const resUser = await getUser()

  res.send(resUser)
})

router.post('/updateSettings/:id', async function(req, res) {
  const accountId = req.params.id;
  const settings = req.body

  const accountData = await userFindOne(accountId)

  const resSettings = await updateAccountSettings(accountData._id, settings)

  res.send(resSettings)
})

router.post('/openCrossOrders/:id', async function(req, res) {
  const accountId = req.params.id;
  const ordersToOpen = req.body

  // recupero dal db le informazioni relative all'utente accountId
  const accountData = await userFindOne(accountId)
  // recupero dal db i settaggi che aveva impostato l'utente
  const userSettings = await getSetting(accountData._id)

  // recupero da settings la configurazione dei cross da aprire
  let crossConfigList = userSettings.watchlist.filter(row=>{
    return ordersToOpen.epic.includes(row.epic)
  });

  // avvio i vari cross
  const step0Response = await step0(accountData, crossConfigList)

  res.send(step0Response)
})

router.post('/modificaPip/:id', async function(req, res) {
  const accountId = req.params.id;

  const {percentage} = req.body
  // recupero dal db le informazioni relative all'utente accountId
  const accountData = await userFindOne(accountId)

  const response = await getAllIgActivities(accountData._id)

  const igResponse = []

  for (const res of response){
    res.config.percentage = percentage
    igResponse.push(await newIgActivity(accountData, res.step, res.epic, res.config, res.orders, res.positions))
  }

  res.send(igResponse)
})

router.post('/closeSelected/:id', async function(req, res) {
  const accountId = req.params.id;
  const epicToClose = req.body

  const accountData = await userFindOne(accountId)

  // Creo una sessione ig
  const client = new APIClient(APIClient.URL_DEMO, accountData.apiKey);
  await client.rest.login.createSession(accountData.username, accountData.password);

  const igResponse = await closeActivity(client, accountData, epicToClose.epic)

  res.send(igResponse)
})


router.post('/newUser', async function(req, res) {
  const userData = req.body;

  const resUser = await newUser(userData)

  res.send(resUser)
})

router.post('/test', async function(req, res) {
  const {epic, timeframe, count} = req.body

  const url = 'https://api-fxpractice.oanda.com/v3/accounts/101-012-21964238-001/instruments/' + epic + '/candles?count=' + count + '&granularity=' + timeframe
  const config = {
    headers: { Authorization: `Bearer 396fc7161db2ff744bce7b0873bcdd97-1c1c0bd0e77d80bd4e8e74b5c21970d2` }
  }

  try {
    const candles = await axios.get(url, config)
    const result = getSupportResistance(candles.data.candles, candles.data.candles.length)
    res.send(result)
  } catch (e) {
    res.send(e.response.data)
  }
})


module.exports = router

function calculateSupportResistance(candles, period) {
  let closePrices = candles.slice(-period).map(candle => parseFloat(candle.mid.c));
  let mean = closePrices.reduce((a, b) => a + b) / period;
  let sortedPrices = closePrices.sort((a, b) => a - b);
  let q1 = sortedPrices[Math.floor(period / 4)];
  let q3 = sortedPrices[Math.ceil(3 * period / 4)];
  let iqr = q3 - q1;
  let support = mean - iqr;
  let resistance = mean + iqr;
  return { support, resistance };
}

function getSupportResistance(candles, lookback) {
  let support = {};
  let resistance = {};

  for (let i = 0; i < candles.length; i++) {
    let candle = candles[i];
    let low = parseFloat(candle.mid.l);
    let high = parseFloat(candle.mid.h);

    for (let j = i - lookback; j < i; j++) {
      if (j < 0) {
        continue;
      }
      let prevCandle = candles[j];
      let prevLow = parseFloat(prevCandle.mid.l);
      let prevHigh = parseFloat(prevCandle.mid.h);

      if (prevLow > low) {
        if (!support[low]) {
          support[low] = 1;
        } else {
          support[low]++;
        }
      } else if (prevHigh < high) {
        if (!resistance[high]) {
          resistance[high] = 1;
        } else {
          resistance[high]++;
        }
      }
    }
  }

  let sortedSupport = Object.keys(support)
    .sort((a, b) => support[b] - support[a]);
  let sortedResistance = Object.keys(resistance)
    .sort((a, b) => resistance[b] - resistance[a]);

  let strongestSupport = sortedSupport[0];
  let strongestResistance = sortedResistance[0];

  return {
    resistance: parseFloat(strongestResistance),
    support: parseFloat(strongestSupport)
  };
}
