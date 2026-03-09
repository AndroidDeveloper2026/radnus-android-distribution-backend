
const router = require("express").Router();
const upload = require("../middleware/uploadMemory");
const {
  createManager,
  getManagers,
  updateManager,
  deleteManager,
} = require("../controllers/managerController.js");

router.post("/", upload.single("photo"), createManager);
router.get("/", getManagers);
router.put("/:id", updateManager);
router.delete("/:id", deleteManager);

module.exports = router;