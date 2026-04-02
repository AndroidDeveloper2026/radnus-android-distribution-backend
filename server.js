// const dotenv = require("dotenv");
// dotenv.config({
//   path: `.env.${process.env.NODE_ENV || "dev"}`,
// });
require("dotenv").config({
  path: `.env.${process.env.NODE_ENV || "dev"}`,
});
const express = require("express");
const connectDB = require("./config/db");
const http = require("http");
const socketIo = require("socket.io");
const Session = require("./models/FSEModel/Session");
const dns = require("dns");

// ✅ DNS CONFIGURATION
dns.setServers(["1.1.1.1", "8.8.8.8"]);
dns.setDefaultResultOrder("ipv4first");

// ✅ CONNECT TO DATABASE
connectDB();

// ✅ CREATE EXPRESS APP FIRST (BEFORE ANY MIDDLEWARE)
const app = express();

// ✅ MIDDLEWARE - PARSE REQUESTS
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ✅ STATIC FILES
app.use("/uploads", express.static("uploads"));

// ✅ CORS MIDDLEWARE (if needed for web clients)
const cors = require("cors");
app.use(cors({
  origin: "*",
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// ✅ REQUEST LOGGING MIDDLEWARE
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.path}`);
  console.log('📦 Body:', JSON.stringify(req.body, null, 2));
  next();
});

// ✅ START AUTO-END JOB
const startAutoEndJob = require("./cron/autoEndDay");
startAutoEndJob();

// ✅ API ROUTES
console.log("🔗 Registering API routes...");
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/territory", require("./routes/territoryRoutes"));
app.use("/api/distributors", require("./routes/distributorRoutes"));
app.use("/api/retailers", require("./routes/retailerRoute"));
app.use("/api/fse", require("./routes/fseRoutes"));
app.use("/api/session", require("./routes/sessionRoutes"));
app.use("/api/location", require("./routes/locationRoutes"));
app.use("/api/executives", require("./routes/executiveRoutes"));
app.use("/api/managers", require("./routes/managerRoutes"));
app.use("/api/customers",   require("./routes/customerRoutes"));
app.use("/api/invoices", require("./routes/invoiceRoutes"));
app.use('/api/feedback', require("./routes/feedbackroutes"));
console.log("✅ All routes registered");

// ✅ CREATE HTTP SERVER & ATTACH SOCKET.IO
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// ✅ ATTACH IO TO REQUESTS
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ✅ SOCKET.IO CONNECTION & REAL-TIME TRACKING
io.on("connection", socket => {
  console.log(`📱 User connected: ${socket.id}`);

  // ✅ RECEIVE LOCATION FROM MOBILE
  socket.on("send-location", async data => {
    try {
      const { sessionId, latitude, longitude } = data;

      if (!sessionId || latitude === undefined || longitude === undefined) {
        console.log('⚠️ Invalid location data:', data);
        return;
      }

      console.log(`📍 Location received for session ${sessionId}: [${latitude.toFixed(4)}, ${longitude.toFixed(4)}]`);

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
        console.log('❌ Session not found:', sessionId);
        return;
      }

      // ✅ BROADCAST LOCATION TO ALL CONNECTED CLIENTS
      io.emit("users-location", {
        sessionId,
        latitude,
        longitude,
        timestamp: new Date()
      });

      console.log(`✅ Location broadcasted`);

    } catch (err) {
      console.log('❌ Socket location error:', err.message);
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

// ✅ HEALTH CHECK ENDPOINT
app.get("/health", (req, res) => {
  res.json({ 
    status: "✅ Server is running",
    timestamp: new Date().toISOString(),
    port: process.env.PORT || 5000
  });
});

// ✅ 404 HANDLER
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// ✅ ERROR HANDLER
app.use((err, req, res, next) => {
  console.log('❌ Unhandled error:', err);
  res.status(500).json({ 
    message: "Internal server error",
    error: err.message 
  });
});

// ✅ START SERVER
const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("NODE_ENV:", process.env.NODE_ENV);
  console.log(`
 Server running on port ${PORT} ║ Listening on 0.0.0.0:${PORT}`);
});

// ✅ GRACEFUL SHUTDOWN
process.on("SIGTERM", () => {
  console.log("📛 SIGTERM signal received");
  server.close(() => {
    console.log("✅ Server closed gracefully");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("📛 SIGINT signal received");
  server.close(() => {
    console.log("✅ Server closed gracefully");
    process.exit(0);
  });
});

// ✅ UNHANDLED PROMISE REJECTION
process.on("unhandledRejection", (reason, promise) => {
  console.log("❌ Unhandled Rejection at:", promise, "reason:", reason);
});