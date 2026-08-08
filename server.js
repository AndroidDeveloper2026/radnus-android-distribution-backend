// server.js

require("dotenv").config({
  path: `.env.${process.env.NODE_ENV || "dev"}`,
});
const express = require("express");
const connectDB = require("./config/db");
const http = require("http");
const socketIo = require("socket.io");
const Session = require("./models/FSEModel/Session");
const Location = require("./models/LocationModel/Location");
const dns = require("dns");
const cors = require("cors");

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
  console.log(`📨 ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('📦 Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// ✅ FIX: create the HTTP server + Socket.IO instance and attach req.io
// BEFORE mounting any API routers. Previously this middleware was added
// after the routers were already mounted, so req.io was undefined inside
// every route handler — locationRoutes.js could never broadcast the
// authoritative accepted-point event.
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

app.use((req, res, next) => {
  req.io = io;
  next();
});

// ✅ API ROUTES
console.log("🔗 Registering API routes...");
app.use("/api/auth", require("./routes/authRoutes"));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/approvals', require('./routes/approvalRoutes'));
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/territory", require("./routes/territoryRoutes"));
app.use("/api/distributors", require("./routes/distributorRoutes"));
app.use("/api/retailers", require("./routes/retailerRoute"));
app.use("/api/fse", require("./routes/fseRoutes"));
app.use("/api/session", require("./routes/sessionRoutes"));
app.use("/api/location", require("./routes/locationRoutes"));
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
console.log("✅ All routes registered");

const startAutoEndJob = require("./cron/autoEndDay");
startAutoEndJob();

// ✅ SOCKET.IO CONNECTION
io.on("connection", socket => {
  console.log(`📱 User connected: ${socket.id}`);

  const subscribedSessions = new Set();
  let userLocation = null;

  socket.on("subscribe-location", ({ sessionId }) => {
    if (!sessionId) {
      console.log(`⚠️ ${socket.id} subscribe-location called without sessionId`);
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

  // ✅ FIX (root cause #2/#3): this handler used to independently
  // `$push` into Session.route and broadcast `users-location`/
  // `session-location` — a second, unvalidated persistence + broadcast
  // pipeline running in parallel with /api/location/update. That created
  // duplicate/out-of-order route points and a broadcast payload with no
  // totalDistanceKm/pointCount. It now ONLY caches the last-seen point in
  // memory so a newly-subscribing client gets an immediate (marked
  // isCached) preview — it does not write to MongoDB and does not
  // broadcast. The single authoritative broadcast now happens in
  // locationRoutes.js right after a point is accepted by
  // processLocationPoint().
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

//----------- 08.08.26 ----------------
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
// const dns = require("dns");
// const cors = require("cors");

// // ✅ DNS CONFIGURATION
// dns.setServers(["1.1.1.1", "8.8.8.8"]);
// dns.setDefaultResultOrder("ipv4first");

// // ✅ CONNECT TO DATABASE
// connectDB();

// // ✅ CREATE EXPRESS APP
// const app = express();

// // ✅ MIDDLEWARE
// app.use(express.json({ limit: '50mb' }));
// app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// app.use("/uploads", express.static("uploads"));
// app.use(cors({
//   origin: "*",
//   credentials: true,
//   methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
//   allowedHeaders: ["Content-Type", "Authorization"]
// }));

// // ✅ REQUEST LOGGING
// app.use((req, res, next) => {
//   console.log(`📨 ${req.method} ${req.path}`);
//   if (req.body && Object.keys(req.body).length > 0) {
//     console.log('📦 Body:', JSON.stringify(req.body, null, 2));
//   }
//   next();
// });

// // ✅ API ROUTES
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
// console.log("✅ All routes registered");

// // ✅ START AUTO-END JOB
// const startAutoEndJob = require("./cron/autoEndDay");
// startAutoEndJob();

// // ✅ CREATE HTTP SERVER
// const server = http.createServer(app);

// // ✅ SOCKET.IO WITH COMPLETE IMPLEMENTATION
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

// // ✅ ATTACH IO TO REQUESTS
// app.use((req, res, next) => {
//   req.io = io;
//   next();
// });

// // ✅ SOCKET.IO CONNECTION - COMPLETE IMPLEMENTATION
// io.on("connection", socket => {
//   console.log(`📱 User connected: ${socket.id}`);
  
//   // ✅ Track subscribed sessions per socket
//   const subscribedSessions = new Set();
//   let userLocation = null;

//   // ✅ HANDLE SUBSCRIBE TO SESSION LOCATION UPDATES
//   socket.on("subscribe-location", ({ sessionId }) => {
//     if (!sessionId) {
//       console.log(`⚠️ ${socket.id} subscribe-location called without sessionId`);
//       return;
//     }
    
//     subscribedSessions.add(sessionId);
//     socket.join(`session-${sessionId}`);
//     console.log(`✅ Socket ${socket.id} subscribed to session ${sessionId}`);
    
//     // ✅ Send last known location immediately if available
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

//   // ✅ HANDLE UNSUBSCRIBE
//   socket.on("unsubscribe-location", ({ sessionId }) => {
//     if (!sessionId) return;
//     subscribedSessions.delete(sessionId);
//     socket.leave(`session-${sessionId}`);
//     console.log(`✅ Socket ${socket.id} unsubscribed from session ${sessionId}`);
//   });

//   // ✅ RECEIVE LOCATION FROM MOBILE
//   socket.on("send-location", async data => {
//     try {
//       const { sessionId, latitude, longitude, timestamp } = data;

//       if (!sessionId || latitude === undefined || longitude === undefined) {
//         console.log(`⚠️ ${socket.id} Invalid location data:`, data);
//         return;
//       }

//       // ✅ Store last known location for this socket
//       userLocation = { latitude, longitude, timestamp: timestamp || new Date() };

//       console.log(`📍 Location received from ${socket.id} for session ${sessionId}: [${latitude.toFixed(6)}, ${longitude.toFixed(6)}]`);

//       // ✅ Update session route
//       try {
//         const session = await Session.findByIdAndUpdate(
//           sessionId,
//           {
//             $push: {
//               route: {
//                 latitude,
//                 longitude,
//                 timestamp: timestamp || new Date()
//               }
//             }
//           },
//           { new: true }
//         );

//         if (!session) {
//           console.log(`❌ Session not found: ${sessionId}`);
//           return;
//         }
        
//         console.log(`✅ Session ${sessionId} updated - route length: ${session.route.length}`);
//       } catch (dbErr) {
//         console.log(`❌ Database error for session ${sessionId}:`, dbErr.message);
//         // Don't fail - still broadcast the location
//       }

//       // ✅ BROADCAST TO ALL CLIENTS (global for backward compatibility)
//       io.emit("users-location", {
//         sessionId,
//         latitude,
//         longitude,
//         timestamp: timestamp || new Date(),
//         socketId: socket.id
//       });

//       // ✅ BROADCAST TO SESSION-SPECIFIC ROOM (targeted updates)
//       io.to(`session-${sessionId}`).emit("session-location", {
//         sessionId,
//         latitude,
//         longitude,
//         timestamp: timestamp || new Date(),
//         socketId: socket.id
//       });

//       console.log(`✅ Location broadcasted to ${subscribedSessions.size} subscribers`);

//     } catch (err) {
//       console.log(`❌ Socket location error from ${socket.id}:`, err.message);
//     }
//   });

//   // ✅ HANDLE DISCONNECT
//   socket.on("disconnect", (reason) => {
//     console.log(`🔌 User disconnected: ${socket.id} (${reason})`);
//     subscribedSessions.clear();
//   });

//   // ✅ ERROR HANDLING
//   socket.on("error", (error) => {
//     console.log(`❌ Socket error from ${socket.id}:`, error);
//   });

//   // ✅ PING/PONG for connection health
//   socket.on("ping", () => {
//     socket.emit("pong");
//   });
// });

// // ✅ HEALTH CHECK ENDPOINT
// app.get("/health", (req, res) => {
//   res.json({ 
//     status: "✅ Server is running",
//     timestamp: new Date().toISOString(),
//     port: process.env.PORT || 5000,
//     socketConnections: io.engine.clientsCount || 0
//   });
// });

// // ✅ 404 HANDLER
// app.use((req, res) => {
//   res.status(404).json({ message: "Route not found" });
// });

// // ✅ ERROR HANDLER
// app.use((err, req, res, next) => {
//   console.log('❌ Unhandled error:', err);
//   res.status(500).json({ 
//     message: "Internal server error",
//     error: err.message 
//   });
// });

// // ✅ START SERVER
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

// // ✅ GRACEFUL SHUTDOWN
// const gracefulShutdown = () => {
//   console.log("📛 Shutdown signal received");
  
//   // Close all socket connections
//   io.close(() => {
//     console.log("✅ Socket.IO closed");
//   });
  
//   // Close HTTP server
//   server.close(() => {
//     console.log("✅ HTTP server closed");
//     process.exit(0);
//   });
  
//   // Force exit after 10 seconds
//   setTimeout(() => {
//     console.log("⚠️ Force exit after timeout");
//     process.exit(1);
//   }, 10000);
// };

// process.on("SIGTERM", gracefulShutdown);
// process.on("SIGINT", gracefulShutdown);

// // ✅ UNHANDLED PROMISE REJECTION
// process.on("unhandledRejection", (reason, promise) => {
//   console.log("❌ Unhandled Rejection at:", promise, "reason:", reason);
// });

// // ✅ UNCAUGHT EXCEPTION
// process.on("uncaughtException", (error) => {
//   console.log("❌ Uncaught Exception:", error);
//   // Don't crash - log and continue
// });
