const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

module.exports = admin;


// const admin = require("firebase-admin");

// let serviceAccount;

// switch (process.env.NODE_ENV) {

//   case "prod":
//     serviceAccount = require("../firebase-services-prod.json");
//     break;

//   case "dev":
//     serviceAccount = require("../firebase-services-dev.json");
//     break;

//   default:
//     console.warn("NODE_ENV not set. Using development Firebase config.");
//     serviceAccount = require("../firebase-services-dev.json");
// }

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount)
// });

// module.exports = admin;