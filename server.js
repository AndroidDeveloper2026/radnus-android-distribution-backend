const dotenv = require("dotenv");
dotenv.config({
  path: `.env.${process.env.NODE_ENV || "dev"}`,
});
const express = require("express");
const connectDB = require("./config/db");
// const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const Location = require("./models/LocationModel/Location");
const app = express();
const dns = require("dns");

dns.setServers(["1.1.1.1", "8.8.8.8"]);
dns.setDefaultResultOrder("ipv4first");

connectDB();

// app.use(cors());

const startAutoEndJob = require("./cron/autoEndDay");
startAutoEndJob();

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
app.use("/api/executives", require("./routes/executiveRoutes"));
app.use("/api/managers", require("./routes/managerRoutes"));
// ✅ Create HTTP server
const server = http.createServer(app);

// ✅ Attach Socket.io
const io = new Server(server, {
  cors: { origin: "*" },
});

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("send-location", (data) => {
    console.log("Location from mobile:", data);

    io.emit("users-location", data);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
