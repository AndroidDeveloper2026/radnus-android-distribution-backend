const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const router = express.Router();

router.post('/admin', async (req, res) => {
  const { emailID, password } = req.body;

  // Validate input
  if (!emailID || !password) {
    return res.status(400).json({ message: 'Email and password required' });
  }

  // Check email
  if (emailID !== process.env.ADMIN_EMAIL) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  // Check password
  const isMatch = await bcrypt.compare(
    password,
    process.env.ADMIN_PASSWORD_HASH
  );

  if (!isMatch) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  // Generate token
  const token = jwt.sign(
    { role: 'Admin', email: emailID },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  return res.status(200).json({
    admin: {
      email: emailID,
      role: 'Admin',
    },
    token,
  });
});

module.exports = router;

