const express = require("express");
const router = express.Router();
const Territory = require("../models/TerritoryModel/Territory");

// ✅ GET - Full Tree Structure
router.get("/", async (req, res) => {
  try {
    const data = await Territory.find();

    const result = {};

    data.forEach((item) => {
      if (!result[item.state]) result[item.state] = {};
      if (!result[item.state][item.district])
        result[item.state][item.district] = [];

      result[item.state][item.district].push({
        taluk: item.taluk,
        beats: item.beats,
        assignedTo: item.assignedTo,
        active: item.active,
      });
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ ADD FULL TERRITORY (🔥 IMPORTANT)
router.post("/", async (req, res) => {
  try {
    const { state, district, taluk, beats, assignedTo } = req.body;

    if (!state || !district || !taluk) {
      return res.status(400).json({ msg: "Required fields missing" });
    }

    const exists = await Territory.findOne({
      state,
      district,
      taluk,
    });

    if (exists) {
      return res.status(400).json({ msg: "Territory already exists" });
    }

    const territory = await Territory.create({
      state,
      district,
      taluk,
      beats: beats || [],
      assignedTo: assignedTo || null,
      active: true,
    });

    res.json(territory);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ UPDATE TERRITORY
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const updated = await Territory.findByIdAndUpdate(
      id,
      {
        state: req.body.state,
        district: req.body.district,
        taluk: req.body.taluk,
        beats: req.body.beats || [],
        assignedTo: req.body.assignedTo || null,
        active: req.body.active ?? true,
      },
      { new: true },
    );

    if (!updated) {
      return res.status(404).json({ msg: "Territory not found" });
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE TALUK
router.delete('/taluk/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await Territory.findByIdAndDelete(id);

    res.json({ msg: 'Taluk deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE DISTRICT
router.delete('/district', async (req, res) => {
  try {
    const { state, district } = req.body;

    await Territory.deleteMany({ state, district });

    res.json({ msg: 'District deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE STATE
router.delete('/state', async (req, res) => {
  try {
    const { state } = req.body;

    await Territory.deleteMany({ state });

    res.json({ msg: 'State deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// // ✅ ADD DISTRICT
// router.post('/district', async (req, res) => {
//   const { state, district } = req.body;

//   try {
//     const exists = await Territory.findOne({ state, district });

//     if (exists) {
//       return res.status(400).json({ msg: 'District exists' });
//     }

//     await Territory.create({
//       state,
//       district,
//       taluk: null,
//       beats: [],
//     });

//     res.json({ msg: 'District added' });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // ✅ ADD TALUK
// router.post('/taluk', async (req, res) => {
//   const { state, district, taluk } = req.body;

//   try {
//     const exists = await Territory.findOne({ state, district, taluk });

//     if (exists) {
//       return res.status(400).json({ msg: 'Taluk exists' });
//     }

//     await Territory.create({
//       state,
//       district,
//       taluk,
//       beats: [],
//     });

//     res.json({ msg: 'Taluk added' });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

module.exports = router;
