const dotenv = require("dotenv");
dotenv.config({
  path: `.env.${process.env.NODE_ENV || "dev"}`,
});
const express = require("express");
const connectDB = require("./config/db");
const http = require("http");
const socketIo = require("socket.io");
const Session = require("./models/FSEModel/Session");
const dns = require("dns");

dns.setServers(["1.1.1.1", "8.8.8.8"]);
dns.setDefaultResultOrder("ipv4first");

connectDB();

// ✅ START AUTO-END JOB
const startAutoEndJob = require("./cron/autoEndDay");
startAutoEndJob();

// ✅ CREATE EXPRESS APP FIRST
const app = express();

// ✅ MIDDLEWARE
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));

// ✅ API ROUTES
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/auth", require("./routes/adminAuth"));
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/territory", require("./routes/territoryRoutes"));
app.use("/api/distributors", require("./routes/distributorRoutes"));
app.use("/api/retailers", require("./routes/retailerRoute"));
app.use("/api/fse", require("./routes/fseRoutes"));
app.use("/api/session", require("./routes/sessionRoutes"));
app.use("/api/location", require("./routes/locationRoutes"));
app.use("/api/executives", require("./routes/executiveRoutes"));
app.use("/api/managers", require("./routes/managerRoutes"));

// ✅ CREATE HTTP SERVER & ATTACH SOCKET.IO
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ✅ ATTACH IO TO REQUESTS
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ✅ SOCKET.IO REAL-TIME TRACKING
io.on("connection", socket => {
  console.log(`📱 User connected: ${socket.id}`);

  // ✅ RECEIVE LOCATION FROM MOBILE
  socket.on("send-location", async data => {
    try {
      const { sessionId, latitude, longitude } = data;

      if (!sessionId || !latitude || !longitude) {
        console.log('❌ Invalid location data:', data);
        return;
      }

      // ✅ Update session route with new location
      const session = await Session.findByIdAndUpdate(
        sessionId,
        {
          $push: {
            route: {
              latitude,
              longitude,
              timestamp: new Date()
            }
          }
        },
        { new: true }
      );

      if (!session) {
        console.log('⚠️ Session not found:', sessionId);
        return;
      }

      // ✅ BROADCAST LOCATION TO ALL CONNECTED CLIENTS
      io.emit("users-location", {
        sessionId,
        latitude,
        longitude,
        timestamp: new Date()
      });

      console.log(`✅ Location broadcasted for session: ${sessionId}`);

    } catch (err) {
      console.log('❌ Socket location error:', err);
    }
  });

  // ✅ HANDLE DISCONNECT
  socket.on("disconnect", () => {
    console.log(`🔌 User disconnected: ${socket.id}`);
  });

  // ✅ ERROR HANDLING
  socket.on("error", (error) => {
    console.log(`❌ Socket error: ${error}`);
  });
});

// ✅ HEALTH CHECK
app.get("/health", (req, res) => {
  res.json({ status: "✅ Server is running" });
});

// ✅ START SERVER
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`
Server running on port ${PORT}`);
});

// ✅ GRACEFUL SHUTDOWN
process.on("SIGTERM", () => {
  console.log("📛 SIGTERM signal received");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});