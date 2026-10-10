import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import config from '../../config/config.js';

/**
 * Generates a short-lived Access Token for a user.
 * @param {Object} user - The user object containing payload details.
 * @param {string} user.id - The unique user ID.
 * @param {string} [user.email] - The user's email address.
 * @param {string} [user.role] - The user's role (e.g. USER, ADMIN).
 * @returns {string} The signed JWT access token.
 */
export const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      typ: 'access' // distinguishes a full session token from a two-factor challenge token
    },
    config.jwt.accessSecret,
    // Short-lived: a stolen access token is only useful briefly; the web app renews it with the refresh token
    { expiresIn: process.env.ACCESS_TOKEN_TTL || '15m' }
  );
};

/**
 * Generates a long-lived Refresh Token for a user.
 * @param {Object} user - The user object containing payload details.
 * @param {string} user.id - The unique user ID.
 * @returns {string} The signed JWT refresh token.
 */
export const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user.id },
    config.jwt.refreshSecret,
    // jwtid makes every token unique, even two issued for the same user in the same second
    { expiresIn: '14d', jwtid: crypto.randomUUID() } // Refresh token expires in 14 days
  );
};

/**
 * Short-lived token issued after the password step, when the account still has to pass
 * two-factor. It grants no access on its own: only the two-factor endpoint accepts it.
 * @param {Object} user
 * @returns {string}
 */
export const generateTwoFactorChallengeToken = (user) => {
  return jwt.sign(
    { id: user.id, typ: '2fa_challenge' },
    config.jwt.accessSecret,
    { expiresIn: process.env.TWO_FACTOR_CHALLENGE_TTL || '5m', jwtid: crypto.randomUUID() }
  );
};

/**
 * Verifies a two-factor challenge token and returns its payload.
 * @param {string} token
 */
export const verifyTwoFactorChallengeToken = (token) => {
  const decoded = jwt.verify(token, config.jwt.accessSecret, { algorithms: ['HS256'] });
  if (decoded.typ !== '2fa_challenge') {
    throw new Error('Not a two-factor challenge token');
  }
  return decoded;
};

/**
 * Verifies an Access Token.
 * @param {string} token - The token to verify.
 * @returns {Object} The decoded payload.
 */
export const verifyAccessToken = (token) => {
  return jwt.verify(token, config.jwt.accessSecret, { algorithms: ['HS256'] });
};

/**
 * Verifies a Refresh Token.
 * @param {string} token - The token to verify.
 * @returns {Object} The decoded payload.
 */
export const verifyRefreshToken = (token) => {
  return jwt.verify(token, config.jwt.refreshSecret, { algorithms: ['HS256'] });
};


// Function to extract token from the request headers
export const getTokenFromHeader = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  return null;
};

