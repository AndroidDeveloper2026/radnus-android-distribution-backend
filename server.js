// server.js - COMPLETE FIXED VERSION

require("dotenv").config({
  path: `.env.${process.env.NODE_ENV || "dev"}`,
});
// "Today", cron times and Date#setHours must follow India time even when the
// host (Render/AWS/...) runs in UTC. Set before any Date is used.
process.env.TZ = process.env.TZ || "Asia/Kolkata";

const express = require("express");
const connectDB = require("./config/db");
const http = require("http");
const socketIo = require("socket.io");
const Session = require("./models/FSEModel/Session");
const Location = require("./models/LocationModel/Location");
const salespersonRoutes = require("./routes/salespersonRoutes");
const dns = require("dns");
const cors = require("cors");
const auth = require("./middleware/authMiddleware");
const { canViewUser } = require("./utils/hierarchyScope");
const { attachSocketAuth, joinPersonalRooms } = require("./utils/teamSocket");

dns.setServers(["1.1.1.1", "8.8.8.8"]);
dns.setDefaultResultOrder("ipv4first");

connectDB();

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use("/uploads", express.static("uploads"));
app.use(cors({
  origin: "*",
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use((req, res, next) => {
  // Never log request bodies: they contain passwords, OTPs and GPS batches.
  console.log(`📨 ${req.method} ${req.path}`);
  next();
});

// ✅ FIX: Create HTTP server and Socket.IO FIRST
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ✅ FIX: Attach req.io BEFORE registering routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ✅ API ROUTES (Now req.io is available)
console.log("🔗 Registering API routes...");
app.use("/api/auth", require("./routes/authRoutes"));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/approvals', require('./routes/approvalRoutes'));
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/territory", require("./routes/territoryRoutes"));
app.use("/api/distributors", require("./routes/distributorRoutes"));
app.use("/api/retailers", require("./routes/retailerRoute"));
app.use("/api/fse", auth, require("./routes/fseRoutes"));
app.use("/api/session", auth, require("./routes/sessionRoutes"));
app.use("/api/team", auth, require("./routes/teamRoutes"));
app.use("/api/location", auth, require("./routes/locationRoutes"));
app.use("/api/executives", require("./routes/executiveRoutes"));
app.use("/api/managers", require("./routes/managerRoutes"));
app.use("/api/customers", require("./routes/customerRoutes"));
app.use("/api/invoices", require("./routes/invoiceRoutes"));
app.use('/api/feedback', require("./routes/feedbackroutes"));
app.use("/api/activity-logs", require("./routes/activityLogRoutes"));
app.use("/api/profile", require("./routes/profileRoutes"));
app.use("/api/sales-returns", require("./routes/salesReturnRoutes"));
app.use("/api/purchase-returns", require("./routes/purchaseReturnRoutes"));
app.use("/api/suppliers", require("./routes/supplierRoutes"));
app.use("/api/purchases", require("./routes/purchaseRoutes"));
app.use("/api/salespersons", require("./routes/salespersonRoutes"));
app.use("/api/app", require("./routes/appVersionRoutes"));
app.use("/api/attendance", require("./routes/attendanceRoutes"));
console.log("✅ All routes registered");

const startAutoEndJob = require("./cron/autoEndDay");
startAutoEndJob();
require("./cron/markAbsent").start();

// ✅ SOCKET.IO CONNECTION (JWT required; superiors get rooms)
attachSocketAuth(io);
io.on("connection", socket => {
  console.log(`📱 User connected: ${socket.id} (${socket.user && socket.user.role})`);
  joinPersonalRooms(socket);

  const subscribedSessions = new Set();
  let userLocation = null;

  socket.on("subscribe-location", async ({ sessionId } = {}) => {
    if (!sessionId) {
      console.log(`⚠️ ${socket.id} subscribe-location called without sessionId`);
      return;
    }

    // Only the owner, their superiors or Admin may watch a session.
    try {
      const s = await Session.findById(sessionId).select("userId").lean();
      if (!s || !(await canViewUser(socket.user, s.userId))) {
        socket.emit("subscribe-denied", { sessionId });
        return;
      }
    } catch (e) {
      return;
    }

    subscribedSessions.add(sessionId);
    socket.join(`session-${sessionId}`);
    console.log(`✅ Socket ${socket.id} subscribed to session ${sessionId}`);

    if (userLocation) {
      socket.emit("session-location", {
        sessionId,
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        timestamp: userLocation.timestamp || new Date(),
        isCached: true
      });
    }
  });

  socket.on("unsubscribe-location", ({ sessionId }) => {
    if (!sessionId) return;
    subscribedSessions.delete(sessionId);
    socket.leave(`session-${sessionId}`);
    console.log(`✅ Socket ${socket.id} unsubscribed from session ${sessionId}`);
  });

  socket.on("send-location", data => {
    try {
      const { sessionId, latitude, longitude, timestamp } = data;
      if (!sessionId || latitude === undefined || longitude === undefined) {
        console.log(`⚠️ ${socket.id} Invalid location data:`, data);
        return;
      }
      userLocation = { latitude, longitude, timestamp: timestamp || new Date() };
    } catch (err) {
      console.log(`❌ Socket location cache error from ${socket.id}:`, err.message);
    }
  });

  socket.on("disconnect", (reason) => {
    console.log(`🔌 User disconnected: ${socket.id} (${reason})`);
    subscribedSessions.clear();
  });

  socket.on("error", (error) => {
    console.log(`❌ Socket error from ${socket.id}:`, error);
  });

  socket.on("ping", () => {
    socket.emit("pong");
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "✅ Server is running",
    timestamp: new Date().toISOString(),
    port: process.env.PORT || 5000,
    socketConnections: io.engine.clientsCount || 0
  });
});

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use((err, req, res, next) => {
  console.log('❌ Unhandled error:', err);
  res.status(500).json({
    message: "Internal server error",
    error: err.message
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`
  ╔════════════════════════════════════════════════════════════╗
  ║  🚀 Server running on port ${PORT}                           ║
  ║  📡 Socket.IO: ws://0.0.0.0:${PORT}                         ║
  ║  🌐 Environment: ${process.env.NODE_ENV || 'development'}    ║
  ╚════════════════════════════════════════════════════════════╝
  `);
});

const gracefulShutdown = () => {
  console.log("📛 Shutdown signal received");
  io.close(() => console.log("✅ Socket.IO closed"));
  server.close(() => {
    console.log("✅ HTTP server closed");
    process.exit(0);
  });
  setTimeout(() => {
    console.log("⚠️ Force exit after timeout");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

process.on("unhandledRejection", (reason, promise) => {
  console.log("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.log("❌ Uncaught Exception:", error);
});

//------------- 05.10.26 Backup -----------------
// // server.js - COMPLETE FIXED VERSION

// require("dotenv").config({
//   path: `.env.${process.env.NODE_ENV || "dev"}`,
// });
// const express = require("express");
// const connectDB = require("./config/db");
// const http = require("http");
// const socketIo = require("socket.io");
// const Session = require("./models/FSEModel/Session");
// const Location = require("./models/LocationModel/Location");
// const salespersonRoutes = require("./routes/salespersonRoutes");
// const dns = require("dns");
// const cors = require("cors");

// dns.setServers(["1.1.1.1", "8.8.8.8"]);
// dns.setDefaultResultOrder("ipv4first");

// connectDB();

// const app = express();

// app.use(express.json({ limit: '50mb' }));
// app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// app.use("/uploads", express.static("uploads"));
// app.use(cors({
//   origin: "*",
//   credentials: true,
//   methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
//   allowedHeaders: ["Content-Type", "Authorization"]
// }));

// app.use((req, res, next) => {
//   console.log(`📨 ${req.method} ${req.path}`);
//   if (req.body && Object.keys(req.body).length > 0) {
//     console.log('📦 Body:', JSON.stringify(req.body, null, 2));
//   }
//   next();
// });

// // ✅ FIX: Create HTTP server and Socket.IO FIRST
// const server = http.createServer(app);

// const io = socketIo(server, {
//   cors: {
//     origin: "*",
//     methods: ["GET", "POST", "OPTIONS"],
//     credentials: true
//   },
//   transports: ['websocket', 'polling'],
//   pingTimeout: 60000,
//   pingInterval: 25000,
// });

// // ✅ FIX: Attach req.io BEFORE registering routes
// app.use((req, res, next) => {
//   req.io = io;
//   next();
// });

// // ✅ API ROUTES (Now req.io is available)
// console.log("🔗 Registering API routes...");
// app.use("/api/auth", require("./routes/authRoutes"));
// app.use('/api/admin', require('./routes/adminRoutes'));
// app.use('/api/approvals', require('./routes/approvalRoutes'));
// app.use("/api/products", require("./routes/productRoutes"));
// app.use("/api/territory", require("./routes/territoryRoutes"));
// app.use("/api/distributors", require("./routes/distributorRoutes"));
// app.use("/api/retailers", require("./routes/retailerRoute"));
// app.use("/api/fse", require("./routes/fseRoutes"));
// app.use("/api/session", require("./routes/sessionRoutes"));
// app.use("/api/location", require("./routes/locationRoutes"));
// app.use("/api/executives", require("./routes/executiveRoutes"));
// app.use("/api/managers", require("./routes/managerRoutes"));
// app.use("/api/customers", require("./routes/customerRoutes"));
// app.use("/api/invoices", require("./routes/invoiceRoutes"));
// app.use('/api/feedback', require("./routes/feedbackroutes"));
// app.use("/api/activity-logs", require("./routes/activityLogRoutes"));
// app.use("/api/profile", require("./routes/profileRoutes"));
// app.use("/api/sales-returns", require("./routes/salesReturnRoutes"));
// app.use("/api/purchase-returns", require("./routes/purchaseReturnRoutes"));
// app.use("/api/suppliers", require("./routes/supplierRoutes"));
// app.use("/api/purchases", require("./routes/purchaseRoutes"));
// app.use("/api/salespersons", require("./routes/salespersonRoutes"));
// app.use("/api/app", require("./routes/appVersionRoutes"));
// console.log("✅ All routes registered");

// const startAutoEndJob = require("./cron/autoEndDay");
// startAutoEndJob();

// // ✅ SOCKET.IO CONNECTION
// io.on("connection", socket => {
//   console.log(`📱 User connected: ${socket.id}`);

//   const subscribedSessions = new Set();
//   let userLocation = null;

//   socket.on("subscribe-location", ({ sessionId }) => {
//     if (!sessionId) {
//       console.log(`⚠️ ${socket.id} subscribe-location called without sessionId`);
//       return;
//     }

//     subscribedSessions.add(sessionId);
//     socket.join(`session-${sessionId}`);
//     console.log(`✅ Socket ${socket.id} subscribed to session ${sessionId}`);

//     if (userLocation) {
//       socket.emit("session-location", {
//         sessionId,
//         latitude: userLocation.latitude,
//         longitude: userLocation.longitude,
//         timestamp: userLocation.timestamp || new Date(),
//         isCached: true
//       });
//     }
//   });

//   socket.on("unsubscribe-location", ({ sessionId }) => {
//     if (!sessionId) return;
//     subscribedSessions.delete(sessionId);
//     socket.leave(`session-${sessionId}`);
//     console.log(`✅ Socket ${socket.id} unsubscribed from session ${sessionId}`);
//   });

//   socket.on("send-location", data => {
//     try {
//       const { sessionId, latitude, longitude, timestamp } = data;
//       if (!sessionId || latitude === undefined || longitude === undefined) {
//         console.log(`⚠️ ${socket.id} Invalid location data:`, data);
//         return;
//       }
//       userLocation = { latitude, longitude, timestamp: timestamp || new Date() };
//     } catch (err) {
//       console.log(`❌ Socket location cache error from ${socket.id}:`, err.message);
//     }
//   });

//   socket.on("disconnect", (reason) => {
//     console.log(`🔌 User disconnected: ${socket.id} (${reason})`);
//     subscribedSessions.clear();
//   });

//   socket.on("error", (error) => {
//     console.log(`❌ Socket error from ${socket.id}:`, error);
//   });

//   socket.on("ping", () => {
//     socket.emit("pong");
//   });
// });

// app.get("/health", (req, res) => {
//   res.json({
//     status: "✅ Server is running",
//     timestamp: new Date().toISOString(),
//     port: process.env.PORT || 5000,
//     socketConnections: io.engine.clientsCount || 0
//   });
// });

// app.use((req, res) => {
//   res.status(404).json({ message: "Route not found" });
// });

// app.use((err, req, res, next) => {
//   console.log('❌ Unhandled error:', err);
//   res.status(500).json({
//     message: "Internal server error",
//     error: err.message
//   });
// });

// const PORT = process.env.PORT || 5000;
// server.listen(PORT, "0.0.0.0", () => {
//   console.log(`
//   ╔════════════════════════════════════════════════════════════╗
//   ║  🚀 Server running on port ${PORT}                           ║
//   ║  📡 Socket.IO: ws://0.0.0.0:${PORT}                         ║
//   ║  🌐 Environment: ${process.env.NODE_ENV || 'development'}    ║
//   ╚════════════════════════════════════════════════════════════╝
//   `);
// });

// const gracefulShutdown = () => {
//   console.log("📛 Shutdown signal received");
//   io.close(() => console.log("✅ Socket.IO closed"));
//   server.close(() => {
//     console.log("✅ HTTP server closed");
//     process.exit(0);
//   });
//   setTimeout(() => {
//     console.log("⚠️ Force exit after timeout");
//     process.exit(1);
//   }, 10000);
// };

// process.on("SIGTERM", gracefulShutdown);
// process.on("SIGINT", gracefulShutdown);

// process.on("unhandledRejection", (reason, promise) => {
//   console.log("❌ Unhandled Rejection at:", promise, "reason:", reason);
// });

// process.on("uncaughtException", (error) => {
//   console.log("❌ Uncaught Exception:", error);
// });