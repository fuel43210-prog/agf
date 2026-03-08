// Authentication and Authorization Middleware
// Provides server-side auth checks for API endpoints

const crypto = require('crypto');

const DEFAULT_JWT_SECRET = 'your-secret-key-change-in-production';
const NODE_ENV = process.env.NODE_ENV || 'development';
let warnedInsecureSecret = false;

function resolveJwtSecret() {
  const jwtSecretFromEnv = String(process.env.JWT_SECRET || '').trim();
  console.log("[Auth-Middleware] JWT_SECRET state:", jwtSecretFromEnv ? "SET" : "MISSING");
  const jwtSecretIsInsecure = !jwtSecretFromEnv || jwtSecretFromEnv === DEFAULT_JWT_SECRET;

  if (jwtSecretIsInsecure && NODE_ENV === 'production') {
    console.error(`[Auth-Middleware] Critical: JWT_SECRET is ${!jwtSecretFromEnv ? 'missing/empty' : 'set to default insecure value'} in production environment.`);
    throw new Error('JWT_SECRET is missing or insecure in production. Set a strong JWT_SECRET env var.');
  }

  if (jwtSecretIsInsecure && NODE_ENV !== 'production' && !warnedInsecureSecret) {
    warnedInsecureSecret = true;
    console.warn('JWT_SECRET is missing/insecure for development. Set JWT_SECRET to avoid weak local tokens.');
  }

  return jwtSecretFromEnv || DEFAULT_JWT_SECRET;
}

const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY || '7d';

/**
 * Parses an expiry string (e.g., '7d', '1h', '30m') and returns a UNIX timestamp.
 * @param {string} expiryString - The string to parse.
 * @returns {number} The future expiration timestamp in seconds.
 */
function getExpiryTimestamp(expiryString) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const defaultExpirySeconds = 7 * 24 * 60 * 60; // 7 days

  if (typeof expiryString !== 'string' || !expiryString) {
    return nowSeconds + defaultExpirySeconds;
  }

  const unit = expiryString.slice(-1);
  const value = parseInt(expiryString.slice(0, -1), 10);

  if (isNaN(value)) {
    return nowSeconds + defaultExpirySeconds;
  }

  switch (unit) {
    case 'm': return nowSeconds + value * 60;
    case 'h': return nowSeconds + value * 3600;
    case 'd': return nowSeconds + value * 86400;
    default: return nowSeconds + defaultExpirySeconds;
  }
}

function base64UrlEncode(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return Buffer.from(str, 'base64').toString();
}

/**
 * Generate JWT token for user
 * @param {Object} user - User object with id and role
 * @returns {string} JWT token
 */
function generateToken(user) {
  const jwtSecret = resolveJwtSecret();
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
    iat: Math.floor(Date.now() / 1000),
    exp: getExpiryTimestamp(TOKEN_EXPIRY)
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));

  const signature = crypto
    .createHmac('sha256', jwtSecret)
    .update(encodedHeader + '.' + encodedPayload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verify JWT token
 * @param {string} token - JWT token
 * @returns {Object|null} Decoded token or null if invalid
 */
function verifyToken(token) {
  if (!token) return null;
  let jwtSecret;
  try {
    jwtSecret = resolveJwtSecret();
  } catch {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;

  const expectedSignature = crypto
    .createHmac('sha256', jwtSecret)
    .update(encodedHeader + '.' + encodedPayload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  if (signature !== expectedSignature) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch (err) {
    return null;
  }
}

/**
 * Extract token from request headers
 * @param {Object} request - Next.js request object
 * @returns {string|null} Token or null
 */
function extractToken(request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Middleware to verify authentication
 * @param {Object} request - Next.js request object
 * @returns {Object|null} Decoded token with user info or null if invalid
 */
function requireAuth(request) {
  const token = extractToken(request);
  const decoded = verifyToken(token);

  if (!decoded) {
    return null;
  }

  return decoded;
}

/**
 * Middleware to verify specific role
 * @param {Object} request - Next.js request object
 * @param {string|Array} requiredRole - Required role(s)
 * @returns {Object|null} Decoded token or null if not authorized
 */
function requireRole(request, requiredRole) {
  const auth = requireAuth(request);

  if (!auth) {
    return null;
  }

  const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
  if (!roles.includes(auth.role)) {
    return null;
  }

  return auth;
}

/**
 * Middleware specifically for fuel station role
 * @param {Object} request - Next.js request object
 * @returns {Object|null} Decoded token or null if not a fuel station
 */
function requireFuelStation(request) {
  return requireRole(request, 'Fuel_Station');
}

/**
 * Middleware specifically for admin role
 * @param {Object} request - Next.js request object
 * @returns {Object|null} Decoded token or null if not an admin
 */
function requireAdmin(request) {
  return requireRole(request, 'Admin');
}

/**
 * Middleware specifically for worker role
 * @param {Object} request - Next.js request object
 * @returns {Object|null} Decoded token or null if not a worker
 */
function requireWorker(request) {
  return requireRole(request, 'Worker');
}

/**
 * Error response helper
 * @param {string} message - Error message
 * @param {number} status - HTTP status code
 * @returns {Object} Response object
 */
function errorResponse(message, status = 400) {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: { 'Content-Type': 'application/json' } }
  );
}

/**
 * Success response helper
 * @param {Object} data - Response data
 * @param {number} status - HTTP status code
 * @returns {Object} Response object
 */
function successResponse(data, status = 200) {
  return new Response(
    JSON.stringify({ success: true, ...data }),
    { status, headers: { 'Content-Type': 'application/json' } }
  );
}

module.exports = {
  generateToken,
  verifyToken,
  extractToken,
  requireAuth,
  requireRole,
  requireFuelStation,
  requireAdmin,
  requireWorker,
  errorResponse,
  successResponse,
  TOKEN_EXPIRY,
};
