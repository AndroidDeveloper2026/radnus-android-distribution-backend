const express = require('express');
const router = express.Router();
const Territory = require('../models/TerritoryModel/Territory');


// ✅ GET - Full Tree Structure
router.get('/', async (req, res) => {
  try {
    const data = await Territory.find();

    const result = {};

    data.forEach(item => {
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


// ✅ ADD DISTRICT
router.post('/district', async (req, res) => {
  const { state, district } = req.body;

  try {
    const exists = await Territory.findOne({ state, district });

    if (exists) {
      return res.status(400).json({ msg: 'District exists' });
    }

    await Territory.create({
      state,
      district,
      taluk: null,
      beats: [],
    });

    res.json({ msg: 'District added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ✅ ADD TALUK
router.post('/taluk', async (req, res) => {
  const { state, district, taluk } = req.body;

  try {
    const exists = await Territory.findOne({ state, district, taluk });

    if (exists) {
      return res.status(400).json({ msg: 'Taluk exists' });
    }

    await Territory.create({
      state,
      district,
      taluk,
      beats: [],
    });

    res.json({ msg: 'Taluk added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
