/**
 * ForumXPBot Test Suite
 * Run with: node test.js
 * 
 * Tests database functions and XP/level calculations
 * Uses a separate test database to avoid affecting production data
 */

import initSqlJs from 'sql.js';
import configData from './config.json' with { type: 'json' };

let db;
let passed = 0;
let failed = 0;

// Test helper functions
function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ ${testName}`);
    failed++;
  }
}

function assertEqual(actual, expected, testName) {
  if (actual === expected) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ ${testName} (expected: ${expected}, got: ${actual})`);
    failed++;
  }
}

// Database functions (copied logic for isolated testing)
function addXP(userId, amount) {
  const result = db.exec('SELECT * FROM users WHERE user_id = ?', [userId]);
  let user = null;
  
  if (result.length > 0 && result[0].values.length > 0) {
    const row = result[0].values[0];
    user = { user_id: row[0], current_xp: row[1], current_level: row[2] };
  }

  if (!user) {
    db.run('INSERT INTO users (user_id, current_xp, current_level) VALUES (?, 0, 0)', [userId]);
    user = { user_id: userId, current_xp: 0, current_level: 0 };
  }

  let newXP = user.current_xp + amount;
  let newLevel = user.current_level;
  let leveledUp = false;

  const thresholds = configData.levelThresholds;
  const sortedLevels = Object.keys(thresholds).map(Number).sort((a, b) => a - b);
  
  for (const level of sortedLevels) {
    if (newXP >= thresholds[level] && level > newLevel) {
      newLevel = level;
      leveledUp = true;
    }
  }

  db.run('UPDATE users SET current_xp = ?, current_level = ? WHERE user_id = ?', [newXP, newLevel, userId]);

  return { newXP, currentLevel: newLevel, leveledUp };
}

function removeXP(userId, amount) {
  const result = db.exec('SELECT * FROM users WHERE user_id = ?', [userId]);
  
  if (result.length === 0 || result[0].values.length === 0) {
    return null;
  }

  const row = result[0].values[0];
  const user = { user_id: row[0], current_xp: row[1], current_level: row[2] };

  let newXP = Math.max(0, user.current_xp - amount);
  db.run('UPDATE users SET current_xp = ? WHERE user_id = ?', [newXP, userId]);

  return { newXP, currentLevel: user.current_level };
}

function setUserXP(userId, xpAmount) {
  const thresholds = configData.levelThresholds;
  const sortedLevels = Object.keys(thresholds).map(Number).sort((a, b) => a - b);
  
  let newLevel = 0;
  for (const level of sortedLevels) {
    if (xpAmount >= thresholds[level]) {
      newLevel = level;
    }
  }

  const result = db.exec('SELECT * FROM users WHERE user_id = ?', [userId]);
  
  if (result.length === 0 || result[0].values.length === 0) {
    db.run('INSERT INTO users (user_id, current_xp, current_level) VALUES (?, ?, ?)', [userId, xpAmount, newLevel]);
  } else {
    db.run('UPDATE users SET current_xp = ?, current_level = ? WHERE user_id = ?', [xpAmount, newLevel, userId]);
  }

  return { newXP: xpAmount, newLevel };
}

function getUserLevel(userId) {
  const result = db.exec('SELECT * FROM users WHERE user_id = ?', [userId]);
  
  if (result.length === 0 || result[0].values.length === 0) {
    return { xp: 0, level: 0 };
  }

  const row = result[0].values[0];
  return { xp: row[1], level: row[2] };
}

function setUserLevel(userId, level) {
  const result = db.exec('SELECT * FROM users WHERE user_id = ?', [userId]);
  const thresholds = configData.levelThresholds;
  const levelXP = thresholds[level] || 0;
  
  if (result.length === 0 || result[0].values.length === 0) {
    if (level >= 1) {
      db.run('INSERT INTO users (user_id, current_xp, current_level) VALUES (?, ?, ?)', [userId, levelXP, level]);
      return { level, xp: levelXP };
    } else {
      return null;
    }
  } else {
    db.run('UPDATE users SET current_xp = ?, current_level = ? WHERE user_id = ?', [levelXP, level, userId]);
    return { level, xp: levelXP };
  }
}

function getNextLevelThreshold(currentLevel) {
  const nextLevel = currentLevel + 1;
  const thresholds = configData.levelThresholds;
  return thresholds[nextLevel] || null;
}

function resetDatabase() {
  db.run('DELETE FROM users');
}

// Test suites
async function runTests() {
  console.log('\n🧪 ForumXPBot Test Suite\n');
  console.log('Using thresholds:', configData.levelThresholds);
  console.log('');

  // Initialize in-memory database
  const SQL = await initSqlJs();
  db = new SQL.Database();
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      current_xp INTEGER DEFAULT 0,
      current_level INTEGER DEFAULT 0
    )
  `);

  // Test 1: Add XP to new user
  console.log('📋 Test: Add XP to new user');
  resetDatabase();
  const result1 = addXP('user1', 3);
  assertEqual(result1.newXP, 3, 'XP should be 3');
  assertEqual(result1.currentLevel, 0, 'Level should be 0 (below threshold)');
  assertEqual(result1.leveledUp, false, 'Should not level up');

  // Test 2: Add XP and level up
  console.log('\n📋 Test: Add XP and level up');
  resetDatabase();
  const result2 = addXP('user2', 5);
  assertEqual(result2.newXP, 5, 'XP should be 5');
  assertEqual(result2.currentLevel, 1, 'Level should be 1');
  assertEqual(result2.leveledUp, true, 'Should level up');

  // Test 3: Multiple level ups at once
  console.log('\n📋 Test: Multiple level ups at once');
  resetDatabase();
  const result3 = addXP('user3', 100);
  assertEqual(result3.newXP, 100, 'XP should be 100');
  assertEqual(result3.currentLevel, 4, 'Level should be 4 (100 >= 80)');
  assertEqual(result3.leveledUp, true, 'Should level up');

  // Test 4: Remove XP (no de-leveling)
  console.log('\n📋 Test: Remove XP (no de-leveling)');
  resetDatabase();
  addXP('user4', 20); // Level 2 (15 XP threshold)
  const result4 = removeXP('user4', 10);
  assertEqual(result4.newXP, 10, 'XP should be 10');
  assertEqual(result4.currentLevel, 2, 'Level should still be 2 (no de-leveling)');

  // Test 5: Remove XP - floor at 0
  console.log('\n📋 Test: Remove XP floors at 0');
  resetDatabase();
  addXP('user5', 5);
  const result5 = removeXP('user5', 100);
  assertEqual(result5.newXP, 0, 'XP should floor at 0');

  // Test 6: Remove XP from non-existent user
  console.log('\n📋 Test: Remove XP from non-existent user');
  resetDatabase();
  const result6 = removeXP('nonexistent', 10);
  assertEqual(result6, null, 'Should return null for non-existent user');

  // Test 7: Get user level (non-existent user)
  console.log('\n📋 Test: Get user level (non-existent)');
  resetDatabase();
  const result7 = getUserLevel('nobody');
  assertEqual(result7.xp, 0, 'XP should be 0');
  assertEqual(result7.level, 0, 'Level should be 0');

  // Test 8: Get user level (existing user)
  console.log('\n📋 Test: Get user level (existing)');
  resetDatabase();
  addXP('user8', 50);
  const result8 = getUserLevel('user8');
  assertEqual(result8.xp, 50, 'XP should be 50');
  assertEqual(result8.level, 3, 'Level should be 3 (50 >= 35)');

  // Test 9: Set user XP
  console.log('\n📋 Test: Set user XP');
  resetDatabase();
  const result9 = setUserXP('user9', 200);
  assertEqual(result9.newXP, 200, 'XP should be 200');
  assertEqual(result9.newLevel, 5, 'Level should be 5 (200 >= 140)');

  // Test 10: Set user XP (overwrite existing)
  console.log('\n📋 Test: Set user XP (overwrite existing)');
  resetDatabase();
  addXP('user10', 500);
  const result10 = setUserXP('user10', 10);
  assertEqual(result10.newXP, 10, 'XP should be overwritten to 10');
  assertEqual(result10.newLevel, 1, 'Level should be recalculated to 1');

  // Test 11: Set user level (syncs XP)
  console.log('\n📋 Test: Set user level (syncs XP to threshold)');
  resetDatabase();
  addXP('user11', 10);
  const result11 = setUserLevel('user11', 5);
  assertEqual(result11.level, 5, 'Level should be 5');
  assertEqual(result11.xp, 140, 'XP should sync to level 5 threshold (140)');

  // Test 12: Set user level (new user)
  console.log('\n📋 Test: Set user level (new user)');
  resetDatabase();
  const result12 = setUserLevel('newuser', 3);
  assertEqual(result12.level, 3, 'Level should be 3');
  assertEqual(result12.xp, 35, 'XP should be level 3 threshold (35)');

  // Test 13: Set user level 0 (new user - should return null)
  console.log('\n📋 Test: Set level 0 for new user returns null');
  resetDatabase();
  const result13 = setUserLevel('newuser0', 0);
  assertEqual(result13, null, 'Should return null for level 0 new user');

  // Test 14: Get next level threshold
  console.log('\n📋 Test: Get next level threshold');
  assertEqual(getNextLevelThreshold(0), 5, 'Next threshold after 0 should be 5');
  assertEqual(getNextLevelThreshold(4), 140, 'Next threshold after 4 should be 140');
  assertEqual(getNextLevelThreshold(9), null, 'Next threshold after 9 should be null (max level)');

  // Test 15: Incremental XP additions
  console.log('\n📋 Test: Incremental XP additions');
  resetDatabase();
  addXP('user15', 2); // 2 XP
  addXP('user15', 2); // 4 XP
  const result15a = addXP('user15', 2); // 6 XP - should level up
  assertEqual(result15a.newXP, 6, 'XP should be 6');
  assertEqual(result15a.currentLevel, 1, 'Should be level 1');
  assertEqual(result15a.leveledUp, true, 'Should have leveled up');

  // Test 16: XP exactly at threshold
  console.log('\n📋 Test: XP exactly at threshold');
  resetDatabase();
  const result16 = addXP('user16', 15);
  assertEqual(result16.newXP, 15, 'XP should be 15');
  assertEqual(result16.currentLevel, 2, 'Should be exactly level 2 at 15 XP');

  // Test 17: XP one below threshold
  console.log('\n📋 Test: XP one below threshold');
  resetDatabase();
  const result17 = addXP('user17', 14);
  assertEqual(result17.newXP, 14, 'XP should be 14');
  assertEqual(result17.currentLevel, 1, 'Should be level 1 (14 < 15)');

  // Summary
  console.log('\n' + '='.repeat(40));
  console.log(`📊 Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(40) + '\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(console.error);
