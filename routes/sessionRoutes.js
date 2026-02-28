const router = require("express").Router();
const Session = require("../models/FSEModel/Session");

// ▶️ START DAY
router.post("/start", async (req, res) => {
  const { userId, latitude, longitude } = req.body;

  const session = await Session.create({
    userId,
    startLocation: { latitude, longitude },
  });

  res.json(session);
});

// ⏹️ END DAY
router.post("/end", async (req, res) => {
  const { sessionId } = req.body;

  const session = await Session.findByIdAndUpdate(
    sessionId,
    {
      endTime: new Date(),
      status: "ENDED",
    },
    { new: true }
  );

  res.json(session);
});

module.exports = router;