const router = require("express").Router();
const FSE = require("../models/FSEModel/FSEDetails");

// CREATE
router.post("/", async (req, res) => {
  try {
    const fse = await FSE.create(req.body);
    res.json(fse);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET ALL
router.get("/", async (req, res) => {
  const data = await FSE.find().sort({ createdAt: -1 });
  res.json(data);
});

// GET ONE
router.get("/:id", async (req, res) => {
  const data = await FSE.findById(req.params.id);
  res.json(data);
});

// UPDATE
router.put("/:id", async (req, res) => {
  const updated = await FSE.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true }
  );
  res.json(updated);
});

// DELETE
router.delete("/:id", async (req, res) => {
  await FSE.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// APPROVE (Distributor)
router.patch("/approve/:id", async (req, res) => {
  const updated = await FSE.findByIdAndUpdate(
    req.params.id,
    { status: "APPROVED" },
    { new: true }
  );
  res.json(updated);
});

// REJECT (optional)
router.patch("/reject/:id", async (req, res) => {
  const updated = await FSE.findByIdAndUpdate(
    req.params.id,
    { status: "REJECTED" },
    { new: true }
  );
  res.json(updated);
});

module.exports = router;