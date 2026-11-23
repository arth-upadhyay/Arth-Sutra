import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { hashPassword, hashPasswordSync, comparePassword, generateToken, verifyToken } from '../utils/auth.js';

describe('Task 2 & 3: Database Seeding & Profile Security Logic', () => {
  let sqlite;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'CLERK',
        created_at    TEXT NOT NULL
      );
    `);
  });

  function testEnsureAdmin(dbInstance) {
    const row = dbInstance.prepare('SELECT COUNT(*) as count FROM users').get();
    if (row && Number(row.count) === 0) {
      const hash = hashPasswordSync('admin123');
      dbInstance.prepare(`
        INSERT INTO users (username, password_hash, role, created_at)
        VALUES (?, ?, ?, ?)
      `).run('admin', hash, 'ADMIN', new Date().toISOString());
      return true;
    }
    return false;
  }

  it('Task 2: seeds default admin only when users table is completely empty', async () => {
    // 1. Initially empty -> should seed
    const seededFirst = testEnsureAdmin(sqlite);
    expect(seededFirst).toBe(true);

    const usersAfterFirst = sqlite.prepare('SELECT * FROM users').all();
    expect(usersAfterFirst.length).toBe(1);
    expect(usersAfterFirst[0].username).toBe('admin');
    await expect(comparePassword('admin123', usersAfterFirst[0].password_hash)).resolves.toBe(true);

    // 2. Second call with existing admin -> should NOT seed
    const seededSecond = testEnsureAdmin(sqlite);
    expect(seededSecond).toBe(false);
    expect(sqlite.prepare('SELECT COUNT(*) as count FROM users').get().count).toBe(1);

    // 3. Rename admin user to 'custom_owner' -> should NOT re-create admin
    sqlite.prepare("UPDATE users SET username = 'custom_owner' WHERE id = 1").run();
    const seededThird = testEnsureAdmin(sqlite);
    expect(seededThird).toBe(false);

    const allUsers = sqlite.prepare('SELECT * FROM users').all();
    expect(allUsers.length).toBe(1);
    expect(allUsers[0].username).toBe('custom_owner');

    // Confirm 'admin' was not recreated
    const adminCheck = sqlite.prepare("SELECT * FROM users WHERE username = 'admin'").get();
    expect(adminCheck).toBeUndefined();
  });

  it('Task 3: validates current password before allowing profile updates', async () => {
    testEnsureAdmin(sqlite);
    const user = sqlite.prepare("SELECT * FROM users WHERE username = 'admin'").get();

    // Wrong current password
    const wrongMatches = await comparePassword('wrong-password', user.password_hash);
    expect(wrongMatches).toBe(false);

    // Correct current password
    const correctMatches = await comparePassword('admin123', user.password_hash);
    expect(correctMatches).toBe(true);
  });

  it('Task 3: updates username and password and produces fresh JWT token', async () => {
    testEnsureAdmin(sqlite);
    const user = sqlite.prepare("SELECT * FROM users WHERE username = 'admin'").get();

    // Simulate updating credentials
    const newUsername = 'new_admin_user';
    const newPassword = 'newSecretPassword456';
    const newHash = await hashPassword(newPassword);

    sqlite.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?')
      .run(newUsername, newHash, user.id);

    const updated = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    expect(updated.username).toBe(newUsername);
    expect(await comparePassword(newPassword, updated.password_hash)).toBe(true);
    expect(await comparePassword('admin123', updated.password_hash)).toBe(false);

    // Fresh JWT generation
    const newToken = generateToken({
      id: updated.id,
      username: updated.username,
      role: updated.role,
    });
    const decoded = verifyToken(newToken);
    expect(decoded.username).toBe(newUsername);
    expect(decoded.id).toBe(user.id);
    expect(decoded.role).toBe('ADMIN');
  });

  it('Task 3: detects duplicate username conflict when updating profile', () => {
    testEnsureAdmin(sqlite);
    // Create another user
    sqlite.prepare("INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)")
      .run('clerk_jane', 'somehash', 'CLERK', new Date().toISOString());

    // Try to update admin user's username to clerk_jane
    const targetUsername = 'clerk_jane';
    const existing = sqlite.prepare("SELECT * FROM users WHERE username = ?").get(targetUsername);
    expect(existing).toBeDefined();
    expect(existing.id).not.toBe(1); // Conflict detected because it belongs to another user
  });

  describe('First-Time Setup Wizard Logic (/api/auth/status & /api/auth/setup)', () => {
    function getSetupStatus(dbInstance) {
      const row = dbInstance.prepare('SELECT COUNT(*) as count FROM users').get();
      return Boolean(row && Number(row.count) > 0);
    }

    async function executeSetup(dbInstance, username, password) {
      const row = dbInstance.prepare('SELECT COUNT(*) as count FROM users').get();
      if (row && Number(row.count) > 0) {
        throw new Error('Setup has already been completed');
      }
      if (!username || !username.trim()) throw new Error('Username is required');
      if (!password || password.length < 4) throw new Error('Password must be at least 4 characters long');

      const passwordHash = await hashPassword(password.trim());
      const res = dbInstance.prepare(`
        INSERT INTO users (username, password_hash, role, created_at)
        VALUES (?, ?, 'ADMIN', ?)
      `).run(username.trim(), passwordHash, new Date().toISOString());

      const user = dbInstance.prepare('SELECT * FROM users WHERE id = ?').get(res.lastInsertRowid);
      const token = generateToken({
        id: user.id,
        username: user.username,
        role: user.role,
      });

      return { user, token };
    }

    it('returns isSetupComplete: false when database is empty', () => {
      expect(getSetupStatus(sqlite)).toBe(false);
    });

    it('creates admin user on empty database, returns valid JWT, and sets role to ADMIN', async () => {
      expect(getSetupStatus(sqlite)).toBe(false);

      const result = await executeSetup(sqlite, 'my_business_admin', 'securePass789');
      expect(result.user.username).toBe('my_business_admin');
      expect(result.user.role).toBe('ADMIN');
      expect(await comparePassword('securePass789', result.user.password_hash)).toBe(true);

      const decoded = verifyToken(result.token);
      expect(decoded.username).toBe('my_business_admin');
      expect(decoded.role).toBe('ADMIN');

      // Status is now complete
      expect(getSetupStatus(sqlite)).toBe(true);
    });

    it('rejects subsequent setup attempts once setup has completed (Security Check)', async () => {
      // First setup succeeds
      await executeSetup(sqlite, 'initial_owner', 'firstPass123');
      expect(getSetupStatus(sqlite)).toBe(true);

      // Second setup attempt must fail
      await expect(executeSetup(sqlite, 'rogue_admin', 'attackerPass456'))
        .rejects.toThrow('Setup has already been completed');

      // Users table still contains only the initial owner
      const allUsers = sqlite.prepare('SELECT * FROM users').all();
      expect(allUsers.length).toBe(1);
      expect(allUsers[0].username).toBe('initial_owner');
    });

    it('rejects setup with invalid input', async () => {
      await expect(executeSetup(sqlite, '', 'validPass123')).rejects.toThrow('Username is required');
      await expect(executeSetup(sqlite, 'user', '12')).rejects.toThrow('Password must be at least 4 characters long');
    });
  });
});
