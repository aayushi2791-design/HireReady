require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();

// ─── Security Middleware ───────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // allow inline scripts for frontend
}));

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts, please try again later.' },
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'API rate limit exceeded.' },
});

app.use('/api/', generalLimiter);
app.use('/api/auth/', authLimiter);
app.use('/api/interview/', apiLimiter);

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: function(origin, callback) {
    const allowed = [
      process.env.FRONTEND_URL || 'http://localhost:3000',
      'http://localhost:5000',
      'http://127.0.0.1:5500',
      'http://localhost:5500',
      // Allow file:// for local dev
      undefined
    ];
    if (!origin || allowed.includes(origin)) return callback(null, true);
    callback(null, true); // Allow all in dev; restrict in prod
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
if (process.env.NODE_ENV === 'development') app.use(morgan('dev'));

// ─── Serverless DB Connection Middleware ──────────────────────────────────────
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/hireready';
let cachedDbPromise = null;

const connectDB = async () => {
  if (mongoose.connection.readyState >= 1) {
    return mongoose.connection;
  }

  // Check if running on Vercel with a default localhost URI
  if (process.env.VERCEL && (MONGO_URI.includes('localhost') || MONGO_URI.includes('127.0.0.1'))) {
    throw new Error('MONGODB_URI is missing or pointing to localhost on Vercel. Please add a valid MongoDB Atlas connection string (mongodb+srv://...) in your Vercel Project Settings > Environment Variables.');
  }

  if (!cachedDbPromise) {
    cachedDbPromise = mongoose.connect(MONGO_URI, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000,
    }).then((m) => {
      console.log('✅ MongoDB connected');
      return m;
    }).catch((err) => {
      cachedDbPromise = null;
      console.error('❌ MongoDB connection error:', err.message);
      throw err;
    });
  }

  return cachedDbPromise;
};

// Middleware to ensure DB connection BEFORE any route executes
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('DB Middleware Error:', err.message);
    res.status(503).json({ error: err.message });
  }
});

// ─── Serve Frontend ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/users',      require('./routes/users'));
app.use('/api/interview',  require('./routes/interview'));
app.use('/api/evaluation', require('./routes/evaluation'));
app.use('/api/leaderboard',require('./routes/leaderboard'));
app.use('/api/resources',  require('./routes/resources'));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Serve Frontend SPA ───────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  const status = err.status || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ─── Start Server (Local Dev & Standalone) ────────────────────────────────────
const PORT = process.env.PORT || 5000;

if (require.main === module || !process.env.VERCEL) {
  connectDB().then(() => {
    app.listen(PORT, () => console.log(`🚀 HireReady server running on http://localhost:${PORT}`));
  });
}

module.exports = app;
