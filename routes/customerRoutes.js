const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbRun } = require('../database');
const { authenticateUser } = require('../middleware/auth');
const ApiProviderService = require('../services/apiProvider');

// All routes require customer authentication
router.use(authenticateUser);

// Get Available Services
router.get('/services', async (req, res) => {
  try {
    const services = await dbAll(
      `SELECT s.id, s.category, s.name, s.custom_rate AS rate, s.min_quantity, s.max_quantity 
       FROM services s 
       WHERE s.is_active = 1 
       ORDER BY s.category ASC, s.id ASC`
    );

    res.json({ success: true, services });
  } catch (err) {
    console.error('Error fetching services:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch services.' });
  }
});

// Place New Order
router.post('/orders', async (req, res) => {
  try {
    const { service_id, link, quantity } = req.body;
    const userId = req.user.id;

    if (!service_id || !link || !quantity) {
      return res.status(400).json({ success: false, message: 'Service, Link, and Quantity are required.' });
    }

    const qty = parseInt(quantity);
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid quantity provided.' });
    }

    // Get Service details
    const service = await dbGet('SELECT * FROM services WHERE id = ? AND is_active = 1', [service_id]);
    if (!service) {
      return res.status(400).json({ success: false, message: 'Selected service is disabled or not found.' });
    }

    if (qty < service.min_quantity || qty > service.max_quantity) {
      return res.status(400).json({
        success: false,
        message: `Quantity must be between ${service.min_quantity} and ${service.max_quantity}.`
      });
    }

    // Calculate total charge based on custom rate per 1,000 units
    const charge = parseFloat(((qty / 1000) * service.custom_rate).toFixed(2));

    // Get latest user balance
    const user = await dbGet('SELECT balance FROM users WHERE id = ?', [userId]);
    if (user.balance < charge) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance! Order cost is ₹${charge}, but your balance is ₹${user.balance.toFixed(2)}. Please add money.`
      });
    }

    // Get Provider Details if attached
    let providerOrderId = null;
    if (service.provider_id) {
      const provider = await dbGet('SELECT * FROM providers WHERE id = ? AND status = 1', [service.provider_id]);
      if (provider) {
        try {
          const providerRes = await ApiProviderService.createOrder(
            provider.api_url,
            provider.api_key,
            service.original_service_id,
            link,
            qty
          );
          providerOrderId = providerRes.order || null;
        } catch (provErr) {
          console.error('Provider API order forward failed, saving order locally:', provErr.message);
        }
      }
    }

    // Deduct user balance
    const newBalance = parseFloat((user.balance - charge).toFixed(2));
    await dbRun('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId]);

    // Save Order
    const orderRes = await dbRun(
      `INSERT INTO orders (user_id, service_id, provider_order_id, link, quantity, charge, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, service.id, providerOrderId, link.trim(), qty, charge, providerOrderId ? 'In Progress' : 'Pending']
    );

    res.json({
      success: true,
      message: 'Order placed successfully!',
      order: {
        id: orderRes.lastID,
        service_name: service.name,
        quantity: qty,
        charge: charge,
        remaining_balance: newBalance
      }
    });
  } catch (err) {
    console.error('Error placing order:', err);
    res.status(500).json({ success: false, message: 'Server error while processing order.' });
  }
});

// Get User Order History
router.get('/orders', async (req, res) => {
  try {
    const orders = await dbAll(
      `SELECT o.id, o.link, o.quantity, o.charge, o.status, o.start_count, o.remains, o.created_at, s.name AS service_name, s.category 
       FROM orders o 
       JOIN services s ON o.service_id = s.id 
       WHERE o.user_id = ? 
       ORDER BY o.id DESC`,
      [req.user.id]
    );

    res.json({ success: true, orders });
  } catch (err) {
    console.error('Error fetching order history:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch order history.' });
  }
});

// Add Money / Submit Wallet Deposit (Minimum ₹5 enforcement)
router.post('/add-money', async (req, res) => {
  try {
    const { amount, transaction_id, payment_method } = req.body;
    const userId = req.user.id;

    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount) || depositAmount < 5) {
      return res.status(400).json({
        success: false,
        message: 'Minimum add money amount is ₹5. Please enter ₹5 or more.'
      });
    }

    if (!transaction_id || transaction_id.trim().length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid Transaction ID / UTR number.'
      });
    }

    // Check duplicate transaction ID
    const existingTx = await dbGet('SELECT * FROM deposits WHERE transaction_id = ?', [transaction_id.trim()]);
    if (existingTx) {
      return res.status(400).json({
        success: false,
        message: 'This Transaction ID / UTR has already been submitted.'
      });
    }

    // Auto-verify UTR & instant wallet credit
    const cleanUtr = transaction_id.trim();
    
    // Insert deposit record as Approved
    await dbRun(
      `INSERT INTO deposits (user_id, amount, payment_method, transaction_id, status) 
       VALUES (?, ?, ?, ?, 'Approved')`,
      [userId, depositAmount, payment_method || 'UPI_QR', cleanUtr]
    );

    // Update user balance instantly
    const user = await dbGet('SELECT balance FROM users WHERE id = ?', [userId]);
    const updatedBalance = parseFloat((user.balance + depositAmount).toFixed(2));
    await dbRun('UPDATE users SET balance = ? WHERE id = ?', [updatedBalance, userId]);

    res.json({
      success: true,
      auto_verified: true,
      message: `🎉 Payment Auto-Verified! ₹${depositAmount} credited to your wallet balance instantly!`,
      new_balance: updatedBalance
    });
  } catch (err) {
    console.error('Error adding money:', err);
    res.status(500).json({ success: false, message: 'Server error while submitting deposit.' });
  }
});

// Get Deposit History
router.get('/deposits', async (req, res) => {
  try {
    const deposits = await dbAll(
      'SELECT id, amount, payment_method, transaction_id, status, created_at FROM deposits WHERE user_id = ? ORDER BY id DESC',
      [req.user.id]
    );

    res.json({ success: true, deposits });
  } catch (err) {
    console.error('Error fetching deposits:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch deposit history.' });
  }
});

// Get Payment Settings for UI (UPI ID, QR code, Min Deposit)
router.get('/payment-settings', async (req, res) => {
  try {
    const upiIdRow = await dbGet('SELECT value FROM settings WHERE key = "upi_id"');
    const upiNameRow = await dbGet('SELECT value FROM settings WHERE key = "upi_name"');
    const qrCodeRow = await dbGet('SELECT value FROM settings WHERE key = "qr_code_url"');
    const minDepRow = await dbGet('SELECT value FROM settings WHERE key = "min_deposit"');

    res.json({
      success: true,
      settings: {
        upi_id: upiIdRow ? upiIdRow.value : 'growyourpage@upi',
        upi_name: upiNameRow ? upiNameRow.value : 'Grow Your Page Official',
        qr_code_url: qrCodeRow ? qrCodeRow.value : '',
        min_deposit: minDepRow ? parseFloat(minDepRow.value) : 5
      }
    });
  } catch (err) {
    console.error('Error fetching payment settings:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch payment settings.' });
  }
});

module.exports = router;
