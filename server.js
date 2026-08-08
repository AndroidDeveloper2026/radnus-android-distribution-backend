// server.js - COMPLETE FIXED VERSION

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

// ✅ DNS CONFIGURATION
dns.setServers(["1.1.1.1", "8.8.8.8"]);
dns.setDefaultResultOrder("ipv4first");

// ✅ CONNECT TO DATABASE
connectDB();

// ✅ CREATE EXPRESS APP
const app = express();

// ✅ MIDDLEWARE
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use("/uploads", express.static("uploads"));
app.use(cors({
  origin: "*",
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// ✅ REQUEST LOGGING
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('📦 Body:', JSON.stringify(req.body, null, 2));
  }
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

// ✅ START AUTO-END JOB
const startAutoEndJob = require("./cron/autoEndDay");
startAutoEndJob();

// ✅ CREATE HTTP SERVER
const server = http.createServer(app);

// ✅ SOCKET.IO WITH COMPLETE IMPLEMENTATION
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

// ✅ ATTACH IO TO REQUESTS
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ✅ SOCKET.IO CONNECTION - COMPLETE IMPLEMENTATION
io.on("connection", socket => {
  console.log(`📱 User connected: ${socket.id}`);
  
  // ✅ Track subscribed sessions per socket
  const subscribedSessions = new Set();
  let userLocation = null;

  // ✅ HANDLE SUBSCRIBE TO SESSION LOCATION UPDATES
  socket.on("subscribe-location", ({ sessionId }) => {
    if (!sessionId) {
      console.log(`⚠️ ${socket.id} subscribe-location called without sessionId`);
      return;
    }
    
    subscribedSessions.add(sessionId);
    socket.join(`session-${sessionId}`);
    console.log(`✅ Socket ${socket.id} subscribed to session ${sessionId}`);
    
    // ✅ Send last known location immediately if available
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

  // ✅ HANDLE UNSUBSCRIBE
  socket.on("unsubscribe-location", ({ sessionId }) => {
    if (!sessionId) return;
    subscribedSessions.delete(sessionId);
    socket.leave(`session-${sessionId}`);
    console.log(`✅ Socket ${socket.id} unsubscribed from session ${sessionId}`);
  });

  // ✅ RECEIVE LOCATION FROM MOBILE
  socket.on("send-location", async data => {
    try {
      const { sessionId, latitude, longitude, timestamp } = data;

      if (!sessionId || latitude === undefined || longitude === undefined) {
        console.log(`⚠️ ${socket.id} Invalid location data:`, data);
        return;
      }

      // ✅ Store last known location for this socket
      userLocation = { latitude, longitude, timestamp: timestamp || new Date() };

      console.log(`📍 Location received from ${socket.id} for session ${sessionId}: [${latitude.toFixed(6)}, ${longitude.toFixed(6)}]`);

      // ✅ Update session route
      try {
        const session = await Session.findByIdAndUpdate(
          sessionId,
          {
            $push: {
              route: {
                latitude,
                longitude,
                timestamp: timestamp || new Date()
              }
            }
          },
          { new: true }
        );

        if (!session) {
          console.log(`❌ Session not found: ${sessionId}`);
          return;
        }
        
        console.log(`✅ Session ${sessionId} updated - route length: ${session.route.length}`);
      } catch (dbErr) {
        console.log(`❌ Database error for session ${sessionId}:`, dbErr.message);
        // Don't fail - still broadcast the location
      }

      // ✅ BROADCAST TO ALL CLIENTS (global for backward compatibility)
      io.emit("users-location", {
        sessionId,
        latitude,
        longitude,
        timestamp: timestamp || new Date(),
        socketId: socket.id
      });

      // ✅ BROADCAST TO SESSION-SPECIFIC ROOM (targeted updates)
      io.to(`session-${sessionId}`).emit("session-location", {
        sessionId,
        latitude,
        longitude,
        timestamp: timestamp || new Date(),
        socketId: socket.id
      });

      console.log(`✅ Location broadcasted to ${subscribedSessions.size} subscribers`);

    } catch (err) {
      console.log(`❌ Socket location error from ${socket.id}:`, err.message);
    }
  });

  // ✅ HANDLE DISCONNECT
  socket.on("disconnect", (reason) => {
    console.log(`🔌 User disconnected: ${socket.id} (${reason})`);
    subscribedSessions.clear();
  });

  // ✅ ERROR HANDLING
  socket.on("error", (error) => {
    console.log(`❌ Socket error from ${socket.id}:`, error);
  });

  // ✅ PING/PONG for connection health
  socket.on("ping", () => {
    socket.emit("pong");
  });
});

// ✅ HEALTH CHECK ENDPOINT
app.get("/health", (req, res) => {
  res.json({ 
    status: "✅ Server is running",
    timestamp: new Date().toISOString(),
    port: process.env.PORT || 5000,
    socketConnections: io.engine.clientsCount || 0
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
  console.log(`
  ╔════════════════════════════════════════════════════════════╗
  ║  🚀 Server running on port ${PORT}                           ║
  ║  📡 Socket.IO: ws://0.0.0.0:${PORT}                         ║
  ║  🌐 Environment: ${process.env.NODE_ENV || 'development'}    ║
  ╚════════════════════════════════════════════════════════════╝
  `);
});

// ✅ GRACEFUL SHUTDOWN
const gracefulShutdown = () => {
  console.log("📛 Shutdown signal received");
  
  // Close all socket connections
  io.close(() => {
    console.log("✅ Socket.IO closed");
  });
  
  // Close HTTP server
  server.close(() => {
    console.log("✅ HTTP server closed");
    process.exit(0);
  });
  
  // Force exit after 10 seconds
  setTimeout(() => {
    console.log("⚠️ Force exit after timeout");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// ✅ UNHANDLED PROMISE REJECTION
process.on("unhandledRejection", (reason, promise) => {
  console.log("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

// ✅ UNCAUGHT EXCEPTION
process.on("uncaughtException", (error) => {
  console.log("❌ Uncaught Exception:", error);
  // Don't crash - log and continue
});

//+++++++++++++++++++++++++++++++++++++

// // const dotenv = require("dotenv");
// // dotenv.config({
// //   path: `.env.${process.env.NODE_ENV || "dev"}`,
// // });
// require("dotenv").config({
//   path: `.env.${process.env.NODE_ENV || "dev"}`,
// });
// const express = require("express");
// const connectDB = require("./config/db");
// const http = require("http");
// const socketIo = require("socket.io");
// const Session = require("./models/FSEModel/Session");
// const dns = require("dns");

// // ✅ DNS CONFIGURATION
// dns.setServers(["1.1.1.1", "8.8.8.8"]);
// dns.setDefaultResultOrder("ipv4first");

// // ✅ CONNECT TO DATABASE
// connectDB();

// // ✅ CREATE EXPRESS APP FIRST (BEFORE ANY MIDDLEWARE)
// const app = express();

// // ✅ MIDDLEWARE - PARSE REQUESTS
// app.use(express.json({ limit: '50mb' }));
// app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// // ✅ STATIC FILES
// app.use("/uploads", express.static("uploads"));

// // ✅ CORS MIDDLEWARE (if needed for web clients)
// const cors = require("cors");
// app.use(cors({
//   origin: "*",
//   credentials: true,
//   methods: ["GET", "POST", "PUT", "DELETE"],
//   allowedHeaders: ["Content-Type", "Authorization"]
// }));

// // ✅ REQUEST LOGGING MIDDLEWARE
// app.use((req, res, next) => {
//   console.log(`📨 ${req.method} ${req.path}`);
//   console.log('📦 Body:', JSON.stringify(req.body, null, 2));
//   next();
// });

// // ✅ START AUTO-END JOB
// const startAutoEndJob = require("./cron/autoEndDay");
// startAutoEndJob();

// // ✅ API ROUTES
// console.log("🔗 Registering API routes...");
// app.use("/api/auth", require("./routes/authRoutes"));
// app.use('/api/admin', require('./routes/adminRoutes'));
// app.use("/api/products", require("./routes/productRoutes"));
// app.use("/api/territory", require("./routes/territoryRoutes"));
// app.use("/api/distributors", require("./routes/distributorRoutes"));
// app.use("/api/retailers", require("./routes/retailerRoute"));
// app.use("/api/fse", require("./routes/fseRoutes"));
// app.use("/api/session", require("./routes/sessionRoutes"));
// app.use("/api/location", require("./routes/locationRoutes"));
// app.use("/api/executives", require("./routes/executiveRoutes"));
// app.use("/api/managers", require("./routes/managerRoutes"));
// app.use("/api/customers",   require("./routes/customerRoutes"));
// app.use("/api/invoices", require("./routes/invoiceRoutes"));
// app.use('/api/feedback', require("./routes/feedbackroutes"));
// app.use("/api/activity-logs", require("./routes/activityLogRoutes"));
// app.use("/api/profile", require("./routes/profileRoutes"));
// app.use("/api/sales-returns", require("./routes/salesReturnRoutes"));
// app.use("/api/purchase-returns", require("./routes/purchaseReturnRoutes"));
// console.log("✅ All routes registered");

// // ✅ CREATE HTTP SERVER & ATTACH SOCKET.IO
// const server = http.createServer(app);

// const io = socketIo(server, {
//   cors: {
//     origin: "*",
//     methods: ["GET", "POST", "OPTIONS"],
//     credentials: true
//   },
//   transports: ['websocket', 'polling']
// });

// // ✅ ATTACH IO TO REQUESTS
// app.use((req, res, next) => {
//   req.io = io;
//   next();
// });

// // ✅ SOCKET.IO CONNECTION & REAL-TIME TRACKING
// io.on("connection", socket => {
//   console.log(`📱 User connected: ${socket.id}`);

//   // ✅ RECEIVE LOCATION FROM MOBILE
//   socket.on("send-location", async data => {
//     try {
//       const { sessionId, latitude, longitude } = data;

//       if (!sessionId || latitude === undefined || longitude === undefined) {
//         console.log('⚠️ Invalid location data:', data);
//         return;
//       }

//       console.log(`📍 Location received for session ${sessionId}: [${latitude.toFixed(4)}, ${longitude.toFixed(4)}]`);

//       // ✅ Update session route with new location
//       const session = await Session.findByIdAndUpdate(
//         sessionId,
//         {
//           $push: {
//             route: {
//               latitude,
//               longitude,
//               timestamp: new Date()
//             }
//           }
//         },
//         { new: true }
//       );

//       if (!session) {
//         console.log('❌ Session not found:', sessionId);
//         return;
//       }

//       // ✅ BROADCAST LOCATION TO ALL CONNECTED CLIENTS
//       io.emit("users-location", {
//         sessionId,
//         latitude,
//         longitude,
//         timestamp: new Date()
//       });

//       console.log(`✅ Location broadcasted`);

//     } catch (err) {
//       console.log('❌ Socket location error:', err.message);
//     }
//   });

//   // ✅ HANDLE DISCONNECT
//   socket.on("disconnect", () => {
//     console.log(`🔌 User disconnected: ${socket.id}`);
//   });

//   // ✅ ERROR HANDLING
//   socket.on("error", (error) => {
//     console.log(`❌ Socket error: ${error}`);
//   });
// });

// // ✅ HEALTH CHECK ENDPOINT
// app.get("/health", (req, res) => {
//   res.json({ 
//     status: "✅ Server is running",
//     timestamp: new Date().toISOString(),
//     port: process.env.PORT || 5000
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
//   console.log("NODE_ENV:", process.env.NODE_ENV);
//   console.log(`
//  Server running on port ${PORT} ║ Listening on 0.0.0.0:${PORT}`);
// });

// // ✅ GRACEFUL SHUTDOWN
// process.on("SIGTERM", () => {
//   console.log("📛 SIGTERM signal received");
//   server.close(() => {
//     console.log("✅ Server closed gracefully");
//     process.exit(0);
//   });
// });

// process.on("SIGINT", () => {
//   console.log("📛 SIGINT signal received");
//   server.close(() => {
//     console.log("✅ Server closed gracefully");
//     process.exit(0);
//   });
// });

// // ✅ UNHANDLED PROMISE REJECTION
// process.on("unhandledRejection", (reason, promise) => {
//   console.log("❌ Unhandled Rejection at:", promise, "reason:", reason);
// });