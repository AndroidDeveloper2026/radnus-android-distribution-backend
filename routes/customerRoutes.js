const express = require("express");
const router = express.Router();
const {
  getCustomerByPhone,
  addCustomer,
  updateCustomer,
  getAllCustomers,
} = require("../controllers/customerController");

router.get("/", getAllCustomers);
router.get("/:phone", getCustomerByPhone);
router.post("/", addCustomer);
router.put("/:phone", updateCustomer);

module.exports = router;
