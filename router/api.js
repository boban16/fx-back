import express from 'express'
import {
  getAllIgActivities,
  getSetting,
  getSettings,
  getUser,
  newUser,
  updateAccountSettings,
  userFindOne
} from "../lib/mongoDB";
import {closeActivity} from "../lib/rest";
import {APIClient} from "ig-trading-api";
import {step0} from "../lib/restV3";
import {lightstreamer2} from "../lib/lightstreamer2";

const router = express.Router()

router.get('/start/:id', async function(req, res) {
  const accountId = req.params.id;
  // recupero dal db le informazioni relative all'utente accountId
  const accountData = await userFindOne(accountId)
  // quindi avvio su ig uno streamer che gestirà tutti gli eventi lanciati dalla piattaforma
  const response = await lightstreamer2(accountData)

  if (response){
    console.log("avvio lightstreamer")
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

  const resSettings = await updateAccountSettings(accountId, settings)

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

  res.send("ok")
})

/*router.post('/restartSelected/:id', async function(req, res) {
  const accountId = req.params.id;
  const ordersToOpen = req.body

  const accountData = await userFindOne(accountId)
  const userSettings = await getSetting(accountData._id)

  // recupero da settings la configurazione dei cross da aprire
  let crossConfigList = userSettings.watchlist.filter(row=>{
    return ordersToOpen.epic.includes(row.epic)
  });

  const step0Response = await stepA0(accountData, crossConfigList)

  res.send("ok")
})*/

router.post('/closeSelected/:id', async function(req, res) {
  const accountId = req.params.id;
  const epicToClose = req.body

  const accountData = await userFindOne(accountId)

  // Creo una sessione ig
  const client = new APIClient(APIClient.URL_DEMO, accountData.apiKey);
  await client.rest.login.createSession(accountData.username, accountData.password);

  console.log(epicToClose.epic)

  await closeActivity(client, accountData, epicToClose.epic)

  res.send("ok")
})


router.post('/newUser', async function(req, res) {
  const userData = req.body;

  const resUser = await newUser(userData)

  res.send(resUser)
})

module.exports = router
