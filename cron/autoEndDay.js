const cron = require("node-cron");
const Session = require("../models/FSEModel/Session");

const startAutoEndJob = () => {
  cron.schedule("59 23 * * *", async () => {
    console.log("Running Auto End Day Job...");

    try {
      const activeSessions = await Session.find({ status: "ACTIVE" });

      for (let session of activeSessions) {
        session.status = "AUTO_ENDED";
        session.endTime = new Date();
        await session.save();
      }

      console.log("Auto End Day completed");
    } catch (err) {
      console.error("Cron Error:", err);
    }
  });
};

module.exports = startAutoEndJob;