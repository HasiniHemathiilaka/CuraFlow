// middleware/auth.js
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || "curaflow_super_secure_secret_key";

// Authenticate token
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Expecting 'Bearer <TOKEN>'

  if (!token) return res.status(401).json({ error: "Access denied. Token missing." });

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified; // Attached user context ({ id, role })
    next();
  } catch (err) {
    res.status(403).json({ error: "Invalid or expired session token." });
  }
};

// Require specific role (e.g., 'DOCTOR', 'ADMIN')
const requireRole = (role) => {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: "Access forbidden: Unauthorized operational role." });
    }
    next();
  };
};

module.exports = { verifyToken, requireRole };