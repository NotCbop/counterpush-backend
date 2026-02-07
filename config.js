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

  // Minecraft Server (for fetching stats)
  MINECRAFT_STATS_URL: process.env.MINECRAFT_STATS_URL || 'https://199.231.187.154:8080',

  // ELO K-Factor (doubled for faster ranking)
  K_FACTOR: 64,

  // Rank Role IDs
  RANK_ROLES: {
    S: process.env.RANK_ROLE_S || '1468774139660865774',
    A: process.env.RANK_ROLE_A || '1468774162779607080',
    B: process.env.RANK_ROLE_B || '1468774170740523160',
    C: process.env.RANK_ROLE_C || '1468774177053081783',
    D: process.env.RANK_ROLE_D || '1468774289611428003',
    F: process.env.RANK_ROLE_F || '1468774185701736599'
  },

  // Lobby Settings
  MAX_PLAYERS: 10,
  MAX_CAPTAINS: 2,

  // ELO Settings
  STARTING_ELO: 1000,

  // Rank Thresholds
  RANKS: {
    S: 1400,
    A: 1250,
    B: 1100,
    C: 950,
    D: 800,
    F: 0
  },

  // Frontend URL (for CORS)
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000'
};
