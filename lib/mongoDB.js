import mongoose from "mongoose";

const connectToDb = async () => {
  const url = process.env.PROD ? process.env.MONGODB_URI : "mongodb://localhost/fxDB"

  try {
    // Controlla se una connessione è già aperta
    mongoose.set('strictQuery', false)

    if (mongoose.connection.readyState === 0) {
      // Chiudi la connessione attuale
      //await mongoose.connection.close();

      // Apri una nuova connessione
      await mongoose.connect(url, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      }, (error)=>{
        console.log("error:", error)
      });

      console.log(`Connected to database: fxDB`);
    }
  } catch (error) {
    console.error(error);
  }
}

/* User */
// Crea un modello per rappresentare un documento User
const userSchema = new mongoose.Schema({
  accountId: String,
  username: String,
  password: String,
  apiKey: String
});

const User = mongoose.model('User', userSchema);

const getUser = async () => {
  if (mongoose.connection.readyState === 0){
    await connectToDb()
  }

  return User.find()
}

const userFindOne = async (accountId) => {
  if (mongoose.connection.readyState === 0){
    await connectToDb()
  }

  return User.findOne({accountId})
}


const newUser = async (data) => {
  if (mongoose.connection.readyState === 0){
    await connectToDb()
  }

  return User.create(data)
}

/* Settings */
// Crea un modello per rappresentare un documento Settings
const settingsSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  watchlist: [{
    active: { type: Boolean, default: true},
    epic: { type: String, required: true },
    instrumentName: { type: String, required: true },
    instrumentType: { type: String, required: true },
    currencies: { type: String, required: true},
    scalingFactor: { type: Number, required: true },
    percentage: { type: Number, required: true, default: 0.3 },
    contracts: { type: Number, required: true, default: 1.5 },
  }]
});
const Settings = mongoose.model('Settings', settingsSchema);

const getSetting = async (id) => {;
  if (mongoose.connection.readyState === 0) {
    await connectToDb()
  }
  return Settings.findOne({user: id})
}

const getSettings = async () => {
  if (mongoose.connection.readyState === 0){
    await connectToDb()
  }
  return Settings.find()
}

const updateSettings = async (accountData, watchlist) => {
  const simpleWatchlist = []
  watchlist.forEach(row=>{
    simpleWatchlist.push({
      active: true,
      epic: row.instrument.epic,
      instrumentName: row.instrument.name,
      instrumentType: row.instrument.type,
      currencies: row.instrument.currencies[0].name,
      scalingFactor: row.snapshot.scalingFactor,
      percentage: 0.3,
      contracts: 1.5
    })
  })

  try {
    return await Settings.findOneAndUpdate(
      { user: accountData._id },
      { watchlist: simpleWatchlist },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error(error);
  }
}

const updateAccountSettings = async (accountData, settings) => {
  try {
    for (const setting of settings) {
      await Settings.findOneAndUpdate(
        { user: accountData, "watchlist._id": setting._id },
        { $set: { "watchlist.$": setting } },
        { upsert: true, new: true }
      )
    }
  } catch (error) {
    console.error(error);
  }
}

/* ig */
// Crea un modello che conterrà tutti i dati relativi a posizioni / ordini
const igSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  step: {type: String, required: true},
  epic: {type: String, required: true},
  config: {
    instrumentName: {type: String, required: true},
    currencies: {type: String, required: true},
    scalingFactor: {type: Number, required: true},
    percentage: {type: Number, required: true},
    contracts: {type: Number, required: true}
  },
  orders: [{
    dealId: {type: String, required: true},
    dealReference: {type: String, required: true},
    direction: {type: String, required: true},
    size: {type: Number, required: true},
    level: {type: Number, required: true},
    limitLevel: {type: Number, required: true},
    nextStep: {type: String, required: true},
  }],
  positions: [{
    dealId: {type: String, required: true},
    dealReference: {type: String, required: true},
    direction: {type: String, required: true},
    size: {type: Number, required: true},
    level: {type: Number, required: true},
    limitLevel: {type: Number, required: false},
    nextStep: {type: String, required: false},
  }],
});
const Ig = mongoose.model('Ig', igSchema);

const getAllIgActivities = async (accountData, epic) => {
  if (mongoose.connection.readyState === 0){
    await connectToDb()
  }

  try {
    return await Ig.find({user: accountData._id})
  }catch (e) {
    console.log(e)
  }
}

const getIgActivities = async (accountData, epic) => {
  if (mongoose.connection.readyState === 0){
    await connectToDb()
  }

  try {
    return await Ig.find({user: accountData._id, epic: epic},)
  }catch (e) {
    console.log(e)
  }
}

const newIgActivity = async (accountData, step, epic, crossConfig, orders, positions) => {
  if (mongoose.connection.readyState === 0){
    await connectToDb()
  }

  try {
    return await Ig.findOneAndUpdate(
      {user: accountData._id, epic: epic},
      {
        user: accountData._id,
        step: step,
        epic: epic,
        config: crossConfig,
        orders: orders,
        positions: positions
      },
      {upsert: true, new: true}
    )
  } catch (error) {
    console.error("findOneAndUpdate", error);
  }
}

const deleteIgActivity = async (accountData, epic) => {
  if (mongoose.connection.readyState === 0){
    await connectToDb()
  }

  try {
    return await Ig.findOneAndDelete(
      {user: accountData._id, epic: epic},
    )
  } catch (error) {
    console.error("findOneAndDelete", error);
  }
}

module.exports = {
  connectToDb,
  getUser,
  userFindOne,
  newUser,
  getSettings,
  getSetting,
  updateSettings,
  updateAccountSettings,
  getAllIgActivities,
  getIgActivities,
  newIgActivity,
  deleteIgActivity
}
