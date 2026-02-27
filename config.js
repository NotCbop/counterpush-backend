module.exports = {
  // Server
  PORT: process.env.PORT || 3001,

  // Discord Bot
  BOT_TOKEN: process.env.BOT_TOKEN,
  GUILD_ID: process.env.GUILD_ID,

  // Voice Channel Category (bot will create VCs under this)
  VOICE_CATEGORY_ID: process.env.VOICE_CATEGORY_ID,

  // Main VC (where players wait and return after games)
  MAIN_VC_ID: process.env.MAIN_VC_ID || '1468067179776839845',

  // Match Results Channel
  MATCH_RESULTS_CHANNEL_ID: process.env.MATCH_RESULTS_CHANNEL_ID || '1468819780873097328',

  // Minecraft Servers (for fetching stats)
  // Add all your server URLs here
  MINECRAFT_SERVERS: [
    process.env.MINECRAFT_SERVER_1 || 'http://161.129.71.34:25705',
    process.env.MINECRAFT_SERVER_2 || 'http://161.129.71.34:25591'
  ],
  
  // Legacy single server support (deprecated, use MINECRAFT_SERVERS instead)
  MINECRAFT_STATS_URL: process.env.MINECRAFT_STATS_URL || 'http://161.129.71.34:25705',

  // ELO K-Factor (doubled for faster ranking)
  K_FACTOR: 64,

  // Rank Role IDs (new tier system)
  RANK_ROLES: {
    Netherite: '1471270947381051603',
    Diamond: '1471270840975757527',
    Amethyst: '1471270735673557353',
    Emerald: '1471270594329837762',
    Gold: '1471270344504377366',
    Iron: '1471270348249895014',
    Copper: '1471270220659167242'
  },

  // Lobby Settings
  MAX_PLAYERS: 10,
  MAX_CAPTAINS: 2,

  // ELO Settings
  STARTING_ELO: 500,

  // Rank Thresholds (new tier system)
  RANKS: {
    Netherite: 1500,
    Diamond: 1300,
    Amethyst: 1150,
    Emerald: 1000,
    Gold: 850,
    Iron: 700,
    Copper: 0
  },

  // Class IDs (from Skript)
  CLASSES: {
    1: 'Tank',
    2: 'Brawler',
    3: 'Sniper',
    4: 'Trickster',
    5: 'Support'
  },

  // Frontend URL (for CORS)
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',

  // Backend URL (for generating image URLs)
  BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:3001',

  // Role required to host public lobbies (with ELO)
  PUBLIC_HOST_ROLE_ID: process.env.PUBLIC_HOST_ROLE_ID || '1468766786416676971',

  // Team colors mapping
  TEAM_COLORS: {
    0: { name: 'white', hex: '#ffffff', tailwind: 'gray' },
    1: { name: 'blue', hex: '#0d52ad', tailwind: 'blue' },  // Counterpush blue
    2: { name: 'purple', hex: '#a855f7', tailwind: 'purple' },
    3: { name: 'green', hex: '#9ced23', tailwind: 'green' },  // Counterpush green
    4: { name: 'yellow', hex: '#eab308', tailwind: 'yellow' },
    5: { name: 'red', hex: '#ef4444', tailwind: 'red' },
    6: { name: 'pink', hex: '#ec4899', tailwind: 'pink' },
    7: { name: 'orange', hex: '#f97316', tailwind: 'orange' }
  },

  // Default team colors (green and blue - Counterpush brand colors)
  DEFAULT_TEAM1_COLOR: 3,  // green
  DEFAULT_TEAM2_COLOR: 1   // blue
};
