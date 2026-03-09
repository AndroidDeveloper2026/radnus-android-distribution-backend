const router = require("express").Router();
const upload = require("../middleware/uploadMemory");
const {
  createExecutive,
  getExecutives,
  updateExecutive,
  deleteExecutive,
} = require("../controllers/executiveController");

/* CREATE */

router.post("/", upload.single("photo"), createExecutive);

/* GET */

router.get("/", getExecutives);

/* UPDATE */

router.put("/:id", updateExecutive);

/* DELETE */

router.delete("/:id", deleteExecutive);

module.exports = router;
