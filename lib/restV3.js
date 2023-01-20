import axios from "axios";
import {APIClient} from "ig-trading-api";
import {deleteIgActivity, getIgActivities, newIgActivity} from "./mongoDB";
import {Direction, PositionOrderType, PositionTimeInForce} from "ig-trading-api/dist/dealing/DealingAPI";

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
const step0 = async (accountData, crossList) =>{
  // apro una nuova sessione
  const client = new APIClient(APIClient.URL_DEMO, accountData.apiKey);
  await client.rest.login.createSession(accountData.username, accountData.password);

  const epicArray = []
  // inizializzo un array contenente tutti i riferimenti a i cross di cui recuperare le info di mercato da ig
  for (const cross of crossList){
    // creo un array contenente solo gli epic, così da fare una chiamata unica
    epicArray.push(cross.epic)
  }

  //recupero il dettaglio di tutti i cross
  const marketDetails = await client.rest.market.getMarketDetails(epicArray)

  //Per ogni cross apro la poosizione A0
  for (const market of marketDetails.marketDetails){
    try {
      const crossConfig = crossList.find(cross => cross.epic === market.instrument.epic)

      // calcolo il prezzo medio tra bid e offer
      const averagePrice = +((market.snapshot.bid + market.snapshot.offer) / 2).toFixed(
        market.snapshot.scalingFactor.toString().length,
      )

      // calcolo la distanza in pip sulla base della variazione % indicata dall'utente
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
        nextStep: "A2"
      }]

      // aggiorno il database con una copia dello stato di ig, configurazioni relative al cross e alla fase da eseguire
      return await newIgActivity(accountData, 'A1', crossConfig.epic, crossConfig, orders, [])
    }catch (e) {
      console.log("step 0 error", e)
    }
  }
}

const step1 = async (activities, accountData, event) => {
  // Cerco l'ordine non eseguito
  const refOrder = activities.orders.find(order => order.dealId !== event.dealId)
  // Creo una sessione ig
  const client = new APIClient(APIClient.URL_DEMO, accountData.apiKey);
  await client.rest.login.createSession(accountData.username, accountData.password);

  try {
    // Calcolo la distanza in pip data la configurazione del cross
    const pip = Math.round(event.level * (activities.config.percentage / 100) * activities.config.scalingFactor) /
      activities.config.scalingFactor

    // Definisco i livelli di prezzo per l'ordine STOP e LIMIT
    const levelStop1 = event.direction === "BUY" ? event.level+(pip/2) : event.level-(pip/2)
    const levelStop2 = event.direction === "BUY" ? event.level-pip : event.level+pip

    // Apro i nuovi ordini
    console.group("Nuovi Ordini")
    const stopOrderResponse1 = await newOrder(client, activities.epic, event.direction, activities.config.contracts, levelStop1, "STOP", activities.config.currencies, null, null)
    console.log("stopOrderResponse1 dealStatus: ", stopOrderResponse1.dealStatus)

    const stopOrderResponse2 = await newOrder(client, activities.epic, event.direction === "BUY" ? "SELL" : "BUY", activities.config.contracts, levelStop2, "STOP", activities.config.currencies, null, null)
    console.log("stopOrderResponse2 dealStatus: ", stopOrderResponse2.dealStatus)
    console.groupEnd()

    // se uno dei due ordini non viene eseguito, chiudo posizioni ed ordini, quini riapro dalla posizione A0
    if (stopOrderResponse1.dealStatus === "REJECTED" || stopOrderResponse2.dealStatus === "REJECTED"){
      console.log("ORDER REJECTED")
      await closeActivity(client, accountData, activities.epic)

      const crossList = {
        activities: true,
        epic: activities.epic,
        instrument: activities.config.instrumentName,
        currencies: activities.config.currencies,
        scalingFactor: activities.config.scalingFactor,
        percentage: activities.config.percentage,
        contracts: activities.config.contracts
      }

      await step0(accountData, [crossList])
      return null
    }

    // Chiusura posizioni aperte
    if(activities.positions.length > 0 ) {
      let totalPL = 0
      console.group("Chiusura posizioni")
      for (const position of activities.positions){
        const responseClosePosition = await closePosition(client, position.dealId, position.direction, position.size, false)
        totalPL += responseClosePosition.profit
      }
      console.log("total PL", totalPL)
      console.groupEnd()
    }

    // Chiudo l'ordine non eseguito
    await client.rest.dealing.deleteOrder(refOrder.dealId)

    const orders = [{
      dealId: stopOrderResponse1.dealId,
      dealReference: stopOrderResponse1.dealReference,
      direction: stopOrderResponse1.direction,
      size: stopOrderResponse1.size,
      level: stopOrderResponse1.level,
      limitLevel: stopOrderResponse1.limitLevel,
      nextStep: "A1"
    }, {
      dealId: stopOrderResponse2.dealId,
      dealReference: stopOrderResponse2.dealReference,
      direction: stopOrderResponse2.direction,
      size: stopOrderResponse2.size,
      level: stopOrderResponse2.level,
      limitLevel: stopOrderResponse2.limitLevel,
      nextStep: "A2"
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

    const responseIgActivity = await newIgActivity(accountData, 'A1', activities.epic, activities.config, orders, positions)
  } catch (e) {
    console.error("step1 error", e)
  }
}

const step2 = async (activities, accountData, event) => {
  // Cerco l'ordine non eseguito
  const refOrder = activities.orders.find(order => order.dealId !== event.dealId)

  // Creo una sessione ig
  const client = new APIClient(APIClient.URL_DEMO, accountData.apiKey);
  await client.rest.login.createSession(accountData.username, accountData.password);

  try {
    // Calcolo la distanza in pip data la configurazione del cross
    const pip = Math.round(event.level * (activities.config.percentage / 100) * activities.config.scalingFactor) /
      activities.config.scalingFactor

    // Definisco i livelli di prezzo per l'ordine STOP e LIMIT
    const levelLimit = event.direction === "SELL" ? event.level-(pip/2) : event.level+(pip/2)
    const levelStop = event.direction === "SELL" ? event.level+pip : event.level-pip

    // Apro i nuovi ordini
    console.group("Nuovi Ordini")
    const limitOrderResponse = await newOrder(client, activities.epic, event.direction === "SELL" ? "BUY" : "SELL", activities.config.contracts, levelLimit, "LIMIT", activities.config.currencies, null, null)
    console.log("limitOrderResponse dealStatus: ", limitOrderResponse.dealStatus)

    const stopOrderResponse = await newOrder(client, activities.epic, event.direction === "SELL" ? "BUY" : "SELL", activities.config.contracts, levelStop, "STOP", activities.config.currencies, null, null)
    console.log("stopOrderResponse dealStatus: ", stopOrderResponse.dealStatus)
    console.groupEnd()

    // se uno dei due ordini non viene eseguito, chiudo posizioni ed ordini, quini riapro dalla posizione A0
    if (limitOrderResponse.dealStatus === "REJECTED" || stopOrderResponse.dealStatus === "REJECTED"){
      console.error("ORDER REJECTED")
      await closeActivity(client, accountData, activities.epic)

      const crossList = {
        activities: true,
        epic: activities.epic,
        instrument: activities.config.instrumentName,
        currencies: activities.config.currencies,
        scalingFactor: activities.config.scalingFactor,
        percentage: activities.config.percentage,
        contracts: activities.config.contracts
      }

      await step0(accountData, [crossList])
      return null
    }

    // chiudo tutte le posizioni aperte
    if(activities.positions.length > 0 ) {
      let totalPL = 0
      console.group("Chiusura posizioni")
      for (const position of activities.positions){
        const responseClosePosition = await closePosition(client, position.dealId, position.direction, position.size, false)
        totalPL += responseClosePosition.profit
      }
      console.log("total PL", totalPL)
      console.groupEnd()
    }

    // Chiudo l'ordine non eseguito
    await client.rest.dealing.deleteOrder(refOrder.dealId)

    const orders = [{
      dealId: limitOrderResponse.dealId,
      dealReference: limitOrderResponse.dealReference,
      direction: limitOrderResponse.direction,
      size: limitOrderResponse.size,
      level: limitOrderResponse.level,
      limitLevel: limitOrderResponse.limitLevel,
      nextStep: "A3"
    }, {
      dealId: stopOrderResponse.dealId,
      dealReference: stopOrderResponse.dealReference,
      direction: stopOrderResponse.direction,
      size: stopOrderResponse.size,
      level: stopOrderResponse.level,
      limitLevel: stopOrderResponse.limitLevel,
      nextStep: "A1"
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

    const responseIgActivity = await newIgActivity(accountData, 'A2', activities.epic, activities.config, orders, positions)
  } catch (e) {
    console.error("step2 error", e)
  }
}

const step3 = async (activities, accountData, event) => {
  // Cerco l'ordine non eseguito
  const refOrder = activities.orders.find(order => order.dealId !== event.dealId)

  // Creo una sessione ig
  const client = new APIClient(APIClient.URL_DEMO, accountData.apiKey);
  await client.rest.login.createSession(accountData.username, accountData.password);

  try {
    // Chiudo l'ordine non eseguito
    await client.rest.dealing.deleteOrder(refOrder.dealId)

    // Calcolo la distanza in pip data la configurazione del cross
    const pip = Math.round(event.level * (activities.config.percentage / 100) * activities.config.scalingFactor) /
      activities.config.scalingFactor

    // Definisco i livelli di prezzo per l'ordine STOP e LIMIT
    const levelStop1 = event.direction === "BUY" ? event.level-pip : event.level+pip
    const levelStop2 = event.direction === "BUY" ? activities.positions[0].level+pip : activities.positions[0].level-pip

    // Apro i nuovi ordini
    console.group("Nuovi Ordini")
    const stopOrderResponse1 = await newOrder(client, activities.epic, event.direction === "BUY" ? "SELL" : "BUY", activities.config.contracts, levelStop1, "STOP", activities.config.currencies, null, null)
    console.log("stopOrderResponse1 dealStatus: ", stopOrderResponse1.dealStatus)

    const stopOrderResponse2 = await newOrder(client, activities.epic, event.direction, activities.config.contracts, levelStop2, "STOP", activities.config.currencies, null, null)
    console.log("stopOrderResponse2 dealStatus: ", stopOrderResponse2.dealStatus)
    console.groupEnd()

    // se uno dei due ordini non viene eseguito, chiudo posizioni ed ordini, quini riapro dalla posizione A0
    if (stopOrderResponse1.dealStatus === "REJECTED" || stopOrderResponse2.dealStatus === "REJECTED"){
      console.error("ORDER REJECTED")
      await closeActivity(client, accountData, activities.epic)

      const crossList = {
        activities: true,
        epic: activities.epic,
        instrument: activities.config.instrumentName,
        currencies: activities.config.currencies,
        scalingFactor: activities.config.scalingFactor,
        percentage: activities.config.percentage,
        contracts: activities.config.contracts
      }

      await step0(accountData, [crossList])
      return null
    }

    const orders = [{
      dealId: stopOrderResponse1.dealId,
      dealReference: stopOrderResponse1.dealReference,
      direction: stopOrderResponse1.direction,
      size: stopOrderResponse1.size,
      level: stopOrderResponse1.level,
      limitLevel: stopOrderResponse1.limitLevel,
      nextStep: "A1"
    }, {
      dealId: stopOrderResponse2.dealId,
      dealReference: stopOrderResponse2.dealReference,
      direction: stopOrderResponse2.direction,
      size: stopOrderResponse2.size,
      level: stopOrderResponse2.level,
      limitLevel: stopOrderResponse2.limitLevel,
      nextStep: "A1"
    }]

    const positions = [{
      dealId: activities.positions[0].dealId,
      dealReference: activities.positions[0].dealReference,
      direction: activities.positions[0].direction,
      size: activities.positions[0].size,
      level: activities.positions[0].level,
      limitLevel: activities.positions[0].limitLevel,
      nextStep: null
    }, {
      dealId: event.dealId,
      dealReference: event.dealReference,
      direction: event.direction,
      size: event.size,
      level: event.level,
      limitLevel: event.limitLevel,
      nextStep: null
    }]

    const responseIgActivity = await newIgActivity(accountData, 'A3', activities.epic, activities.config, orders, positions)
  } catch (e) {
    console.error("step2 error", e)
  }
}

// funzione per creare un nuovo ordine su ig
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

  try {
    const dealReference = await client.rest.dealing.createOrder(orderData)
    return await client.rest.dealing.confirmTrade(dealReference)
  }catch (e) {
    console.error("newOrder error", e)
    return e
  }
}

// funzione per chiudere una posizione su ig
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
  try {
    const dealReference = await client.rest.dealing.closePosition(data)
    return await client.rest.dealing.confirmTrade(dealReference)
  }catch (e) {
    console.error("closePosition error", e)
    return e
  }
}

// funzione per chiudere tutti gli ordini e le posizioni aperte relative ad uno specifico corss su ig
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

module.exports = {
  igSession,
  newOrder,
  step0,
  step1,
  step2,
  step3
}
