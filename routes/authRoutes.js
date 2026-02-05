const express = require("express");
const router = express.Router();
const { register, login } = require("../controllers/authController");
const auth = require("../middleware/authMiddleware");
// const { isAdmin } = require("../middleware/roleMiddleware");

router.post("/register", register);
router.post("/login", login);

// Protected route
router.get("/profile", auth, (req, res) => {
  res.json({ msg: "User profile", user: req.user });
});

// // Admin only
// router.get("/admin", auth, isAdmin, (req, res) => {
//   res.json({ msg: "Welcome Admin" });
// });

module.exports = router;
