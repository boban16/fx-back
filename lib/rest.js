import axios from "axios";
import {APIClient} from "ig-trading-api";
import {deleteIgActivity, getIgActivities, newIgActivity} from "./mongoDB";

const baseURL = "https://demo-api.ig.com/gateway/deal"

const igSession = async (identifier, password, apiKey) => {
  const response = await axios
    .post(baseURL+'/session', {
      identifier,
      password
    }, {headers: {'Content-Type': 'application/json; charset=UTF-8', 'X-IG-API-KEY': `${apiKey}`, 'Version': 2}})

  if (response) {
    return {
      accountId: response.data.currentAccountId,
      clientId: response.data.clientId,
      lightstreamerEndpoint: response.data.lightstreamerEndpoint,
      cst: response.headers.cst,
      xSecurityToken: response.headers['x-security-token']
    }
  }

  return {error: "session error"}
}

/**
 * Fase 0
 *
 * Apertura di due ordini di segno opposto al prezzo di mercato +- x pip di distanza
 * */
const stepA0 = async (accountData, crossList) =>{
  // apro una nuova sessione
  const client = new APIClient(APIClient.URL_DEMO, accountData.apiKey);
  await client.rest.login.createSession(accountData.username, accountData.password);

  const epicArray = []
  for (const cross of crossList){
    // creo un array contenente solo gli epic, così da fare una chiamata unica
    epicArray.push(cross.epic)
  }

  //recupero il dettaglio di tutti i cross
  const marketDetails = await client.rest.market.getMarketDetails(epicArray)

  //Per ogni cross apro la poosizione A0
  for (const market of marketDetails.marketDetails){
    const crossConfig = crossList.find(cross => cross.epic === market.instrument.epic)

    const averagePrice = +((market.snapshot.bid + market.snapshot.offer) / 2).toFixed(
      market.snapshot.scalingFactor.toString().length,
    )

    const pip = Math.round(averagePrice * (crossConfig.percentage / 100) * market.snapshot.scalingFactor) /
      market.snapshot.scalingFactor

    // Apro i nuovi ordini
    const buyOrderResponse = await newOrder(client, crossConfig.epic, "BUY", crossConfig.contracts, averagePrice+pip, "STOP", crossConfig.currencies, null, null)
    const sellOrderResponse = await newOrder(client, crossConfig.epic, "SELL", crossConfig.contracts, averagePrice-pip, "STOP", crossConfig.currencies, null, null)

    const orders = [{
      dealId: buyOrderResponse.dealId,
      dealReference: buyOrderResponse.dealReference,
      direction: buyOrderResponse.direction,
      size: buyOrderResponse.size,
      level: buyOrderResponse.level,
      limitLevel: buyOrderResponse.limitLevel,
      nextStep: "A1"
    }, {
      dealId: sellOrderResponse.dealId,
      dealReference: sellOrderResponse.dealReference,
      direction: sellOrderResponse.direction,
      size: sellOrderResponse.size,
      level: sellOrderResponse.level,
      limitLevel: sellOrderResponse.limitLevel,
      nextStep: "A1"
    }]

    const responseIgActivity = await newIgActivity(accountData, 'A0',  crossConfig, orders, [])
    console.group("Ig Activity")
    console.log("orders:", responseIgActivity.orders)
    console.log("positions:", responseIgActivity.positions)
    console.log("step:", responseIgActivity.step)
    console.groupEnd()
  }
}

const stepA1 = async (activities, accountData, event) => {
  // Cerco l'ordine non eseguito
  const refOrder = activities.orders.find(order => order.dealId !== event.dealId)

  // Creo una sessione ig
  const client = new APIClient(APIClient.URL_DEMO, accountData.apiKey);
  await client.rest.login.createSession(accountData.username, accountData.password);

  try {
    // Chiudo l'ordine non eseguito
    const responseDeleteOrder = await client.rest.dealing.deleteOrder(refOrder.dealId)

    // await restartCross(client, accountData, activities)

    // Calcolo la distanza in pip data la configurazione del cross
    const pip = Math.round(event.level * (activities.config.percentage / 100) * activities.config.scalingFactor) /
      activities.config.scalingFactor

    // Definisco i livelli di prezzo per l'ordine STOP e LIMIT
    const levelStop = event.direction === "BUY" ? event.level+(pip/2) : event.level-(pip/2)
    const levelLimit = event.direction === "BUY" ? event.level-pip : event.level+pip

    // Apro i nuovi ordini
    console.group("Nuovi Ordini")
    const stopOrderResponse = await newOrder(client, activities.epic, event.direction, activities.config.contracts, levelStop, "STOP", activities.config.currencies, null, null)
    console.log("stopOrderResponse dealStatus: ", stopOrderResponse.dealStatus)
    console.log("stopOrderResponse: ", stopOrderResponse.affectedDeals)

    const limitOrderResponse = await newOrder(client, activities.epic, event.direction, activities.config.contracts, levelLimit, "LIMIT", activities.config.currencies, null, event.level)
    console.log("limitOrderResponse dealStatus: ", limitOrderResponse.dealStatus)
    console.log("limitOrderResponse: ", limitOrderResponse.affectedDeals)
    console.groupEnd()

    const orders = [{
      dealId: stopOrderResponse.dealId,
      dealReference: stopOrderResponse.dealReference,
      direction: stopOrderResponse.direction,
      size: stopOrderResponse.size,
      level: stopOrderResponse.level,
      limitLevel: stopOrderResponse.limitLevel,
      nextStep: "A2"
    }, {
      dealId: limitOrderResponse.dealId,
      dealReference: limitOrderResponse.dealReference,
      direction: limitOrderResponse.direction,
      size: limitOrderResponse.size,
      level: limitOrderResponse.level,
      limitLevel: limitOrderResponse.limitLevel,
      nextStep: "A3"
    }]

    const positions = [{
      dealId: event.dealId,
      dealReference: event.dealReference,
      direction: event.direction,
      size: event.size,
      level: event.level,
      limitLevel: event.limitLevel,
      nextStep: null
    }]

    const responseIgActivity = await newIgActivity(accountData, 'A1',  activities, orders, positions)
    console.group("Ig Activity")
    console.log("orders:", responseIgActivity.orders)
    console.log("positions:", responseIgActivity.positions)
    console.log("step:", responseIgActivity.step)
    console.groupEnd()
  } catch (e) {
    console.log(e)
  }
}

const stepA2 = async (activities, accountData, event) => {
  // Cerco l'ordine non eseguito
  const refOrder = activities.orders.find(order => order.dealId !== event.dealId)

  // Creo una sessione ig
  const client = new APIClient(APIClient.URL_DEMO, accountData.apiKey);
  await client.rest.login.createSession(accountData.username, accountData.password);

  try {
    // Take profit posizione aperta (1 contrato)
    console.group("Chiusura posizione")
    const responseClosePosition = await closePosition(client, activities.positions[0].dealId, activities.positions[0].direction, activities.positions[0].size, false)
    console.log("dealStatus: ", responseClosePosition.dealStatus)
    console.log("affectedDeals: ", responseClosePosition.affectedDeals)
    console.log("profit: ", responseClosePosition.profit)
    console.groupEnd()

    // Chiudo l'ordine non eseguito
    const responseDeleteOrder = await client.rest.dealing.deleteOrder(refOrder.dealId)

    // await restartCross(client, accountData, activities)

    // Calcolo la distanza in pip data la configurazione del cross
    const pip = Math.round(event.level * (activities.config.percentage / 100) * activities.config.scalingFactor) /
      activities.config.scalingFactor

    // Definisco i livelli di prezzo per l'ordine STOP e LIMIT
    const levelStop = event.direction === "BUY" ? event.level+(pip/2) : event.level-(pip/2)
    const levelLimit = event.direction === "BUY" ? event.level-pip : event.level+pip

    // Apro i nuovi ordini
    console.group("Nuovi Ordini")
    const stopOrderResponse = await newOrder(client, activities.epic, event.direction, activities.config.contracts, levelStop, "STOP", activities.config.currencies, null, null)
    console.log("stopOrderResponse dealStatus: ", stopOrderResponse.dealStatus)
    console.log("stopOrderResponse: ", stopOrderResponse.affectedDeals)

    const limitOrderResponse = await newOrder(client, activities.epic, event.direction, activities.config.contracts, levelLimit, "LIMIT", activities.config.currencies, null, event.level)
    console.log("stopOrderResponse dealStatus: ", stopOrderResponse.dealStatus)
    console.log("stopOrderResponse: ", stopOrderResponse.affectedDeals)
    console.groupEnd()

    const orders = [{
      dealId: stopOrderResponse.dealId,
      dealReference: stopOrderResponse.dealReference,
      direction: stopOrderResponse.direction,
      size: stopOrderResponse.size,
      level: stopOrderResponse.level,
      limitLevel: stopOrderResponse.limitLevel,
      nextStep: "A2"
    }, {
      dealId: limitOrderResponse.dealId,
      dealReference: limitOrderResponse.dealReference,
      direction: limitOrderResponse.direction,
      size: limitOrderResponse.size,
      level: limitOrderResponse.level,
      limitLevel: limitOrderResponse.limitLevel,
      nextStep: "A3"
    }]

    const positions = [{
      dealId: event.dealId,
      dealReference: event.dealReference,
      direction: event.direction,
      size: event.size,
      level: event.level,
      limitLevel: event.limitLevel,
      nextStep: null
    }]

    const responseIgActivity = await newIgActivity(accountData, 'A1',  activities, orders, positions)
    console.group("Ig Activity")
    console.log("orders:", responseIgActivity.orders)
    console.log("positions:", responseIgActivity.positions)
    console.log("step:", responseIgActivity.step)
    console.groupEnd()

  } catch (e) {
    console.log(e)
  }
}

const stepA3 = async (activities, accountData, event) => {
  // Cerco l'ordine non eseguito
  const refOrder = activities.orders.find(order => order.dealId !== event.dealId)

  // Creo una sessione ig
  const client = new APIClient(APIClient.URL_DEMO, accountData.apiKey);
  await client.rest.login.createSession(accountData.username, accountData.password);

  try {
    // Chiudo metà della posizione aperta più distante (0.5 contratti)
    console.group("Chiusura posizione parziale")
    const responseClosePosition = await closePosition(client, activities.positions[0].dealId, activities.positions[0].direction, activities.positions[0].size, true)
    console.log("dealStatus: ", responseClosePosition.dealStatus)
    console.log("affectedDeals: ", responseClosePosition.affectedDeals)
    console.log("profit: ", responseClosePosition.profit)
    console.groupEnd()

    // Chiudo l'ordine non eseguito
    const responseDeleteOrder = await client.rest.dealing.deleteOrder(refOrder.dealId)

    // await restartCross(client, accountData, activities)

    // Calcolo la distanza in pip data la configurazione del cross
    const pip = Math.round(event.level * (activities.config.percentage / 100) * activities.config.scalingFactor) /
      activities.config.scalingFactor

    // Definisco i livelli di prezzo per l'ordine stop
    const levelStop = event.direction === "BUY" ? event.level-pip : event.level+pip
    // Definisco la direzione del nuovo ordine
    const direction = event.direction === "BUY" ? "SELL" : "BUY"

    // Apro i nuovi ordini
    console.group("Nuovo Ordine")
    const stopOrderResponse = await newOrder(client, activities.epic, direction, activities.config.contracts, levelStop, "STOP", activities.config.currencies, null, null)
    console.log("stopOrderResponse dealStatus: ", stopOrderResponse.dealStatus)
    console.log("stopOrderResponse: ", stopOrderResponse.affectedDeals)
    console.groupEnd()

    const orders = [{
      dealId: stopOrderResponse.dealId,
      dealReference: stopOrderResponse.dealReference,
      direction: stopOrderResponse.direction,
      size: stopOrderResponse.size,
      level: stopOrderResponse.level,
      limitLevel: stopOrderResponse.limitLevel,
      nextStep: "A4"
    }]

    const positions = [{
      dealId: activities.positions[0].dealId,
      dealReference: activities.positions[0].dealReference,
      direction: activities.positions[0].direction,
      size: activities.positions[0].size/2,
      level: activities.positions[0].level,
      limitLevel: activities.positions[0].limitLevel,
      nextStep: null
    },{
      dealId: event.dealId,
      dealReference: event.dealReference,
      direction: event.direction,
      size: event.size,
      level: event.level,
      limitLevel: event.limitLevel,
      nextStep: "A1"
    }]

    const responseIgActivity = await newIgActivity(accountData, 'A3',  activities, orders, positions)
    console.group("Ig Activity")
    console.log("orders:", responseIgActivity.orders)
    console.log("positions:", responseIgActivity.positions)
    console.log("step:", responseIgActivity.step)
    console.groupEnd()

  } catch (e) {
    console.log(e)
  }
}

const stepA4 = async (activities, accountData, event) => {
  // Creo una sessione ig
  const client = new APIClient(APIClient.URL_DEMO, accountData.apiKey);
  await client.rest.login.createSession(accountData.username, accountData.password);

  // await restartCross(client, accountData, activities)
  try {
    // Chiudo tutte le posizioni aperte (-2 contratti)
    console.group("Chiusura posizioni")
    for (const position of activities.positions){
      const responseClosePosition = await closePosition(client, position.dealId, position.direction, position.size, false)
      console.log("dealStatus: ", responseClosePosition.dealStatus)
      console.log("affectedDeals: ", responseClosePosition.affectedDeals)
      console.log("profit: ", responseClosePosition.profit)
    }
    console.groupEnd()

    // await restartCross(client, accountData, activities)

    // Calcolo la distanza in pip data la configurazione del cross
    const pip = Math.round(event.level * (activities.config.percentage / 100) * activities.config.scalingFactor) /
      activities.config.scalingFactor

    // Definisco i livelli di prezzo per l'ordine limit
    const levelLimit1 = event.direction === "SELL" ? event.level-pip : event.level+pip
    const levelLimit2 = event.direction === "SELL" ? event.level+pip : event.level-pip
    // Definisco la direzione del nuovo ordine Limit
    const directionLimit1 = event.direction === "SELL" ? "BUY" : "SELL"
    const directionLimit2 = event.direction

    // Apro i nuovi ordini
    console.group("Nuovi Ordini")
    const limitOrder1Response = await newOrder(client, activities.epic, directionLimit1, activities.config.contracts, levelLimit1, "LIMIT", activities.config.currencies, null, null)
    console.log("limitOrder1Response dealStatus: ", limitOrder1Response.dealStatus)
    console.log("limitOrder1Response: ", limitOrder1Response.affectedDeals)

    const limitOrder2Response = await newOrder(client, activities.epic, directionLimit2, activities.config.contracts, levelLimit2, "LIMIT", activities.config.currencies, null, event.level)
    console.log("limitOrder2Response dealStatus: ", limitOrder2Response.dealStatus)
    console.log("limitOrder2Response: ", limitOrder2Response.affectedDeals)
    console.groupEnd()

    const orders = [{
      dealId: limitOrder1Response.dealId,
      dealReference: limitOrder1Response.dealReference,
      direction: limitOrder1Response.direction,
      size: limitOrder1Response.size,
      level: limitOrder1Response.level,
      limitLevel: limitOrder1Response.limitLevel,
      nextStep: "A5"
    }, {
      dealId: limitOrder2Response.dealId,
      dealReference: limitOrder2Response.dealReference,
      direction: limitOrder2Response.direction,
      size: limitOrder2Response.size,
      level: limitOrder2Response.level,
      limitLevel: limitOrder2Response.limitLevel,
      nextStep: "A3"
    }]

    const positions = [{
      dealId: event.dealId,
      dealReference: event.dealReference,
      direction: event.direction,
      size: event.size,
      level: event.level,
      limitLevel: event.limitLevel,
      nextStep: "A4"
    }]

    const responseIgActivity = await newIgActivity(accountData, 'A4',  activities, orders, positions)
    console.group("Ig Activity")
    console.log("orders:", responseIgActivity.orders)
    console.log("positions:", responseIgActivity.positions)
    console.log("step:", responseIgActivity.step)
    console.groupEnd()

  } catch (e) {
    console.log(e)
  }
}

const stepA5 = async (activities, accountData, event) => {
  // Cerco l'ordine non eseguito
  const refOrder = activities.orders.find(order => order.dealId !== event.dealId)

  // Creo una sessione ig
  const client = new APIClient(APIClient.URL_DEMO, accountData.apiKey);
  await client.rest.login.createSession(accountData.username, accountData.password);

  try {
    // Chiudo l'ordine non eseguito
    const responseDeleteOrder = await client.rest.dealing.deleteOrder(refOrder.dealId)

    // await restartCross(client, accountData, activities)

    // Calcolo la distanza in pip data la configurazione del cross
    const pip = Math.round(event.level * (activities.config.percentage / 100) * activities.config.scalingFactor) /
      activities.config.scalingFactor

    // Definisco i livelli di prezzo per l'ordine spot
    const levelSpot1 = event.direction === "BUY" ? event.level-pip : event.level+pip
    const levelSpot2 = event.direction === "BUY" ? activities.positions[0].level+pip : activities.positions[0].level-pip
    // Definisco la direzione del nuovo ordine Limit
    const directionLimit1 = event.direction === "BUY" ? "SELL" : "BUY"
    const directionLimit2 = event.direction

    // Apro i nuovi ordini
    console.group("Nuovi Ordini")
    const limitOrder1Response = await newOrder(client, activities.epic, directionLimit1, activities.config.contracts, levelSpot1, "STOP", activities.config.currencies, null, null)
    console.log("limitOrder1Response dealStatus: ", limitOrder1Response.dealStatus)
    console.log("limitOrder1Response: ", limitOrder1Response.affectedDeals)

    const limitOrder2Response = await newOrder(client, activities.epic, directionLimit2, activities.config.contracts, levelSpot2, "STOP", activities.config.currencies, null, null)
    console.log("limitOrder2Response dealStatus: ", limitOrder2Response.dealStatus)
    console.log("limitOrder2Response: ", limitOrder2Response.affectedDeals)
    console.groupEnd()

    const orders = [{
      dealId: limitOrder1Response.dealId,
      dealReference: limitOrder1Response.dealReference,
      direction: limitOrder1Response.direction,
      size: limitOrder1Response.size,
      level: limitOrder1Response.level,
      limitLevel: limitOrder1Response.limitLevel,
      nextStep: "A5"
    }, {
      dealId: limitOrder2Response.dealId,
      dealReference: limitOrder2Response.dealReference,
      direction: limitOrder2Response.direction,
      size: limitOrder2Response.size,
      level: limitOrder2Response.level,
      limitLevel: limitOrder2Response.limitLevel,
      nextStep: "A5"
    }]

    const positions = [{
      dealId: event.dealId,
      dealReference: event.dealReference,
      direction: event.direction,
      size: event.size,
      level: event.level,
      limitLevel: event.limitLevel,
      nextStep: null
    }, {
      dealId: activities.positions[0].dealId,
      dealReference: activities.positions[0].dealReference,
      direction: activities.positions[0].direction,
      size: activities.positions[0].size,
      level: activities.positions[0].level,
      limitLevel: activities.positions[0].limitLevel,
      nextStep: null
    }]

    const responseIgActivity = await newIgActivity(accountData, 'A5',  activities, orders, positions)
    console.group("Ig Activity")
    console.log("orders:", responseIgActivity.orders)
    console.log("positions:", responseIgActivity.positions)
    console.log("step:", responseIgActivity.step)
    console.groupEnd()

  } catch (e) {
    console.log(e)
  }
}

const stepA6 = async (activities, accountData, event) => {
  // Cerco l'ordine non eseguito
  const refOrder = activities.orders.find(order => order.dealId !== event.dealId)
  console.log("refOrder: ", refOrder)

  // Creo una sessione ig
  const client = new APIClient(APIClient.URL_DEMO, accountData.apiKey);
  await client.rest.login.createSession(accountData.username, accountData.password);

  try {
    // Chiudo l'ordine non eseguito
    const responseCloseOrder = await client.rest.dealing.deleteOrder(refOrder.dealId)

    // Chudo tutto le posizioni (+1 contratto)
    console.group("Chiusura posizioni")
    for (const position of activities.positions){
      const responseClosePosition = await closePosition(client, position.dealId, position.direction, position.size, false)
      console.log("dealStatus: ", responseClosePosition.dealStatus)
      console.log("affectedDeals: ", responseClosePosition.affectedDeals)
      console.log("profit: ", responseClosePosition.profit)
    }
    console.groupEnd()

    // await restartCross(client, accountData, activities)

    // Calcolo la distanza in pip data la configurazione del cross
    const pip = Math.round(event.level * (activities.config.percentage / 100) * activities.config.scalingFactor) /
      activities.config.scalingFactor

    // Definisco i livelli di prezzo per l'ordine STOP e LIMIT
    const levelStop = event.direction === "BUY" ? event.level+(pip/2) : event.level-(pip/2)
    const levelLimit = event.direction === "BUY" ? event.level-pip : event.level+pip

    // Apro i nuovi ordini
    console.group("Nuovi Ordini")
    const stopOrderResponse = await newOrder(client, activities.epic, event.direction, activities.config.contracts, levelStop, "STOP", activities.config.currencies, null, null)
    console.log("stopOrderResponse dealStatus: ", stopOrderResponse.dealStatus)
    console.log("stopOrderResponse: ", stopOrderResponse.affectedDeals)

    const limitOrderResponse = await newOrder(client, activities.epic, event.direction, activities.config.contracts, levelLimit, "LIMIT", activities.config.currencies, null, event.level)
    console.log("limitOrderResponse dealStatus: ", limitOrderResponse.dealStatus)
    console.log("limitOrderResponse: ", limitOrderResponse.affectedDeals)
    console.groupEnd()

    const orders = [{
      dealId: stopOrderResponse.dealId,
      dealReference: stopOrderResponse.dealReference,
      direction: stopOrderResponse.direction,
      size: stopOrderResponse.size,
      level: stopOrderResponse.level,
      limitLevel: stopOrderResponse.limitLevel,
      nextStep: "A2"
    }, {
      dealId: limitOrderResponse.dealId,
      dealReference: limitOrderResponse.dealReference,
      direction: limitOrderResponse.direction,
      size: limitOrderResponse.size,
      level: limitOrderResponse.level,
      limitLevel: limitOrderResponse.limitLevel,
      nextStep: "A3"
    }]

    const positions = [{
      dealId: event.dealId,
      dealReference: event.dealReference,
      direction: event.direction,
      size: event.size,
      level: event.level,
      limitLevel: event.limitLevel,
      nextStep: null
    }]

    const responseIgActivity = await newIgActivity(accountData, 'A1',  activities, orders, positions)
    console.group("Ig Activity")
    console.log("orders:", responseIgActivity.orders)
    console.log("positions:", responseIgActivity.positions)
    console.log("step:", responseIgActivity.step)
    console.groupEnd()
  } catch (e) {
    console.log(e)
  }
}

const stepA1Bis = async (activities, accountData, event) => {

  // Creo una sessione ig
  const client = new APIClient(APIClient.URL_DEMO, accountData.apiKey);
  await client.rest.login.createSession(accountData.username, accountData.password);

  try {
    // Chiudo l'ordine non eseguito
    const responseCloseOrder = await client.rest.dealing.deleteOrder(activities.orders[0].dealId)

    // Calcolo la distanza in pip data la configurazione del cross
    const pip = Math.round(event.level * (activities.config.percentage / 100) * activities.config.scalingFactor) /
      activities.config.scalingFactor

    // Definisco i livelli di prezzo per l'ordine STOP e LIMIT
    const levelStop = event.direction === "BUY" ? event.level+(pip/2) : event.level-(pip/2)
    const levelLimit = event.direction === "BUY" ? event.level-pip : event.level+pip

    //await restartCross(client, accountData, activities)

    // Apro i nuovi ordini
    console.group("Nuovi Ordini")
    const stopOrderResponse = await newOrder(client, activities.epic, event.direction, activities.config.contracts, levelStop, "STOP", activities.config.currencies, null, null)
    console.log("stopOrderResponse dealStatus: ", stopOrderResponse.dealStatus)
    console.log("stopOrderResponse: ", stopOrderResponse.affectedDeals)

    /*if (stopOrderResponse.dealStatus === "REJECTED"){
      await restartCross(accountData, activities)
      return null
    }*/

    const limitOrderResponse = await newOrder(client, activities.epic, event.direction, activities.config.contracts, levelLimit, "LIMIT", activities.config.currencies, null, event.level)
    console.log("limitOrderResponse dealStatus: ", limitOrderResponse.dealStatus)
    console.log("limitOrderResponse: ", limitOrderResponse.affectedDeals)
    console.groupEnd()

    const orders = [{
      dealId: stopOrderResponse.dealId,
      dealReference: stopOrderResponse.dealReference,
      direction: stopOrderResponse.direction,
      size: stopOrderResponse.size,
      level: stopOrderResponse.level,
      limitLevel: stopOrderResponse.limitLevel,
      nextStep: "A2"
    }, {
      dealId: limitOrderResponse.dealId,
      dealReference: limitOrderResponse.dealReference,
      direction: limitOrderResponse.direction,
      size: limitOrderResponse.size,
      level: limitOrderResponse.level,
      limitLevel: limitOrderResponse.limitLevel,
      nextStep: "A3"
    }]

    const positions = [{
      dealId: activities.positions[0].dealId,
      dealReference: activities.positions[0].dealReference,
      direction: activities.positions[0].direction,
      size: activities.positions[0].size,
      level: activities.positions[0].level,
      limitLevel: activities.positions[0].limitLevel,
      nextStep: null
    }]

    const responseIgActivity = await newIgActivity(accountData, 'A1',  activities, orders, positions)
    console.group("Ig Activity")
    console.log("orders:", responseIgActivity.orders)
    console.log("positions:", responseIgActivity.positions)
    console.log("step:", responseIgActivity.step)
    console.groupEnd()

  } catch (e) {
    console.log(e)
  }
}

const closeActivity = async (client, accountData, epic) => {
  const allOrders = await client.rest.dealing.getAllOrders()
  const allPositions = await client.rest.dealing.getAllOpenPositions()

  let ordersToDelete = allOrders.workingOrders.filter(row=> row.workingOrderData.epic === epic);
  let positionsToDelete = allPositions.positions.filter(row=> row.market.epic === epic);

  for (const order of ordersToDelete){
    await client.rest.dealing.deleteOrder(order.workingOrderData.dealId)
  }

  for (const position of positionsToDelete){
    await closePosition(client, position.position.dealId, position.position.direction, position.position.size, false)
  }

  await deleteIgActivity(accountData, epic)
}

const restartCross = async (client, accountData, crossConfig) => {

  // await closeActivity(client, crossConfig.epic)

  /*const averagePrice = +((market.snapshot.bid + market.snapshot.offer) / 2).toFixed(
    market.snapshot.scalingFactor.toString().length,
  )

  const pip = Math.round(averagePrice * (crossConfig.percentage / 100) * market.snapshot.scalingFactor) /
    market.snapshot.scalingFactor

  // Apro i nuovi ordini
  const buyOrderResponse = await newOrder(client, crossConfig.epic, "BUY", crossConfig.contracts, averagePrice+pip, "STOP", crossConfig.currencies, null, null)
  const sellOrderResponse = await newOrder(client, crossConfig.epic, "SELL", crossConfig.contracts, averagePrice-pip, "STOP", crossConfig.currencies, null, null)

  const orders = [{
    dealId: buyOrderResponse.dealId,
    dealReference: buyOrderResponse.dealReference,
    direction: buyOrderResponse.direction,
    size: buyOrderResponse.size,
    level: buyOrderResponse.level,
    limitLevel: buyOrderResponse.limitLevel,
    nextStep: "A1"
  }, {
    dealId: sellOrderResponse.dealId,
    dealReference: sellOrderResponse.dealReference,
    direction: sellOrderResponse.direction,
    size: sellOrderResponse.size,
    level: sellOrderResponse.level,
    limitLevel: sellOrderResponse.limitLevel,
    nextStep: "A1"
  }]

  const responseIgActivity = await newIgActivity(accountData, 'A0',  crossConfig, orders, [])
  console.group("Ig Activity")
  console.log("orders:", responseIgActivity.orders)
  console.log("positions:", responseIgActivity.positions)
  console.log("step:", responseIgActivity.step)
  console.groupEnd()*/

}

const newOrder = async (client, epic, direction, size, level, type, currencyCode, stopLevel, limitLevel) => {
  const orderData = {
    epic: epic,
    expiry: '-',
    direction: direction,
    size: size,
    level: level,
    forceOpen: 'true',
    type: type,
    currencyCode: currencyCode,
    timeInForce: 'GOOD_TILL_CANCELLED',
    goodTillDate: null,
    guaranteedStop: 'false',
    stopLevel: stopLevel,
    stopDistance: null,
    limitLevel: limitLevel,
    limitDistance: null
  }

  console.log("orderData", orderData)

  try {
    const dealReference = await client.rest.dealing.createOrder(orderData)
    const responseConfirmTrade = await client.rest.dealing.confirmTrade(dealReference)
    console.log("full order response", responseConfirmTrade)
    return responseConfirmTrade
  }catch (e) {
    console.log(e)
    return e
  }
}

export const closePosition = async (client, dealId, direction, size, partial) => {
  const data = {
    dealId: dealId,
    epic: null,
    expiry: null,
    direction: direction === "BUY" ? "SELL" : "BUY",
    size: partial ? size/2 : size,
    level: null,
    orderType: "MARKET",
    timeInForce: "EXECUTE_AND_ELIMINATE",
    quoteId: null
  }

  const dealReference = await client.rest.dealing.closePosition(data)
  return await client.rest.dealing.confirmTrade(dealReference)
}

const getCompleteWatchlist = async (accountData) => {
  const sessionResponse = await igSession(accountData.username, accountData.password, accountData.apiKey)

  if (sessionResponse) {
    const headerGet = {
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-IG-API-KEY': `${accountData.apiKey}`,
        'Version': 1,
        'CST': `${sessionResponse.cst}`,
        'X-SECURITY-TOKEN': `${sessionResponse.xSecurityToken}`
      }
    }
    const watchlistsReposnse = await axios.get(baseURL + '/watchlists', headerGet)

    const watchlistId =  watchlistsReposnse.data.watchlists.find(list => list.name === "macchinetta")

    const watchlist = await getWatchlist(watchlistId.id, sessionResponse.cst, sessionResponse.xSecurityToken, accountData.apiKey)

    return watchlist
  }
  return null
}

const getWatchlist = async (watchlistId, cst, xSecurityToken, apiKey) => {
  const headerGet = {
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-IG-API-KEY': `${apiKey}`,
      'Version': 1,
      'CST': `${cst}`,
      'X-SECURITY-TOKEN': `${xSecurityToken}`
    }
  }

  return await axios.get(baseURL + '/watchlists/'+watchlistId, headerGet)
}

module.exports = {
  igSession,
  closeActivity,
  getCompleteWatchlist,
  newOrder,
  stepA0,
  stepA1,
  stepA1Bis,
  stepA2,
  stepA3,
  stepA4,
  stepA5,
  stepA6
}
