// utils/auth.js
// ─────────────────────────────────────────────────────────────────────────────
// Authentication & RBAC Utility (bcrypt + jsonwebtoken)
// Roles: ADMIN, ACCOUNTANT, CLERK
// ─────────────────────────────────────────────────────────────────────────────

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'arthsutra-jwt-super-secret-key-change-in-production';
const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = '24h';

export const ROLES = {
  ADMIN: 'ADMIN',
  ACCOUNTANT: 'ACCOUNTANT',
  CLERK: 'CLERK',
};

/**
 * Hashes a plaintext password using bcrypt.
 */
export async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/**
 * Synchronous version of password hashing for scripts and seeds.
 */
export function hashPasswordSync(plainPassword) {
  return bcrypt.hashSync(plainPassword, SALT_ROUNDS);
}

/**
 * Compares plaintext password with bcrypt hash.
 */
export async function comparePassword(plainPassword, hash) {
  return bcrypt.compare(plainPassword, hash);
}

/**
 * Generates a signed JWT valid for 24h.
 */
export function generateToken(user) {
  const payload = {
    id: user.id,
    username: user.username,
    role: user.role || ROLES.CLERK,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

/**
 * Verifies a JWT and returns the decoded payload.
 * Throws an error if expired or invalid.
 */
export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
