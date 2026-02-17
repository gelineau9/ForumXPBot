import initSqlJs from 'sql.js';
import configData from './config.json' with { type: 'json' };
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, 'xp.db');

let db;

export async function initDatabase() {
  const SQL = await initSqlJs();
  
  // Load existing database or create new one
  try {
    const filebuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(filebuffer);
    console.log('✅ Loaded existing database from', DB_PATH);
  } catch (err) {
    // Database doesn't exist, create new one
    db = new SQL.Database();
    console.log('✅ Created new database at', DB_PATH);
  }

  // Create users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      current_xp INTEGER DEFAULT 0,
      current_level INTEGER DEFAULT 0
    )
  `);

  // Save immediately after creation
  saveDatabase();

  console.log('✅ Database initialized');
}

export function addXP(userId, amount) {
  // Get current user data
  const result = db.exec('SELECT * FROM users WHERE user_id = ?', [userId]);
  let user = null;
  
  if (result.length > 0 && result[0].values.length > 0) {
    const row = result[0].values[0];
    user = {
      user_id: row[0],
      current_xp: row[1],
      current_level: row[2]
    };
  }

  if (!user) {
    // Create new user
    db.run('INSERT INTO users (user_id, current_xp, current_level) VALUES (?, 0, 0)', [userId]);
    user = { user_id: userId, current_xp: 0, current_level: 0 };
  }

  let newXP = user.current_xp + amount;
  let newLevel = user.current_level;
  let leveledUp = false;

  // Check if user leveled up using cumulative thresholds
  const thresholds = configData.levelThresholds;
  
  // Find the highest level the user qualifies for
  const sortedLevels = Object.keys(thresholds).map(Number).sort((a, b) => a - b);
  
  for (const level of sortedLevels) {
    if (newXP >= thresholds[level] && level > newLevel) {
      newLevel = level;
      leveledUp = true;
    }
  }

  // Update user
  db.run('UPDATE users SET current_xp = ?, current_level = ? WHERE user_id = ?',
    [newXP, newLevel, userId]);

  // Save database to file
  saveDatabase();

  return {
    newXP,
    currentLevel: newLevel,
    leveledUp,
  };
}

export function removeXP(userId, amount) {
  // Get current user data
  const result = db.exec('SELECT * FROM users WHERE user_id = ?', [userId]);
  
  if (result.length === 0 || result[0].values.length === 0) {
    // User doesn't exist, nothing to remove
    return null;
  }

  const row = result[0].values[0];
  const user = {
    user_id: row[0],
    current_xp: row[1],
    current_level: row[2]
  };

  // Subtract XP, but don't go below 0
  let newXP = Math.max(0, user.current_xp - amount);

  // Update user (level stays the same - no de-leveling)
  db.run('UPDATE users SET current_xp = ? WHERE user_id = ?', [newXP, userId]);

  saveDatabase();

  return {
    newXP,
    currentLevel: user.current_level,
  };
}

export function setUserXP(userId, xpAmount) {
  // Calculate the correct level for this XP amount
  const thresholds = configData.levelThresholds;
  const sortedLevels = Object.keys(thresholds).map(Number).sort((a, b) => a - b);
  
  let newLevel = 0;
  for (const level of sortedLevels) {
    if (xpAmount >= thresholds[level]) {
      newLevel = level;
    }
  }

  // Check if user exists
  const result = db.exec('SELECT * FROM users WHERE user_id = ?', [userId]);
  
  if (result.length === 0 || result[0].values.length === 0) {
    // Create new user with specified XP and calculated level
    db.run('INSERT INTO users (user_id, current_xp, current_level) VALUES (?, ?, ?)', [userId, xpAmount, newLevel]);
  } else {
    // Update existing user
    db.run('UPDATE users SET current_xp = ?, current_level = ? WHERE user_id = ?', [xpAmount, newLevel, userId]);
  }

  saveDatabase();

  return {
    newXP: xpAmount,
    newLevel: newLevel,
  };
}

export function getUserLevel(userId) {
  const result = db.exec('SELECT * FROM users WHERE user_id = ?', [userId]);
  
  if (result.length === 0 || result[0].values.length === 0) {
    return { xp: 0, level: 0 };
  }

  const row = result[0].values[0];
  return {
    xp: row[1],
    level: row[2],
  };
}

export function setUserLevel(userId, level) {
  // Check if user exists
  const result = db.exec('SELECT * FROM users WHERE user_id = ?', [userId]);
  
  // Get the XP threshold for this level (so they start at the level's minimum XP)
  const thresholds = configData.levelThresholds;
  const levelXP = thresholds[level] || 0;
  
  if (result.length === 0 || result[0].values.length === 0) {
    // Create new user if level is 1 or higher
    // Level 0 users should only be created through pin reactions (addXP)
    if (level >= 1) {
      db.run('INSERT INTO users (user_id, current_xp, current_level) VALUES (?, ?, ?)', [userId, levelXP, level]);
      saveDatabase();
      return {
        level,
        xp: levelXP,
      };
    } else {
      // Don't create entry for Level 0 role assignments
      return null;
    }
  } else {
    // Update existing user - set XP to level threshold and set new level
    db.run('UPDATE users SET current_xp = ?, current_level = ? WHERE user_id = ?', [levelXP, level, userId]);
    saveDatabase();
    return {
      level,
      xp: levelXP,
    };
  }
}

export function getNextLevelThreshold(currentLevel) {
  const nextLevel = currentLevel + 1;
  const thresholds = configData.levelThresholds;
  
  return thresholds[nextLevel] || null;
}

// Save database to file
function saveDatabase() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Graceful shutdown
process.on('SIGINT', () => {
  if (db) {
    saveDatabase();
    db.close();
  }
  process.exit(0);
});
