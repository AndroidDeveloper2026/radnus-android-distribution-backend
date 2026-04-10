// const router = require("express").Router();
// const upload = require("../middleware/uploadMemory");
// const uploadToCloudinary = require("../utils/cloudinaryUpload");
// const FSE = require("../models/FSEModel/FSEDetails");

// // CREATE
// // router.post("/", async (req, res) => {
// //   try {
// //     const fse = await FSE.create(req.body);
// //     res.json(fse);
// //   } catch (err) {
// //     res.status(500).json({ error: err.message });
// //   }
// // });



// router.post("/", upload.single("photo"), async (req, res) => {
//   try {
//     let photoUrl = null;

//     if (req.file) {
//       const result = await uploadToCloudinary(req.file.buffer, "fse");
//       photoUrl = result.secure_url; // ✅ Cloudinary URL
//     }

//     const fse = new FSE({
//       ...req.body,
//       photo: photoUrl,
//     });

//     await fse.save();

//     res.json(fse);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Error creating FSE" });
//   }
// });

// // GET ALL
// router.get("/", async (req, res) => {
//   const data = await FSE.find().sort({ createdAt: -1 });
//   res.json(data);
// });

// // GET ONE
// router.get("/:id", async (req, res) => {
//   const data = await FSE.findById(req.params.id);
//   res.json(data);
// });

// // UPDATE
// router.put("/:id", async (req, res) => {
//   const updated = await FSE.findByIdAndUpdate(
//     req.params.id,
//     req.body,
//     { new: true }
//   );
//   res.json(updated);
// });

// // DELETE
// router.delete("/:id", async (req, res) => {
//   await FSE.findByIdAndDelete(req.params.id);
//   res.json({ success: true });
// });

// // APPROVE (Distributor)
// router.patch("/approve/:id", async (req, res) => {
//   const updated = await FSE.findByIdAndUpdate(
//     req.params.id,
//     { status: "APPROVED" },
//     { new: true }
//   );
//   res.json(updated);
// });

// // REJECT (optional)
// router.patch("/reject/:id", async (req, res) => {
//   const updated = await FSE.findByIdAndUpdate(
//     req.params.id,
//     { status: "REJECTED" },
//     { new: true }
//   );
//   res.json(updated);
// });

// module.exports = router;

const router = require('express').Router();
const upload = require('../middleware/uploadMemory');
const uploadToCloudinary = require('../utils/cloudinaryUpload');
const FSE = require('../models/FSEModel/FSEDetails');

// ─── CREATE ───────────────────────────────────────────────────────────────────
router.post('/', upload.single('photo'), async (req, res) => {
  try {
    let photoUrl = null;

    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer, 'fse');
      photoUrl = result.secure_url;
    }

    const fse = new FSE({
      ...req.body,
      photo: photoUrl,
    });

    await fse.save();
    res.json(fse);
  } catch (err) {
    console.error('❌ Error creating FSE:', err);
    res.status(500).json({ message: 'Error creating FSE', error: err.message });
  }
});

// ─── GET ALL ──────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const data = await FSE.find().sort({ createdAt: -1 });
    res.json(data);
  } catch (err) {
    console.error('❌ Error fetching FSEs:', err);
    res.status(500).json({ message: 'Error fetching FSEs', error: err.message });
  }
});

// ─── GET ONE ──────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const data = await FSE.findById(req.params.id);
    if (!data) {
      return res.status(404).json({ message: 'FSE not found' });
    }
    res.json(data);
  } catch (err) {
    console.error('❌ Error fetching FSE:', err);
    res.status(500).json({ message: 'Error fetching FSE', error: err.message });
  }
});

// ─── UPDATE ───────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const updated = await FSE.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) {
      return res.status(404).json({ message: 'FSE not found' });
    }
    res.json(updated);
  } catch (err) {
    console.error('❌ Error updating FSE:', err);
    res.status(500).json({ message: 'Error updating FSE', error: err.message });
  }
});

// ─── DELETE ───────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await FSE.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'FSE not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error deleting FSE:', err);
    res.status(500).json({ message: 'Error deleting FSE', error: err.message });
  }
});

// ─── APPROVE ──────────────────────────────────────────────────────────────────
router.patch('/approve/:id', async (req, res) => {
  try {
    const updated = await FSE.findByIdAndUpdate(
      req.params.id,
      { status: 'APPROVED' },
      { new: true },
    );
    if (!updated) {
      return res.status(404).json({ message: 'FSE not found' });
    }
    res.json(updated);
  } catch (err) {
    console.error('❌ Error approving FSE:', err);
    res.status(500).json({ message: 'Error approving FSE', error: err.message });
  }
});

// ─── REJECT ───────────────────────────────────────────────────────────────────
router.patch('/reject/:id', async (req, res) => {
  try {
    const updated = await FSE.findByIdAndUpdate(
      req.params.id,
      { status: 'REJECTED' },
      { new: true },
    );
    if (!updated) {
      return res.status(404).json({ message: 'FSE not found' });
    }
    res.json(updated);
  } catch (err) {
    console.error('❌ Error rejecting FSE:', err);
    res.status(500).json({ message: 'Error rejecting FSE', error: err.message });
  }
});

module.exports = router;