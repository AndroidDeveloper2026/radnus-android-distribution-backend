// const express = require("express");
// const router = express.Router();
// const Location = require("../models/LocationModel/Location");

// router.post("/update", async (req, res) => {
//  const { sessionId, latitude, longitude } = req.body;

//  const location = new Location({
//    sessionId,
//    latitude,
//    longitude,
//  });

//  await location.save();

//  res.json({ success: true });
// });

// router.get("/route/:sessionId", async (req, res) => {
//  const data = await Location.find({
//    sessionId: req.params.sessionId,
//  }).sort({ timestamp: 1 });

//  res.json(data);
// });

// module.exports = router;

const express = require("express");
const router = express.Router();
const Location = require("../models/LocationModel/Location");
const { getDistance } = require("geolib");

router.post("/update", async (req, res) => {

 try {

   const { userId, sessionId, latitude, longitude } = req.body;

   if (!sessionId || !latitude || !longitude) {
     return res.status(400).json({ message: "Invalid data" });
   }

   const lastLocation = await Location.findOne({ sessionId })
     .sort({ timestamp: -1 });

   let distance = 0;

   if (lastLocation) {

     distance = getDistance(
       {
         latitude: lastLocation.latitude,
         longitude: lastLocation.longitude
       },
       {
         latitude,
         longitude
       }
     );

     // ignore GPS drift (<10 meters)
     if (distance < 10) {
       return res.json({ ignored: true });
     }
   }

   const location = new Location({
     userId,
     sessionId,
     latitude,
     longitude
   });

   await location.save();

   // emit socket
   req.io.emit("users-location", {
     sessionId,
     latitude,
     longitude
   });

   res.json({
     success: true,
     distanceMeters: distance
   });

 } catch (err) {
   console.log(err);
   res.status(500).json({ message: "Server error" });
 }
});


router.get("/route/:sessionId", async (req, res) => {

 const data = await Location.find({
   sessionId: req.params.sessionId
 }).sort({ timestamp: 1 });

 res.json(data);
});


module.exports = router;
