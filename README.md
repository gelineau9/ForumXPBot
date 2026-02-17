# ForumXPBot - Discord Forum XP & Leveling Bot

A lightweight Discord bot that tracks XP and assigns level roles based on user activity in forum channels. Users earn XP by creating forum posts and receiving pin reactions on their posts.

## Features

- **Forum-focused XP system** - Tracks activity only in a designated forum channel (config.json)
- **Pin reaction rewards** - Users earn XP when others pin (📌) their forum starter posts
- **XP removal** - XP is removed if a pin reaction is removed
- **Post creation rewards** - Users earn XP for creating new forum posts
- **Automatic role management** - Assigns level roles on level-up, removes old level roles
- **Manual role sync** - Assigning a level role manually updates the user's XP and removes lower roles
- **Admin commands** - Manage user XP and check progress
- **SQLite database** - Lightweigh storage with no external dependencies

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/gelineau9/RoLBot.git
   cd RoLBot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create environment file**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add your bot token:
   ```
   DISCORD_TOKEN=your_bot_token_here
   ```

4. **Create configuration file**
   ```bash
   cp config.example.json config.json
   ```
   Edit `config.json` with your Discord IDs (see [Configuration](#configuration))

5. **Start the bot**
   ```bash
   npm start
   ```

## Configuration

Edit `config.json` with your server's IDs:

```json
{
  "forumChannelId": "YOUR_FORUM_CHANNEL_ID",
  "xpPerPin": 2,
  "xpPerPost": 1,
  "levelThresholds": {
    "1": 5,
    "2": 15,
    "3": 35
  },
  "levelRoles": {
    "0": "ROLE_ID_FOR_LEVEL_0",
    "1": "ROLE_ID_FOR_LEVEL_1",
    "2": "ROLE_ID_FOR_LEVEL_2"
  }
}
```

### Getting Discord IDs

1. Enable **Developer Mode** in Discord (Settings → Advanced → Developer Mode)
2. Right-click on channels/roles → **Copy ID**

### Configuration Options

| Option | Description |
|--------|-------------|
| `forumChannelId` | The forum channel to monitor for XP activity |
| `xpPerPin` | XP awarded when a user's post receives a pin reaction |
| `xpPerPost` | XP awarded when a user creates a new forum post |
| `levelThresholds` | Cumulative XP required to reach each level |
| `levelRoles` | Discord role IDs to assign for each level |

## Discord Bot Setup

### Required Bot Permissions

When creating your OAuth2 invite URL, select these permissions:
- Read Messages/View Channels
- Read Message History
- Add Reactions
- Manage Roles
- Send Messages
- Use Application Commands

### Required Intents

Enable these in the Discord Developer Portal (Bot → Privileged Gateway Intents):
- **Message Content Intent**
- **Server Members Intent**

### Role Hierarchy

**Important:** The bot's role must be positioned **above** all level roles in your server's role settings. Discord prevents bots from managing roles higher than their own.

## Admin Commands

All commands require **Administrator** permission and responses are ephemeral (only visible to the admin).

| Command | Description |
|---------|-------------|
| `/add-xp @user <amount>` | Add XP to a user (triggers level-ups if thresholds are crossed) |
| `/set-xp @user <amount>` | Set a user's XP to a specific value and update their role accordingly |
| `/check-xp @user` | Check a user's current XP and level |

## File Structure

```
ForumXPBot/
├── bot.js              # Main bot logic and event handlers
├── database.js         # SQLite database operations
├── config.json         # Bot configuration (not tracked in git)
├── config.example.json # Example configuration template
├── .env                # Bot token (not tracked in git)
├── .env.example        # Example environment template
├── package.json        # Node.js dependencies
├── .gitignore          # Git ignore rules
└── xp.db               # SQLite database (created on first run)
```

## License

MIT License - feel free to use and modify for your own projects.
