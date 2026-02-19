# ForumXPBot - Discord Forum XP & Leveling Bot

A Discord bot that tracks XP and assigns level roles based on forum activity. Users earn XP by creating forum posts and receiving pin reactions.

## Features

- **Forum-focused XP system** - Tracks activity in a designated forum channel
- **Pin reaction rewards** - Users earn XP when others pin their forum posts
- **Post creation rewards** - Users earn XP for creating new forum posts
- **XP removal** - XP is removed if a pin reaction is removed (no de-leveling)
- **Automatic role management** - Assigns level roles on level-up, removes old level roles
- **Auto-reply on new posts** - Configurable welcome message when users create forum posts
- **Role ping triggers** - Responds with spoilered role pings when specific roles are mentioned
- **Auto-close & lock threads** - Automatically archives and locks old forum posts (with exclude list)
- **Discord channel logging** - Logs all bot activity to a designated channel
- **Hourly database export** - Automatically exports user data to CSV every hour
- **Admin commands** - Check and set user XP
- **Bulk import tools** - Scripts for importing users from CSV (supports username or user ID format)

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) v20 or higher
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/gelineau9/ForumXPBot.git
   cd ForumXPBot
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
  "logChannelId": "YOUR_LOG_CHANNEL_ID",
  "xpPerPin": 2,
  "xpPerPost": 1,
  "closeTime": 10,
  "lockTime": 24,
  "excludeThreadIds": ["THREAD_ID_1", "THREAD_ID_2"],
  "autoReplyMessage": "Thanks for your post, {user}!",
  "rolePingTriggers": [
    {
      "name": "LFRP",
      "triggerRoleId": "TRIGGER_ROLE_ID",
      "message": "A member is looking for RP!\n\n||",
      "pingRoles": ["ROLE_ID_1", "ROLE_ID_2"]
    }
  ],
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

### Configuration Options

| Option | Description |
|--------|-------------|
| `forumChannelId` | The forum channel to monitor for XP activity |
| `logChannelId` | Channel for bot activity logs (set to `null` to disable) |
| `xpPerPin` | XP awarded when a user's post receives a pin reaction |
| `xpPerPost` | XP awarded when a user creates a new forum post |
| `closeTime` | Hours until forum posts are archived/closed (set to `null` to disable) |
| `lockTime` | Hours until forum posts are locked (set to `null` to disable) |
| `excludeThreadIds` | Array of thread IDs to exclude from auto-close/lock (e.g., pinned guidelines) |
| `autoReplyMessage` | Message sent on new forum posts. Use `{user}` to mention the poster (set to `null` to disable) |
| `rolePingTriggers` | Array of role ping configurations (see below) |
| `levelThresholds` | Cumulative XP required to reach each level |
| `levelRoles` | Discord role IDs to assign for each level |

### Role Ping Triggers

When a user mentions a trigger role, the bot responds with a message and spoilered role pings:

```json
"rolePingTriggers": [
  {
    "name": "LFRP",
    "triggerRoleId": "TRIGGER_ROLE_ID",
    "message": "Your message here\n\n||",
    "pingRoles": ["ROLE_1", "ROLE_2", "ROLE_3"]
  }
]
```

| Field | Description |
|-------|-------------|
| `name` | Identifier for logging |
| `triggerRoleId` | Role ID that triggers this response when mentioned |
| `message` | Message to send (end with `\n\n\|\|` to start the spoiler) |
| `pingRoles` | Array of role IDs to ping inside the spoiler |

### Getting Discord IDs

1. Enable **Developer Mode** in Discord (Settings → Advanced → Developer Mode)
2. Right-click on channels/roles → **Copy ID**

## Discord Bot Setup

### Required Bot Permissions

- Read Messages/View Channels
- Read Message History
- Send Messages
- Send Messages in Threads
- Add Reactions
- Manage Roles
- Manage Threads
- Use Application Commands

### Required Intents

Enable these in the Discord Developer Portal (Bot → Privileged Gateway Intents):
- **Message Content Intent**
- **Server Members Intent**

### Role Hierarchy

**Important:** The bot's role must be positioned **above** all level roles in your server's role settings.

## Admin Commands

All commands require **Administrator** permission. Responses are only visible to the admin.

| Command | Description |
|---------|-------------|
| `/set-xp @user <amount>` | Set a user's XP and update their role |
| `/check-xp @user` | Check a user's current XP and level |

## Testing

Run the test suite to verify database and XP calculations:

```bash
node test.js
```

## Database Export & Import

### Automatic Export

The bot automatically exports user data to `db-export.csv` every hour (and on startup). The format is:

```csv
userId,xp
123456789012345678,150
234567890123456789,85
```

### Import Script

Import users from a CSV file:

```bash
node import-users.js [filename.csv]
```

- Default filename is `import.csv` if not specified
- **Important:** Stop the bot before running import, then restart it after

The script auto-detects two CSV formats:

**User ID format** (from `db-export.csv`):
```csv
userId,xp
123456789012345678,150
```

**Username format** (from spreadsheets):
```csv
username,xp
SomeUser,150
```

## License

MIT License - feel free to use and modify for your own projects.
