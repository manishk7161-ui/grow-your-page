const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

// Helper wrapper for async database operations
const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Initialize Database Tables
async function initDatabase() {
  console.log('Initializing SQLite database at:', dbPath);

  // Users Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer',
      balance REAL NOT NULL DEFAULT 0.0,
      api_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Providers Table (External API Providers)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      api_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      status INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Services Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id INTEGER,
      original_service_id TEXT NOT NULL,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      original_rate REAL NOT NULL,
      custom_rate REAL NOT NULL,
      min_quantity INTEGER NOT NULL DEFAULT 10,
      max_quantity INTEGER NOT NULL DEFAULT 100000,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (provider_id) REFERENCES providers (id) ON DELETE CASCADE
    )
  `);

  // Orders Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      service_id INTEGER NOT NULL,
      provider_order_id TEXT,
      link TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      charge REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      start_count INTEGER DEFAULT 0,
      remains INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id),
      FOREIGN KEY (service_id) REFERENCES services (id)
    )
  `);

  // Deposits / Add Money Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT DEFAULT 'UPI_QR',
      transaction_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);

  // System Settings Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Seed default settings
  const defaultSettings = [
    { key: 'site_name', value: 'Grow Your Page' },
    { key: 'min_deposit', value: '5' },
    { key: 'upi_id', value: 'growyourpage@upi' },
    { key: 'upi_name', value: 'Grow Your Page Official' },
    { key: 'qr_code_url', value: 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=upi://pay?pa=growyourpage@upi&pn=Grow%20Your%20Page' }
  ];

  for (const s of defaultSettings) {
    const existing = await dbGet('SELECT * FROM settings WHERE key = ?', [s.key]);
    if (!existing) {
      await dbRun('INSERT INTO settings (key, value) VALUES (?, ?)', [s.key, s.value]);
    }
  }

  // Seed Default Admin User if not exists
  const adminUser = await dbGet('SELECT * FROM users WHERE role = "admin" LIMIT 1');
  if (!adminUser) {
    const hashedPassword = await bcrypt.hash('Admin@123456', 10);
    await dbRun(
      'INSERT INTO users (username, email, password, role, balance, api_key) VALUES (?, ?, ?, ?, ?, ?)',
      ['admin', 'admin@growyourpage.com', hashedPassword, 'admin', 10000.0, 'admin_api_key_growyourpage']
    );
    console.log('Seeded default admin: admin@growyourpage.com / Admin@123456');
  }

  // Seed Default Sample Customer User if not exists
  const customerUser = await dbGet('SELECT * FROM users WHERE username = "demo_user"');
  if (!customerUser) {
    const hashedPassword = await bcrypt.hash('User@123456', 10);
    await dbRun(
      'INSERT INTO users (username, email, password, role, balance, api_key) VALUES (?, ?, ?, ?, ?, ?)',
      ['demo_user', 'user@growyourpage.com', hashedPassword, 'customer', 50.0, 'customer_demo_key']
    );
    console.log('Seeded demo customer: user@growyourpage.com / User@123456 (Balance: ₹50)');
  }

  // Seed a sample provider & services for quick testing
  const sampleProvider = await dbGet('SELECT * FROM providers WHERE name LIKE "%Provider%"');
  let providerId;
  if (!sampleProvider) {
    const res = await dbRun(
      'INSERT INTO providers (name, api_url, api_key, status) VALUES (?, ?, ?, ?)',
      ['Main API Provider', 'https://demo-panel-provider.com/api/v2', 'demo_secret_api_key_123', 1]
    );
    providerId = res.lastID;
  } else {
    providerId = sampleProvider.id;
  }

  const sampleService = await dbGet('SELECT * FROM services LIMIT 1');
  if (!sampleService) {
    const services = [
      {
        provider_id: providerId,
        original_service_id: '101',
        category: 'Instagram Followers',
        name: 'Instagram Real Followers [High Quality - Non Drop]',
        original_rate: 45.0,
        custom_rate: 65.0,
        min_quantity: 100,
        max_quantity: 50000
      },
      {
        provider_id: providerId,
        original_service_id: '102',
        category: 'Instagram Likes',
        name: 'Instagram Instant Likes [Fast Delivery]',
        original_rate: 15.0,
        custom_rate: 25.0,
        min_quantity: 50,
        max_quantity: 20000
      },
      {
        provider_id: providerId,
        original_service_id: '201',
        category: 'YouTube Views',
        name: 'YouTube High Retention Views [Monetizable]',
        original_rate: 110.0,
        custom_rate: 150.0,
        min_quantity: 500,
        max_quantity: 100000
      },
      {
        provider_id: providerId,
        original_service_id: '301',
        category: 'Telegram Members',
        name: 'Telegram Channel Members [Global Real]',
        original_rate: 35.0,
        custom_rate: 50.0,
        min_quantity: 100,
        max_quantity: 10000
      }
    ];

    for (const s of services) {
      await dbRun(
        `INSERT INTO services (provider_id, original_service_id, category, name, original_rate, custom_rate, min_quantity, max_quantity, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [s.provider_id, s.original_service_id, s.category, s.name, s.original_rate, s.custom_rate, s.min_quantity, s.max_quantity]
      );
    }
    console.log('Seeded sample services with custom rate markups.');
  }

  console.log('Database initialization completed.');
}

module.exports = {
  db,
  dbRun,
  dbGet,
  dbAll,
  initDatabase
};
