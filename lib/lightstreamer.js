import {LightstreamerClient, Subscription} from "lightstreamer-client-node";

import {igSession} from './rest'
import {connectToDb, getIgActivities} from "./mongoDB";
import {step1, step2, step3} from "./restV3";

let reconnectIntervalId = null;
let isConnected = false

async function lightstreamer(accountData) {
  if (isConnected) {
    return
  }

  let security = await igSession(accountData.username, accountData.password, accountData.apiKey)

  await connectToDb(security.accountId)

  // Instantiate Lightstreamer client instance
  const lsClient = new LightstreamerClient(security.lightstreamerEndpoint)

  // Set up login credentials
  lsClient.connectionDetails.setUser(security.accountId)
  lsClient.connectionDetails.setPassword(`CST-${security.cst}|XST-${security.xSecurityToken}`)

  lsClient.addListener({
    onListenStart: () => {
      console.log('IG ListenStart')
    },
    onStatusChange: (status) => {
      console.log('IG connection status:', status)
      if (status === 'CONNECTED:STREAM-SENSING') {
        isConnected = true
        //stopReconnectInterval();
      } else if (status === 'DISCONNECTED') {
        isConnected = false
        //startReconnectInterval(lsClient);
      }
    },
    onServerError: (code, message) => {
      console.log(`Server error: ${code} message: ${message}`)
    },
    onSubscriptionError: (code, message) => {
      console.log(`Subscription error: ${code} message: ${message}`)
    }
  })

  // Connect to Lightstreamer
  lsClient.connect()

  const subscription = new Subscription('DISTINCT', [`TRADE:${security.accountId}`], ['OPU'])

  subscription.addListener({
    onSubscription: () => {
      console.log('subscribed')
    },
    onUnsubscription: () => {
      console.log('unsubscribed')
    },
    onSubscriptionError: (code, message) => {
      console.log(`subscription failure: ${code} message: ${message}`)
    },
    onItemUpdate: (updateInfo) => {
      // Lightstreamer published some data
      updateInfo.forEachField(async (fieldName, fieldPos, value) => {
        const confirm = JSON.parse(value)

        if (confirm && confirm.channel === 'OSAutoStopFill' && confirm.status === 'OPEN'){
          // quando si verifica un evento su ig, anzitutto cerco le informazioni relative a quell'epic salvate sul db
          const activities = await getIgActivities(accountData, confirm.epic)

          //quindi, verifico in quale casistica ci troviamo
          switch (activities[0].step) {
            // da A0 passo ad A1
            case "A0": {
              // casistica A0
              console.group("A0 - " + confirm.epic)
              // eseguo la funzione step1
              await step1(activities[0], accountData, confirm)
              console.groupEnd()
              break
            }

            // da A1 passo ad A1 o A2
            case "A1": {
              // casistica A0
              console.group("A1 - " + confirm.epic)
              // controllo sul db quale ordine è appena stato eseguito, al suo interno ho salvato il passaggio successivo
              // che si deve svolgere
              const refOrder = activities[0].orders.find(order => order.dealId === confirm.dealId)

              // se A1
              if (refOrder.nextStep === "A1"){
                console.log("next step", refOrder.nextStep)
                // eseguo la funzione step1
                await step1(activities[0], accountData, confirm)
              }

              // se A2
              if (refOrder.nextStep === "A2"){
                console.log("next step", refOrder.nextStep)
                // eseguo la funzione step2
                await step2(activities[0], accountData, confirm)
              }
              console.groupEnd()
              break
            }

            // da A1 passo ad A1 o A3
            case "A2": {
              console.group("A2 - "+confirm.epic)
              // controllo sul db quale ordine è appena stato eseguito, al suo interno ho salvato il passaggio successivo
              // che si deve svolgere
              const refOrder = activities[0].orders.find(order => order.dealId === confirm.dealId)

              // se A1
              if (refOrder.nextStep === "A1"){
                console.log("next step", refOrder.nextStep)
                // eseguo la funzione step1
                await step1(activities[0], accountData, confirm)
              }
              // se A3
              if (refOrder.nextStep === "A3"){
                console.log("next step", refOrder.nextStep)
                // eseguo la funzione step3
                await step3(activities[0], accountData, confirm)
              }
              console.groupEnd()
              break
            }

            // da A1 passo ad A1
            case "A3": {
              console.group("A3 - "+confirm.epic)
              // eseguo la funzione step1
              await step1(activities[0], accountData, confirm)
              console.groupEnd()
              break
            }

            default: return null
          }
        }
      })
    }
  })
  // Subscribe to Lightstreamer
  lsClient.subscribe(subscription)
}

function startReconnectInterval(lsClient) {
  reconnectIntervalId = setInterval(() => {
    if (!isConnected) {
      console.log('Stiamo tentando di riconnetterci...');
      lsClient.connect();
    }
  }, 21600000);
}

function stopReconnectInterval() {
  clearInterval(reconnectIntervalId);
}

module.exports = {
  lightstreamer
}
