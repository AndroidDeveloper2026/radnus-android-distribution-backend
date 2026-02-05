const express = require("express");
const dotenv = require("dotenv");
const connectDB = require("./config/db");

dotenv.config({
    path:`.env.${process.env.NODE_ENV||'dev'}`
});
connectDB();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/auth",require("./routes/authRoutes"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));