const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const { initDatabase } = require('./database');

const authRoutes = require('./routes/authRoutes');
const customerRoutes = require('./routes/customerRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(session({
  secret: 'grow_your_page_session_secret_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

// Static Files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/admin', adminRoutes);

// Public Services Listing endpoint
const { dbAll } = require('./database');
app.get('/api/public/services', async (req, res) => {
  try {
    const services = await dbAll(
      `SELECT s.id, s.category, s.name, s.custom_rate AS rate, s.min_quantity, s.max_quantity 
       FROM services s 
       WHERE s.is_active = 1 
       ORDER BY s.category ASC, s.id ASC`
    );
    res.json({ success: true, services });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch services.' });
  }
});

// Fallback Page Routing
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/customer-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'customer-dashboard.html'));
});

app.get('/admin-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});

// Start Server
async function startServer() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`=====================================================`);
      console.log(`🚀 GROW YOUR PAGE - Social Media Growth Platform Running`);
      console.log(`🌐 Local URL: http://localhost:${PORT}`);
      console.log(`=====================================================`);
    });
  } catch (err) {
    console.error('Failed to start Grow Your Page server:', err);
    process.exit(1);
  }
}

startServer();
