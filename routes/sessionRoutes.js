// const express = require("express");
// const router = express.Router();
// const Session = require("../models/FSEModel/Session");
// const calculateDistance = require("../utils/distance");

// // START DAY
// router.post("/start", async (req, res) => {

//   const { userId, latitude, longitude } = req.body;

//   const session = await Session.create({

//     userId,

//     startLocation: { latitude, longitude },

//     route: [{ latitude, longitude }]

//   });

//   res.json(session);

// });



// // UPDATE LOCATION
// router.post("/location/update", async (req, res) => {

//   const { userId, sessionId, latitude, longitude } = req.body;

//   const session = await Session.findById(sessionId);

//   if (!session) {
//     return res.status(404).json({ message: "Session not found" });
//   }

//   const lastPoint = session.route[session.route.length - 1];

//   let distance = 0;

//   if (lastPoint) {

//     distance = calculateDistance(
//       lastPoint.latitude,
//       lastPoint.longitude,
//       latitude,
//       longitude
//     );

//   }

//   session.totalDistanceKm += distance;

//   session.route.push({
//     latitude,
//     longitude
//   });

//   await session.save();


//   await Location.create({
//     userId,
//     sessionId,
//     latitude,
//     longitude
//   });

//   res.json({ success: true });

// });



// // END DAY
// router.post("/end", async (req, res) => {

//   const { sessionId } = req.body;

//   const session = await Session.findByIdAndUpdate(

//     sessionId,

//     {
//       status: "ENDED",
//       endTime: new Date()
//     },

//     { new: true }

//   );

//   res.json(session);

// });



// // GET SESSION
// router.get("/:id", async (req, res) => {

//   const session = await Session.findById(req.params.id);

//   res.json(session);

// });

// setInterval(async () => {

//  const sessions = await Session.find({ status: "ACTIVE" });

//  const now = new Date();

//  for (let s of sessions) {

//    const diff =
//      (now - new Date(s.startTime)) / 1000 / 60 / 60;

//    if (diff > 12) {

//      s.status = "AUTO_ENDED";
//      s.endTime = new Date();

//      await s.save();
//    }

//  }

// }, 60000);


// module.exports = router;

const express = require("express");
const router = express.Router();
const Session = require("../models/FSEModel/Session");

router.post("/start", async (req, res) => {

  try {

    const { userId, latitude, longitude } = req.body;

    const startOfDay = new Date();
    startOfDay.setHours(0,0,0,0);

    const endOfDay = new Date();
    endOfDay.setHours(23,59,59,999);

    const existingSession = await Session.findOne({
      userId,
      startTime: { $gte: startOfDay, $lte: endOfDay }
    });

    if (existingSession) {
      return res.json(existingSession);
    }

    const session = await Session.create({

      userId,

      startLocation: {
        latitude,
        longitude
      }

    });

    res.json(session);

  } catch (err) {

    console.log(err);
    res.status(500).json({ message: "Session start error" });

  }

});

router.post("/end", async (req, res) => {

  const { sessionId } = req.body;

  const session = await Session.findByIdAndUpdate(

    sessionId,

    {
      status: "ENDED",
      endTime: new Date()
    },

    { new: true }

  );

  res.json(session);

});

router.get("/:sessionId", async (req, res) => {

  const session = await Session.findById(req.params.sessionId);

  res.json(session);

});

module.exports = router;