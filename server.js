const express = require("express");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const http = require("http");
const { Server } = require("socket.io");
const Location = require("./models/LocationModel/Location");

const dns = require("dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]);
dotenv.config({
  path: `.env.${process.env.NODE_ENV || "dev"}`,
});
connectDB();

const startAutoEndJob = require("./cron/autoEndDay");
startAutoEndJob();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static("uploads"));

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/auth", require("./routes/adminAuth"));

app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/territory", require("./routes/territoryRoutes"));

app.use("/api/distributors", require("./routes/distributorRoutes"));
app.use("/api/location", require("./routes/locationRoutes"));

app.use("/api/retailers", require("./routes/retailerRoute"));
app.use("/api/fse", require("./routes/fseRoutes"));
app.use("/api/session", require("./routes/sessionRoutes"));
// ✅ Create HTTP server
const server = http.createServer(app);

// ✅ Attach Socket.io
const io = new Server(server, {
  cors: { origin: "*" },
});

// 🔥 Store users (temporary or DB)
// let users = {};

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("send-location", async (data) => {
    const { userId, sessionId, latitude, longitude } = data;

    if (!userId || !latitude || !longitude) {
      return res.status(400).json({ message: "Missing fields" });
    }
    
    await Location.create({
      userId,
      sessionId,
      latitude,
      longitude,
    });

    io.emit("users-location", { userId, latitude, longitude });
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
