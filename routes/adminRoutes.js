const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbRun } = require('../database');
const { authenticateUser, requireAdmin } = require('../middleware/auth');
const ApiProviderService = require('../services/apiProvider');

// Protect all admin routes
router.use(authenticateUser, requireAdmin);

// Dashboard Overview Stats
router.get('/stats', async (req, res) => {
  try {
    const totalUsersRow = await dbGet('SELECT COUNT(*) AS count FROM users WHERE role = "customer"');
    const totalOrdersRow = await dbGet('SELECT COUNT(*) AS count FROM orders');
    const totalServicesRow = await dbGet('SELECT COUNT(*) AS count FROM services WHERE is_active = 1');
    const pendingDepositsRow = await dbGet('SELECT COUNT(*) AS count FROM deposits WHERE status = "Pending"');
    const totalRevenueRow = await dbGet('SELECT SUM(amount) AS total FROM deposits WHERE status = "Approved"');

    res.json({
      success: true,
      stats: {
        total_users: totalUsersRow ? totalUsersRow.count : 0,
        total_orders: totalOrdersRow ? totalOrdersRow.count : 0,
        total_services: totalServicesRow ? totalServicesRow.count : 0,
        pending_deposits: pendingDepositsRow ? pendingDepositsRow.count : 0,
        total_revenue: totalRevenueRow && totalRevenueRow.total ? parseFloat(totalRevenueRow.total.toFixed(2)) : 0
      }
    });
  } catch (err) {
    console.error('Error fetching admin stats:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch admin stats.' });
  }
});

// --- PROVIDERS MANAGEMENT ---

// List Providers
router.get('/providers', async (req, res) => {
  try {
    const providers = await dbAll('SELECT * FROM providers ORDER BY id DESC');
    res.json({ success: true, providers });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to list providers.' });
  }
});

// Add Provider
router.post('/providers', async (req, res) => {
  try {
    const { name, api_url, api_key } = req.body;
    if (!name || !api_url || !api_key) {
      return res.status(400).json({ success: false, message: 'Provider Name, API URL, and API Key are required.' });
    }

    const result = await dbRun(
      'INSERT INTO providers (name, api_url, api_key, status) VALUES (?, ?, ?, 1)',
      [name.trim(), api_url.trim(), api_key.trim()]
    );

    res.json({ success: true, message: 'API Provider added successfully!', provider_id: result.lastID });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to add provider.' });
  }
});

// Delete Provider
router.delete('/providers/:id', async (req, res) => {
  try {
    await dbRun('DELETE FROM providers WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Provider deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete provider.' });
  }
});

// Sync Services from Provider API
router.post('/providers/:id/sync', async (req, res) => {
  try {
    const provider = await dbGet('SELECT * FROM providers WHERE id = ?', [req.params.id]);
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider not found.' });
    }

    const externalServices = await ApiProviderService.fetchServices(provider.api_url, provider.api_key);
    let importedCount = 0;
    let updatedCount = 0;

    for (const ext of externalServices) {
      const origId = String(ext.service);
      const cat = ext.category || 'General';
      const name = ext.name || `Service ${origId}`;
      const origRate = parseFloat(ext.rate) || 0;
      const minQty = parseInt(ext.min) || 10;
      const maxQty = parseInt(ext.max) || 10000;

      // Default markup multiplier: 1.4 (+40% margin)
      const defaultCustomRate = parseFloat((origRate * 1.4).toFixed(2));

      const existing = await dbGet(
        'SELECT * FROM services WHERE provider_id = ? AND original_service_id = ?',
        [provider.id, origId]
      );

      if (existing) {
        await dbRun(
          `UPDATE services 
           SET category = ?, name = ?, original_rate = ?, min_quantity = ?, max_quantity = ? 
           WHERE id = ?`,
          [cat, name, origRate, minQty, maxQty, existing.id]
        );
        updatedCount++;
      } else {
        await dbRun(
          `INSERT INTO services (provider_id, original_service_id, category, name, original_rate, custom_rate, min_quantity, max_quantity, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [provider.id, origId, cat, name, origRate, defaultCustomRate, minQty, maxQty]
        );
        importedCount++;
      }
    }

    res.json({
      success: true,
      message: `Synced services successfully from ${provider.name}! (${importedCount} imported, ${updatedCount} updated)`
    });
  } catch (err) {
    console.error('Error syncing provider services:', err.message);
    res.status(500).json({ success: false, message: `Failed to sync services: ${err.message}` });
  }
});

// --- SERVICES & MARKUP MANAGEMENT ---

// List All Services (Admin view with original vs custom rates)
router.get('/services', async (req, res) => {
  try {
    const services = await dbAll(
      `SELECT s.*, p.name AS provider_name 
       FROM services s 
       LEFT JOIN providers p ON s.provider_id = p.id 
       ORDER BY s.category ASC, s.id ASC`
    );
    res.json({ success: true, services });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch services.' });
  }
});

// Update Service Custom Rate & Status
router.put('/services/:id', async (req, res) => {
  try {
    const { custom_rate, min_quantity, max_quantity, is_active, name } = req.body;

    const service = await dbGet('SELECT * FROM services WHERE id = ?', [req.params.id]);
    if (!service) {
      return res.status(404).json({ success: false, message: 'Service not found.' });
    }

    const newRate = custom_rate !== undefined ? parseFloat(custom_rate) : service.custom_rate;
    const newMin = min_quantity !== undefined ? parseInt(min_quantity) : service.min_quantity;
    const newMax = max_quantity !== undefined ? parseInt(max_quantity) : service.max_quantity;
    const newActive = is_active !== undefined ? (is_active ? 1 : 0) : service.is_active;
    const newName = name !== undefined ? name.trim() : service.name;

    await dbRun(
      `UPDATE services 
       SET custom_rate = ?, min_quantity = ?, max_quantity = ?, is_active = ?, name = ? 
       WHERE id = ?`,
      [newRate, newMin, newMax, newActive, newName, req.params.id]
    );

    res.json({ success: true, message: 'Service updated successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update service.' });
  }
});

// Bulk Markup Pricing Adjustment
router.post('/services/bulk-markup', async (req, res) => {
  try {
    const { percentage_markup } = req.body;
    const markupPct = parseFloat(percentage_markup);

    if (isNaN(markupPct)) {
      return res.status(400).json({ success: false, message: 'Valid percentage markup is required (e.g. 20 for +20%).' });
    }

    const services = await dbAll('SELECT id, original_rate FROM services');
    const multiplier = 1 + markupPct / 100;

    for (const s of services) {
      const newRate = parseFloat((s.original_rate * multiplier).toFixed(2));
      await dbRun('UPDATE services SET custom_rate = ? WHERE id = ?', [newRate, s.id]);
    }

    res.json({ success: true, message: `Applied ${markupPct}% markup to all services successfully!` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to apply bulk markup.' });
  }
});

// --- DEPOSITS & WALLET APPROVALS ---

// List Deposit Requests
router.get('/deposits', async (req, res) => {
  try {
    const deposits = await dbAll(
      `SELECT d.*, u.username, u.email 
       FROM deposits d 
       JOIN users u ON d.user_id = u.id 
       ORDER BY d.id DESC`
    );
    res.json({ success: true, deposits });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to list deposit requests.' });
  }
});

// Approve Deposit Request -> Adds money to user balance
router.put('/deposits/:id/approve', async (req, res) => {
  try {
    const deposit = await dbGet('SELECT * FROM deposits WHERE id = ?', [req.params.id]);
    if (!deposit) {
      return res.status(404).json({ success: false, message: 'Deposit request not found.' });
    }

    if (deposit.status !== 'Pending') {
      return res.status(400).json({ success: false, message: `Deposit is already ${deposit.status}.` });
    }

    // Add money to user balance
    const user = await dbGet('SELECT balance FROM users WHERE id = ?', [deposit.user_id]);
    const updatedBalance = parseFloat((user.balance + deposit.amount).toFixed(2));

    await dbRun('UPDATE users SET balance = ? WHERE id = ?', [updatedBalance, deposit.user_id]);
    await dbRun('UPDATE deposits SET status = "Approved" WHERE id = ?', [req.params.id]);

    res.json({
      success: true,
      message: `Deposit of ₹${deposit.amount} approved! User balance updated to ₹${updatedBalance}.`
    });
  } catch (err) {
    console.error('Approve deposit error:', err);
    res.status(500).json({ success: false, message: 'Failed to approve deposit.' });
  }
});

// Reject Deposit Request
router.put('/deposits/:id/reject', async (req, res) => {
  try {
    const deposit = await dbGet('SELECT * FROM deposits WHERE id = ?', [req.params.id]);
    if (!deposit) {
      return res.status(404).json({ success: false, message: 'Deposit request not found.' });
    }

    await dbRun('UPDATE deposits SET status = "Rejected" WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Deposit request rejected.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to reject deposit.' });
  }
});

// --- USER MANAGEMENT ---

// List Users
router.get('/users', async (req, res) => {
  try {
    const users = await dbAll('SELECT id, username, email, role, balance, created_at FROM users ORDER BY id DESC');
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to list users.' });
  }
});

// Manually Adjust User Balance
router.put('/users/:id/balance', async (req, res) => {
  try {
    const { amount, type } = req.body; // type: 'add' or 'set'
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const val = parseFloat(amount);
    if (isNaN(val)) {
      return res.status(400).json({ success: false, message: 'Valid amount is required.' });
    }

    let newBalance = user.balance;
    if (type === 'set') {
      newBalance = val;
    } else {
      newBalance = parseFloat((user.balance + val).toFixed(2));
    }

    if (newBalance < 0) newBalance = 0;

    await dbRun('UPDATE users SET balance = ? WHERE id = ?', [newBalance, req.params.id]);

    res.json({
      success: true,
      message: `Updated ${user.username}'s balance to ₹${newBalance}.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update user balance.' });
  }
});

// --- ORDERS MANAGEMENT ---

// List All Orders across system
router.get('/orders', async (req, res) => {
  try {
    const orders = await dbAll(
      `SELECT o.*, u.username, s.name AS service_name 
       FROM orders o 
       JOIN users u ON o.user_id = u.id 
       JOIN services s ON o.service_id = s.id 
       ORDER BY o.id DESC`
    );
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch orders.' });
  }
});

// Update Order Status
router.put('/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required.' });
    }

    await dbRun('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true, message: `Order status updated to '${status}'.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update order status.' });
  }
});

// --- SETTINGS MANAGEMENT ---

// Get & Update System Settings
router.get('/settings', async (req, res) => {
  try {
    const settingsRows = await dbAll('SELECT * FROM settings');
    const settings = {};
    settingsRows.forEach(r => settings[r.key] = r.value);
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch settings.' });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const { upi_id, upi_name, min_deposit, qr_code_url } = req.body;

    if (upi_id !== undefined) await dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES ("upi_id", ?)', [upi_id.trim()]);
    if (upi_name !== undefined) await dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES ("upi_name", ?)', [upi_name.trim()]);
    if (min_deposit !== undefined) await dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES ("min_deposit", ?)', [String(min_deposit)]);
    if (qr_code_url !== undefined) await dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES ("qr_code_url", ?)', [qr_code_url.trim()]);

    res.json({ success: true, message: 'Payment and site settings updated successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update settings.' });
  }
});

module.exports = router;
