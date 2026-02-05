module.exports = {
  // Server
  PORT: process.env.PORT || 3001,

  // Discord Bot
  BOT_TOKEN: process.env.BOT_TOKEN,
  GUILD_ID: process.env.GUILD_ID,

  // Voice Channels
  DRAFT_CHANNEL_ID: process.env.DRAFT_CHANNEL_ID,
  TEAM_1_VOICE_CHANNEL_ID: process.env.TEAM_1_VOICE_ID,
  TEAM_2_VOICE_CHANNEL_ID: process.env.TEAM_2_VOICE_ID,

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
  K_FACTOR: 32,

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
