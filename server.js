const express = require("express");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const http = require("http");
const { Server } = require("socket.io");
const Location = require("./models/LocationModel/Location");
const dns = require("dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]);
dotenv.config({
    path:`.env.${process.env.NODE_ENV||'dev'}`
});
connectDB();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static("uploads"));

app.use("/api/auth",require("./routes/authRoutes"));
app.use("/api/auth", require('./routes/adminAuth'));


app.use("/api/products", require("./routes/productRoutes"));
app.use('/api/territory', require('./routes/territoryRoutes'));

app.use("/api/distributors",require("./routes/distributorRoutes"));
app.use("/api/location", require("./routes/locationRoutes"));

app.use("/api/retailers", require("./routes/retailerRoute"));
app.use("/api/fse", require("./routes/fseRoutes"));

// ✅ Create HTTP server
const server = http.createServer(app);

// ✅ Attach Socket.io
const io = new Server(server, {
  cors: { origin: "*" }
});

// 🔥 Store users (temporary or DB)
let users = {};

// ✅ Socket logic
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("send-location", async (data) => {
    const { userId, latitude, longitude } = data;

    // Save in memory
    users[userId] = { latitude, longitude };

    // 🔥 OPTIONAL: Save to DB
    // await LocationModel.findOneAndUpdate(
    //   { userId },
    //   { latitude, longitude, updatedAt: new Date() },
    //   { upsert: true }
    // );

    // Broadcast all users
    io.emit("users-location", users);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));


