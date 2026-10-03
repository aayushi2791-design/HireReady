const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const User = require('../models/User');

let supabase;
if (
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_ANON_KEY &&
  process.env.SUPABASE_URL !== 'https://your-project.supabase.co'
) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

const protect = async (req, res, next) => {
  try {
    let token;

    // Check Authorization header or cookies
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({ error: 'Not authorized. Please log in.' });
    }

    // 1. Try Supabase Auth token validation if Supabase is configured
    if (supabase) {
      try {
        const { data: { user: sbUser }, error } = await supabase.auth.getUser(token);
        if (sbUser && !error) {
          let user = await User.findOne({
            $or: [{ supabaseId: sbUser.id }, { email: sbUser.email.toLowerCase() }]
          });

          if (!user) {
            user = await User.create({
              supabaseId: sbUser.id,
              email: sbUser.email.toLowerCase(),
              name: sbUser.user_metadata?.name || sbUser.user_metadata?.full_name || sbUser.email.split('@')[0],
              targetRole: sbUser.user_metadata?.targetRole || 'SDE',
            });
          } else if (!user.supabaseId) {
            user.supabaseId = sbUser.id;
            await user.save();
          }

          if (user.isLocked()) {
            return res.status(423).json({ error: 'Account temporarily locked.' });
          }

          req.user = user;
          return next();
        }
      } catch (sbErr) {
        // Fallback to legacy JWT verification if Supabase fails
      }
    }

    // 2. Legacy JWT verification fallback
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_for_dev');
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ error: 'User not found.' });
    }

    if (user.isLocked()) {
      return res.status(423).json({ error: 'Account temporarily locked.' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token.' });
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired. Please log in again.' });
    }
    next(err);
  }
};

const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin access required.' });
};

module.exports = { protect, adminOnly };
