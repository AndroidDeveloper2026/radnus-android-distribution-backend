// const Customer = require("../models/Customer/CustomerModel");

// // GET /api/customers — get all customers
// const getAllCustomers = async (req, res) => {
//   try {
//     const { search } = req.query;

//     const filter = search
//       ? {
//           $or: [
//             { name: { $regex: search, $options: "i" } },
//             { phone: { $regex: search, $options: "i" } },
//             { city: { $regex: search, $options: "i" } },
//           ],
//         }
//       : {};

//     const customers = await Customer.find(filter).sort({ createdAt: -1 });
//     res.status(200).json({ success: true, customers });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

// // GET /api/customers/:phone
// const getCustomerByPhone = async (req, res) => {
//   try {
//     const customer = await Customer.findOne({ phone: req.params.phone });
//     if (!customer) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Customer not found" });
//     }
//     res.status(200).json({ success: true, customer });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

// // POST /api/customers
// const addCustomer = async (req, res) => {
//   try {
//     const { phone, name, address, city, state } = req.body;
//     const existing = await Customer.findOne({ phone });
//     if (existing) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Customer already exists" });
//     }
//     const customer = await Customer.create({
//       phone,
//       name,
//       address,
//       city,
//       state,
//     });
//     res.status(201).json({ success: true, customer });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

// // PUT /api/customers/:phone
// const updateCustomer = async (req, res) => {
//   try {
//     const customer = await Customer.findOneAndUpdate(
//       { phone: req.params.phone },
//       req.body,
//       { new: true },
//     );
//     if (!customer) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Customer not found" });
//     }
//     res.status(200).json({ success: true, customer });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

// const deleteCustomer = async (req, res) => {
//   try {
//     const customer = await Customer.findOneAndDelete({ phone: req.params.phone });
//     if (!customer) {
//       return res.status(404).json({ success: false, message: "Customer not found" });
//     }
//     res.status(200).json({ success: true, message: "Customer deleted" });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

// module.exports = {
//   getCustomerByPhone,
//   addCustomer,
//   updateCustomer,
//   getAllCustomers,
//   deleteCustomer
// };


const Customer = require("../models/Customer/CustomerModel");

// GET ALL
const getAllCustomers = async (req, res) => {
  try {
    const { search } = req.query;

    const filter = search
      ? {
          $or: [
            { name: { $regex: search, $options: "i" } },
            { phone: { $regex: search, $options: "i" } },
            { city: { $regex: search, $options: "i" } },
            { shopName: { $regex: search, $options: "i" } }, // ✅ NEW
          ],
        }
      : {};

    const customers = await Customer.find(filter).sort({ createdAt: -1 });

    res.status(200).json({ success: true, customers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET BY PHONE
const getCustomerByPhone = async (req, res) => {
  try {
    const customer = await Customer.findOne({ phone: req.params.phone });

    if (!customer) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found" });
    }

    res.status(200).json({ success: true, customer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ADD CUSTOMER
const addCustomer = async (req, res) => {
  try {
    const {
      phone,
      name,
      address,
      city,
      state,
      type,
      shopName,
    } = req.body;

    const existing = await Customer.findOne({ phone });

    if (existing) {
      return res
        .status(400)
        .json({ success: false, message: "Customer already exists" });
    }

    const customer = await Customer.create({
      phone,
      name,
      address,
      city,
      state,
      type: type || "customer",
      shopName: type === "shop" ? shopName : "",
    });

    res.status(201).json({ success: true, customer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// UPDATE
const updateCustomer = async (req, res) => {
  try {
    const customer = await Customer.findOneAndUpdate(
      { phone: req.params.phone },
      req.body,
      { new: true }
    );

    if (!customer) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found" });
    }

    res.status(200).json({ success: true, customer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE
const deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findOneAndDelete({
      phone: req.params.phone,
    });

    if (!customer) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found" });
    }

    res.status(200).json({ success: true, message: "Customer deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getCustomerByPhone,
  addCustomer,
  updateCustomer,
  getAllCustomers,
  deleteCustomer,
};