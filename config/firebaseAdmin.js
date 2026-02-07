const admin = require("firebase-admin");

let serviceAccount;

switch (process.env.NODE_ENV) {

  case "prod":
    serviceAccount = require("../firebase-services-prod.json");
    break;

  case "dev":
    serviceAccount = require("../firebase-services-dev.json");
    break;

  default:
    console.warn("NODE_ENV not set. Using development Firebase config.");
    serviceAccount = require("../firebase-services-dev.json");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

module.exports = admin;