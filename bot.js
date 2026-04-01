import pkg from 'discord.js';
const { Client, GatewayIntentBits, Events, PermissionFlagsBits, Partials } = pkg;
import dotenv from 'dotenv';
import { initDatabase, addXP, removeXP, getUserLevel, getNextLevelThreshold, setUserLevel, setUserXP, exportDatabaseToCSV } from './database.js';
import configData from './config.json' with { type: 'json' };

dotenv.config(); // Load .env file

// Helper function to log to Discord channel
async function logToChannel(message) {
  if (!configData.logChannelId) return;
  try {
    const channel = await client.channels.fetch(configData.logChannelId);
    if (channel) {
      await channel.send(message);
    }
  } catch (error) {
    console.error('Failed to log to Discord channel:', error.message);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
  ],
});

// Initialize database on startup
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  console.log(`📊 Monitoring forum channel: ${configData.forumChannelId}`);
  
  await initDatabase();
  
  // Register slash commands
  await registerCommands(c);
  
  // Start periodic thread maintenance check
  if (configData.closeTime || configData.lockTime) {
    console.log(`⏰ Thread maintenance enabled - Close: ${configData.closeTime || 'disabled'}h, Lock: ${configData.lockTime || 'disabled'}h`);
    // Run immediately on startup, then every 5 minutes
    checkThreadMaintenance(c);
    setInterval(() => checkThreadMaintenance(c), 5 * 60 * 1000);
  }
  
  // Log startup to Discord channel
  logToChannel(`✅ **Bot started!** Monitoring forum channel and ready for action.`);
  
  // Start periodic database export (every hour)
  function runExport() {
    const result = exportDatabaseToCSV();
    if (result && result.count > 0) {
      console.log(`💾 Exported ${result.count} users to db-export.csv`);
      logToChannel(`💾 **Database exported** - ${result.count} users saved to db-export.csv`);
    }
  }
  runExport(); // Run immediately on startup
  setInterval(runExport, 60 * 60 * 1000); // Then every hour
});

// Check and close/lock old threads
async function checkThreadMaintenance(client) {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return;
    
    const forumChannel = await guild.channels.fetch(configData.forumChannelId);
    if (!forumChannel) return;
    
    const now = Date.now();

    // Helper to process a single thread
    async function processThread(thread) {
      const threadId = thread.id;

      // Skip excluded threads (e.g., pinned guideline posts)
      if (configData.excludeThreadIds && configData.excludeThreadIds.includes(threadId)) return;

      const threadAge = now - thread.createdTimestamp;
      const threadAgeHours = threadAge / (1000 * 60 * 60);

      // Check if thread should be locked (lockTime takes precedence)
      if (configData.lockTime && threadAgeHours >= configData.lockTime && !thread.locked) {
        await thread.setLocked(true);
        console.log(`🔒 Locked thread "${thread.name}" (age: ${Math.floor(threadAgeHours)}h)`);
        logToChannel(`🔒 **Locked thread** "${thread.name}" (age: ${Math.floor(threadAgeHours)}h)`);

        // Also archive if not already
        if (!thread.archived) {
          await thread.setArchived(true);
          console.log(`📁 Closed thread "${thread.name}"`);
          logToChannel(`📁 **Closed thread** "${thread.name}"`);
        }
      }
      // Check if thread should be closed (archived) — only if not already archived
      else if (configData.closeTime && threadAgeHours >= configData.closeTime && !thread.archived) {
        await thread.setArchived(true);
        console.log(`📁 Closed thread "${thread.name}" (age: ${Math.floor(threadAgeHours)}h)`);
        logToChannel(`📁 **Closed thread** "${thread.name}" (age: ${Math.floor(threadAgeHours)}h)`);
      }
    }

    // Fetch active threads (not yet archived by Discord)
    const activeThreads = await forumChannel.threads.fetchActive();
    for (const [, thread] of activeThreads.threads) {
      await processThread(thread);
    }

    // Also fetch recently archived threads so we can still lock them if needed.
    // Discord auto-archives threads based on inactivity settings, which may happen
    // before our bot's closeTime/lockTime thresholds are reached. An archived thread
    // can still be locked.
    if (configData.lockTime) {
      let before = undefined;
      let hasMore = true;

      while (hasMore) {
        const archivedBatch = await forumChannel.threads.fetchArchived({ before, limit: 100 });

        for (const [, thread] of archivedBatch.threads) {
          // Only care about threads old enough to need locking that aren't locked yet
          if (!thread.locked) {
            await processThread(thread);
          }
        }

        hasMore = archivedBatch.hasMore;
        if (hasMore && archivedBatch.threads.size > 0) {
          // Use the oldest thread's ID as the cursor for the next page
          before = archivedBatch.threads.last().id;
        }
      }
    }
  } catch (error) {
    console.error('Error in thread maintenance:', error);
  }
}

// Listen for reactions added to messages
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  // Ignore bot reactions
  if (user.bot) return;

  // Fetch partial reactions
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('Error fetching reaction:', error);
      return;
    }
  }

  // Check if reaction is the pin emoji
  if (reaction.emoji.name !== '📌') return;

  const message = reaction.message;
  
  // Fetch partial messages
  if (message.partial) {
    try {
      await message.fetch();
    } catch (error) {
      console.error('Error fetching message:', error);
      return;
    }
  }

  // Check if this is a forum thread
  if (!message.channel.isThread()) return;
  
  // Check if the parent is the monitored forum channel
  if (message.channel.parentId !== configData.forumChannelId) return;

  // Check if this is the starter message (initial post)
  // In forum threads, the starter message ID equals the thread ID
  if (message.id !== message.channel.id) return;

  console.log(`📌 Pin reaction from ${user.tag} on forum post: ${message.channel.name}`);
  // Add XP to user
  const xpGained = configData.xpPerPin;
  const result = addXP(user.id, xpGained);

  const nextThreshold = getNextLevelThreshold(result.currentLevel);
  const progressText = nextThreshold ? ` (${result.newXP}/${nextThreshold} XP to next level)` : ' (Max level)';
  console.log(`   User ${user.tag} now has ${result.newXP} XP${progressText} - Level ${result.currentLevel}`);
  logToChannel(`📌 **${user.tag}** pinned a post in "${message.channel.name}" → +${xpGained} XP (Total: ${result.newXP} XP, Level ${result.currentLevel})`);

  // Check if user leveled up
  if (result.leveledUp) {
    console.log(`🎉 ${user.tag} leveled up to Level ${result.currentLevel}!`);
    logToChannel(`🎉 **${user.tag}** leveled up to **Level ${result.currentLevel}**!`);
    
    // Assign role for new level
    const newRoleId = configData.levelRoles[result.currentLevel];
    const oldRoleId = configData.levelRoles[result.currentLevel - 1];
    
    if (newRoleId) {
      try {
        const guild = message.guild;
        const member = await guild.members.fetch(user.id);
        
        // Remove old level role first
        if (oldRoleId) {
          const oldRole = await guild.roles.fetch(oldRoleId);
          if (oldRole && member.roles.cache.has(oldRoleId)) {
            await member.roles.remove(oldRole);
            console.log(`   Removed role "${oldRole.name}" from ${user.tag}`);
            logToChannel(`🔄 Removed role **${oldRole.name}** from **${user.tag}**`);
          }
        }
        
        // Add new level role
        const newRole = await guild.roles.fetch(newRoleId);
        if (newRole) {
          await member.roles.add(newRole);
          console.log(`   Assigned role "${newRole.name}" to ${user.tag}`);
          logToChannel(`🔄 Assigned role **${newRole.name}** to **${user.tag}**`);
        }
      } catch (error) {
        console.error(`Error assigning role:`, error);
      }
    }
  }
});

// Listen for reactions removed from messages
client.on(Events.MessageReactionRemove, async (reaction, user) => {
  // Ignore bot reactions
  if (user.bot) return;

  // Fetch partial reactions
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('Error fetching reaction:', error);
      return;
    }
  }

  // Check if reaction is the pin emoji
  if (reaction.emoji.name !== '📌') return;

  const message = reaction.message;
  
  // Fetch partial messages
  if (message.partial) {
    try {
      await message.fetch();
    } catch (error) {
      console.error('Error fetching message:', error);
      return;
    }
  }

  // Check if this is a forum thread
  if (!message.channel.isThread()) return;
  
  // Check if the parent is the monitored forum channel
  if (message.channel.parentId !== configData.forumChannelId) return;

  // Check if this is the starter message (initial post)
  if (message.id !== message.channel.id) return;

  console.log(`📌 Pin reaction removed by ${user.tag} on forum post: ${message.channel.name}`);

  // Remove XP from user
  const xpLost = configData.xpPerPin;
  const result = removeXP(user.id, xpLost);

  if (result) {
    const nextThreshold = getNextLevelThreshold(result.currentLevel);
    const progressText = nextThreshold ? ` (${result.newXP}/${nextThreshold} XP to next level)` : ' (Max level)';
    console.log(`   User ${user.tag} now has ${result.newXP} XP${progressText} - Level ${result.currentLevel}`);
    logToChannel(`📌 **${user.tag}** removed pin from "${message.channel.name}" → -${xpLost} XP (Total: ${result.newXP} XP, Level ${result.currentLevel})`);
  } else {
    console.log(`   User ${user.tag} not found in database (no XP to remove)`);
  }
});

// Listen for new forum posts (thread creation)
client.on(Events.ThreadCreate, async (thread, newlyCreated) => {
  // Only process newly created threads
  if (!newlyCreated) return;
  
  // Check if this thread is in the monitored forum channel
  if (thread.parentId !== configData.forumChannelId) return;
  
  // Get the thread owner (person who created the post)
  const ownerId = thread.ownerId;
  if (!ownerId) return;
  
  try {
    const owner = await thread.guild.members.fetch(ownerId);
    
    console.log(`📝 New forum post "${thread.name}" created by ${owner.user.tag}`);
    logToChannel(`📝 **${owner.user.tag}** created new forum post: "${thread.name}"`);
    
    // Send auto-reply if configured (with delay to ensure initial message is posted)
    if (configData.autoReplyMessage) {
      setTimeout(async () => {
        try {
          const replyMessage = configData.autoReplyMessage.replace('{user}', `<@${ownerId}>`);
          await thread.send(replyMessage);
          console.log(`   Auto-reply sent to thread "${thread.name}"`);
        } catch (error) {
          console.error(`   Failed to send auto-reply to "${thread.name}":`, error.message);
        }
      }, 2000); // 2 second delay
    }
    
    // Add XP for creating a post
    const xpGained = configData.xpPerPost;
    const result = addXP(ownerId, xpGained);
    
    const nextThreshold = getNextLevelThreshold(result.currentLevel);
    const progressText = nextThreshold ? ` (${result.newXP}/${nextThreshold} XP to next level)` : ' (Max level)';
    console.log(`   User ${owner.user.tag} now has ${result.newXP} XP${progressText} - Level ${result.currentLevel}`);
    
    // Check if user leveled up
    if (result.leveledUp) {
      console.log(`🎉 ${owner.user.tag} leveled up to Level ${result.currentLevel}!`);
      logToChannel(`🎉 **${owner.user.tag}** leveled up to **Level ${result.currentLevel}**!`);
      
      // Assign role for new level
      const newRoleId = configData.levelRoles[result.currentLevel];
      const oldRoleId = configData.levelRoles[result.currentLevel - 1];
      
      if (newRoleId) {
        // Remove old level role first
        if (oldRoleId) {
          const oldRole = await thread.guild.roles.fetch(oldRoleId);
          if (oldRole && owner.roles.cache.has(oldRoleId)) {
            await owner.roles.remove(oldRole);
            console.log(`   Removed role "${oldRole.name}" from ${owner.user.tag}`);
            logToChannel(`🔄 Removed role **${oldRole.name}** from **${owner.user.tag}**`);
          }
        }
        
        // Add new level role
        const newRole = await thread.guild.roles.fetch(newRoleId);
        if (newRole) {
          await owner.roles.add(newRole);
          console.log(`   Assigned role "${newRole.name}" to ${owner.user.tag}`);
          logToChannel(`🔄 Assigned role **${newRole.name}** to **${owner.user.tag}**`);
        }
      }
    }
  } catch (error) {
    console.error('Error processing new forum post:', error);
  }
});

// Register slash commands
async function registerCommands(client) {
  const commands = [
    {
      name: 'check-xp',
      description: 'Check a user\'s XP and level (Admin only)',
      options: [
        {
          name: 'user',
          description: 'The user to check',
          type: 6, // USER type
          required: true,
        },
      ],
    },
    {
      name: 'set-xp',
      description: 'Set a user\'s XP to a specific value and update their role (Admin only)',
      options: [
        {
          name: 'user',
          description: 'The user to set XP for',
          type: 6, // USER type
          required: true,
        },
        {
          name: 'amount',
          description: 'XP value to set',
          type: 4, // INTEGER type
          required: true,
        },
      ],
    },
  ];

  try {
    await client.application.commands.set(commands);
    console.log('✅ Registered slash commands');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

// Handle slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'check-xp') {
    // Check if user has admin permissions
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: '❌ You need Administrator permissions to use this command.', ephemeral: true });
      return;
    }

    const targetUser = interaction.options.getUser('user');
    const data = getUserLevel(targetUser.id);

    if (data.xp === 0) {
      await interaction.reply({ 
        content: `${targetUser.tag} hasn't earned any XP yet.`, 
        ephemeral: true 
      });
      return;
    }

    const nextThreshold = getNextLevelThreshold(data.level);
    const xpNeeded = nextThreshold ? nextThreshold - data.xp : 0;

    let response = `📊 **${targetUser.tag}**\n`;
    response += `Level: ${data.level}\n`;
    response += `XP: ${data.xp}`;
    
    if (nextThreshold) {
      response += ` / ${nextThreshold} (${xpNeeded} XP until next level)`;
    }

    await interaction.reply({ content: response, ephemeral: true });
  }

  if (interaction.commandName === 'set-xp') {
    // Check if user has admin permissions
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: '❌ You need Administrator permissions to use this command.', ephemeral: true });
      return;
    }

    const targetUser = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');

    if (amount < 0) {
      await interaction.reply({ content: '❌ XP amount cannot be negative.', ephemeral: true });
      return;
    }

    const result = setUserXP(targetUser.id, amount);
    const nextThreshold = getNextLevelThreshold(result.newLevel);
    const progressText = nextThreshold ? ` (${result.newXP}/${nextThreshold} XP to next level)` : ' (Max level)';

    // Update roles - remove all level roles, then add the correct one
    try {
      const member = await interaction.guild.members.fetch(targetUser.id);
      
      // Remove all level roles
      for (const [level, roleId] of Object.entries(configData.levelRoles)) {
        if (member.roles.cache.has(roleId)) {
          const role = await interaction.guild.roles.fetch(roleId);
          if (role) {
            await member.roles.remove(role);
          }
        }
      }
      
      // Add the correct level role
      const newRoleId = configData.levelRoles[result.newLevel];
      if (newRoleId) {
        const newRole = await interaction.guild.roles.fetch(newRoleId);
        if (newRole) {
          await member.roles.add(newRole);
        }
      }
    } catch (error) {
      console.error('Error updating roles:', error);
    }

    await interaction.reply({ 
      content: `✅ Set ${targetUser.tag}'s XP to ${result.newXP}. They are now Level ${result.newLevel}${progressText}.`, 
      ephemeral: true 
    });
    
    logToChannel(`⚙️ **${interaction.user.tag}** used /set-xp on **${targetUser.tag}** → XP: ${result.newXP}, Level: ${result.newLevel}`);
  }
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);

// Listen for messages to detect trigger role mentions
client.on(Events.MessageCreate, async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Ignore the starter/opening message of a forum thread — ThreadCreate already handles those.
  // Discord sets the starter message ID equal to the thread ID.
  if (message.channel.isThread() && message.id === message.channel.id) return;
  
  // Check if role ping triggers are configured
  if (!configData.rolePingTriggers || !Array.isArray(configData.rolePingTriggers)) return;
  
  // Check each trigger configuration
  for (const trigger of configData.rolePingTriggers) {
    // Skip if trigger role wasn't mentioned
    if (!message.mentions.roles.has(trigger.triggerRoleId)) continue;
    
    console.log(`🔔 ${trigger.name} trigger role mentioned by ${message.author.tag} in #${message.channel.name}`);
    logToChannel(`🔔 **${message.author.tag}** triggered **${trigger.name}** role ping in #${message.channel.name}`);
    
    // Build list of roles to ping
    const rolesToPing = trigger.pingRoles
      .filter(roleId => roleId && !roleId.startsWith('LFKIN_ROLE_') && !roleId.startsWith('YOUR_'))
      .map(roleId => `<@&${roleId}>`);
    
    if (rolesToPing.length === 0) {
      console.log(`   No roles configured to ping for ${trigger.name}`);
      continue;
    }
    
    // Build the response with spoilered role mentions
    const messageText = trigger.message || 'Notifying roles:\n\n||';
    const rolesWithClosingSpoiler = `${rolesToPing.join(' ')} ||`;
    
    try {
      await message.channel.send(`${messageText}${rolesWithClosingSpoiler}`);
      console.log(`   Sent spoilered ping for ${rolesToPing.length} roles (${trigger.name})`);
    } catch (error) {
      console.error(`Error sending ${trigger.name} role ping message:`, error);
    }
  }
});
