const express = require("express");
const router = express.Router();
const Session = require("../models/FSEModel/Session");


// // ✅ START DAY
// router.post("/start", async (req, res) => {
//  const { userId, latitude, longitude } = req.body;

//  const session = await Session.create({
//    userId,
//    startLocation: { latitude, longitude },
//  });

//  res.send(session);
// });



// // ✅ SAVE LOCATION (IMPORTANT)
// router.post("/location/update", async (req, res) => {
//  const { sessionId, latitude, longitude } = req.body;

//  await Session.findByIdAndUpdate(sessionId, {
//    $push: {
//      route: { latitude, longitude },
//    },
//  });

//  res.send({ success: true });
// });



// // ✅ END DAY
// router.post("/end", async (req, res) => {
//  const { sessionId } = req.body;

//  await Session.findByIdAndUpdate(sessionId, {
//    status: "ENDED",
//    endTime: new Date(),
//  });

//  res.send({ success: true });
// });

// START DAY
router.post("/start", async (req, res) => {
 try {
   const { userId, latitude, longitude } = req.body;

   const session = await Session.create({
     userId,
     startLocation: { latitude, longitude },
   });

   res.json(session);
 } catch (err) {
   res.status(500).json({ message: err.message });
 }
});

// SAVE LOCATION
router.post("/location/update", async (req, res) => {
 try {
   const { sessionId, latitude, longitude } = req.body;

   await Session.findByIdAndUpdate(sessionId, {
     $push: {
       route: { latitude, longitude },
     },
   });

   res.json({ success: true });
 } catch (err) {
   res.status(500).json({ message: err.message });
 }
});

// END DAY
router.post("/end", async (req, res) => {
 try {
   const { sessionId } = req.body;

   await Session.findByIdAndUpdate(sessionId, {
     status: "ENDED",
     endTime: new Date(),
   });

   res.json({ success: true });
 } catch (err) {
   res.status(500).json({ message: err.message });
 }
});

// GET SESSION
router.get("/:id", async (req, res) => {
 const session = await Session.findById(req.params.id);
 res.json(session);
});

// GET TODAY SESSION
router.get("/today/:userId", async (req, res) => {
 const today = new Date();
 today.setHours(0, 0, 0, 0);

 const session = await Session.findOne({
   userId: req.params.userId,
   startTime: { $gte: today },
   status: "ACTIVE",
 });

 res.json(session);
});




// ✅ GET SESSION (MAP HISTORY)
router.get("/:id", async (req, res) => {
 const session = await Session.findById(req.params.id);
 res.send(session);
});



setInterval(async () => {
  const sessions = await Session.find({ status: "ACTIVE" });

  for (let s of sessions) {
    s.status = "AUTO_ENDED";
    s.endTime = new Date();
    await s.save();
  }
}, 60000); // check every 1 min

module.exports = router;