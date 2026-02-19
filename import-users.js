/**
 * Bulk User Import Script for ForumXPBot
 * 
 * Usage: node import-users.js [import.csv|db-export.csv]
 * 
 * Supports two CSV formats (auto-detected):
 *   userId,xp    - Direct import using Discord IDs (fast)
 *   username,xp  - Import using username lookup (slower)
 * 
 * Users not found are saved to 'import-failures.csv'
 */

import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import configData from './config.json' with { type: 'json' };

const CSV_FILE = process.argv[2] || 'import.csv';
const FAILURES_FILE = 'import-failures.csv';
const RATE_LIMIT_MS = 1500;

let db;
const failures = [];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// Check if a string is a Discord user ID (17-19 digit number)
function isDiscordId(str) {
  return /^\d{17,19}$/.test(str);
}

// Parse CSV file and detect format
function parseCSV(filename) {
  const content = readFileSync(filename, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  
  // Check header to determine format
  const header = lines[0].toLowerCase();
  const isIdFormat = header.includes('userid') || header.includes('user_id');
  
  const users = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const parts = line.split(',');
    const identifier = parts[0]?.trim().replace(/^"|"$/g, '');
    const xp = parseInt(parts[1]?.trim().replace(/^"|"$/g, ''), 10);
    
    if (identifier && !isNaN(xp)) {
      // Auto-detect: if it looks like a Discord ID, treat it as one
      const hasId = isIdFormat || isDiscordId(identifier);
      users.push({ 
        identifier, 
        xp,
        isId: hasId
      });
    }
  }
  
  return users;
}

// Initialize database
async function initDatabase() {
  const SQL = await initSqlJs();
  
  if (existsSync('xp.db')) {
    const fileBuffer = readFileSync('xp.db');
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      current_xp INTEGER DEFAULT 0,
      current_level INTEGER DEFAULT 0
    )
  `);
}

// Calculate level from XP
function calculateLevel(xp) {
  const thresholds = configData.levelThresholds;
  const sortedLevels = Object.keys(thresholds).map(Number).sort((a, b) => a - b);
  
  let level = 0;
  for (const lvl of sortedLevels) {
    if (xp >= thresholds[lvl]) {
      level = lvl;
    }
  }
  return level;
}

// Set user XP in database
function setUserXP(userId, xp) {
  const level = calculateLevel(xp);
  
  const result = db.exec('SELECT * FROM users WHERE user_id = ?', [userId]);
  
  if (result.length === 0 || result[0].values.length === 0) {
    db.run('INSERT INTO users (user_id, current_xp, current_level) VALUES (?, ?, ?)', [userId, xp, level]);
  } else {
    db.run('UPDATE users SET current_xp = ?, current_level = ? WHERE user_id = ?', [xp, level, userId]);
  }
  
  return level;
}

// Save database
function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync('xp.db', buffer);
}

// Delay helper
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Assign role to user
async function assignRole(member, level) {
  const roleId = configData.levelRoles[level];
  if (!roleId) return;
  
  const role = member.guild.roles.cache.get(roleId);
  if (!role) return;
  
  const levelRoleIds = Object.values(configData.levelRoles);
  const rolesToRemove = member.roles.cache.filter(r => levelRoleIds.includes(r.id) && r.id !== roleId);
  
  try {
    if (rolesToRemove.size > 0) {
      await member.roles.remove(rolesToRemove);
    }
    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(role);
    }
  } catch (error) {
    console.log(`   ⚠️  Could not assign role: ${error.message}`);
  }
}

// Main import function
async function runImport() {
  console.log('\n📥 ForumXPBot Bulk Import Script\n');
  
  if (!existsSync(CSV_FILE)) {
    console.error(`❌ Error: ${CSV_FILE} not found`);
    console.log('\nRun sanitize-csv.js first to create import.csv');
    process.exit(1);
  }
  
  console.log(`📄 Reading ${CSV_FILE}...`);
  const users = parseCSV(CSV_FILE);
  console.log(`   Found ${users.length} users to import\n`);
  
  console.log('💾 Initializing database...');
  await initDatabase();
  
  console.log('🤖 Connecting to Discord...\n');
  
  client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}\n`);
    
    const guild = client.guilds.cache.first();
    if (!guild) {
      console.error('❌ No guild found.');
      process.exit(1);
    }
    
    console.log(`📡 Fetching members from ${guild.name}...`);
    
    try {
      await guild.members.fetch();
    } catch (error) {
      console.error('❌ Could not fetch members:', error.message);
      process.exit(1);
    }
    
    console.log(`   Found ${guild.members.cache.size} members\n`);
    
    // Build lookup map
    const memberMap = new Map();
    guild.members.cache.forEach(member => {
      memberMap.set(member.user.username.toLowerCase(), member);
      if (member.displayName) {
        memberMap.set(member.displayName.toLowerCase(), member);
      }
      if (member.user.globalName) {
        memberMap.set(member.user.globalName.toLowerCase(), member);
      }
    });
    
    console.log('🔄 Processing users...\n');
    
    let success = 0;
    let failed = 0;
    let skippedNotInGuild = 0;
    
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const progress = `[${i + 1}/${users.length}]`;
      
      let member;
      
      if (user.isId) {
        // Direct ID lookup - fast path
        member = guild.members.cache.get(user.identifier);
        
        if (!member) {
          // User ID exists but not in guild (left server)
          console.log(`${progress} ⏭️  ID ${user.identifier} - Not in guild (skipping)`);
          skippedNotInGuild++;
          continue;
        }
      } else {
        // Username lookup - slower path
        member = memberMap.get(user.identifier.toLowerCase());
        
        if (!member) {
          console.log(`${progress} ❌ "${user.identifier}" - Not found`);
          failures.push({ username: user.identifier, xp: user.xp });
          failed++;
          continue;
        }
      }
      
      const level = setUserXP(member.id, user.xp);
      console.log(`${progress} ✅ ${user.isId ? member.user.tag : `"${user.identifier}" → ${member.user.tag}`} (XP: ${user.xp}, Level: ${level})`);
      
      await assignRole(member, level);
      await delay(RATE_LIMIT_MS);
      
      success++;
    }
    
    console.log('\n💾 Saving database...');
    saveDatabase();
    
    // Write failures to CSV
    if (failures.length > 0) {
      const failuresContent = 'username,xp\n' + failures.map(f => `${f.username},${f.xp}`).join('\n');
      writeFileSync(FAILURES_FILE, failuresContent);
      console.log(`\n⚠️  ${failures.length} users not found - saved to ${FAILURES_FILE}`);
    }
    
    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 Import Summary');
    console.log('='.repeat(50));
    console.log(`   ✅ Successful: ${success}`);
    console.log(`   ⏭️  Skipped (not in guild): ${skippedNotInGuild}`);
    console.log(`   ❌ Failed (not found): ${failed}`);
    console.log(`   📁 Total: ${users.length}`);
    console.log('='.repeat(50) + '\n');
    
    client.destroy();
    process.exit(0);
  });
  
  client.login(process.env.DISCORD_TOKEN);
}

runImport().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
