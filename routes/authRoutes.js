const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { dbGet, dbRun } = require('../database');
const { authenticateUser, JWT_SECRET } = require('../middleware/auth');

// Register Customer
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: 'All fields (username, email, password) are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    // Check existing email or username
    const existingUser = await dbGet('SELECT * FROM users WHERE email = ? OR username = ?', [email, username]);
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Username or Email is already registered.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const apiKey = 'gyp_key_' + Math.random().toString(36).substring(2, 15);

    const result = await dbRun(
      'INSERT INTO users (username, email, password, role, balance, api_key) VALUES (?, ?, ?, ?, ?, ?)',
      [username.trim(), email.trim().toLowerCase(), hashedPassword, 'customer', 0.0, apiKey]
    );

    const newUser = await dbGet('SELECT id, username, email, role, balance FROM users WHERE id = ?', [result.lastID]);
    const token = jwt.sign({ id: newUser.id, role: newUser.role }, JWT_SECRET, { expiresIn: '7d' });

    if (req.session) {
      req.session.token = token;
    }

    res.json({
      success: true,
      message: 'Account registered successfully!',
      token,
      user: newUser
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const user = await dbGet('SELECT * FROM users WHERE email = ? OR username = ?', [email.trim().toLowerCase(), email.trim()]);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. User not found.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. Password incorrect.' });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    if (req.session) {
      req.session.token = token;
    }

    res.json({
      success: true,
      message: 'Logged in successfully!',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        balance: user.balance
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});

// Get Logged In User Info
router.get('/me', authenticateUser, async (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// Logout
router.post('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy();
  }
  res.json({ success: true, message: 'Logged out successfully.' });
});

module.exports = router;
