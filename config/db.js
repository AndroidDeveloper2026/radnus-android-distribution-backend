const mongoose = require("mongoose");

const connectDB = async () => {
   console.log('MONGO_URI:', process.env.MONGO_URI);
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB connected (${process.env.NODE_ENV})`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
