const { MongoClient } = require('mongodb');
const CONFIG = require('./config');

// MongoDB connection
const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://username:password@cluster.mongodb.net/counterpush?retryWrites=true&w=majority';
let db = null;
let client = null;

// Connect to MongoDB
async function connectDB() {
  if (db) return db;
  
  try {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db('counterpush');
    console.log('Connected to MongoDB');
    
    // Create indexes for better performance
    await db.collection('players').createIndex({ odiscordId: 1 }, { unique: true });
    await db.collection('players').createIndex({ elo: -1 });
    await db.collection('matches').createIndex({ timestamp: -1 });
    await db.collection('sessions').createIndex({ odiscordId: 1 });
    await db.collection('minecraft_links').createIndex({ odiscordId: 1 }, { unique: true });
    await db.collection('minecraft_links').createIndex({ uuid: 1 });
    
    return db;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

// Initialize connection on module load
connectDB().catch(console.error);

// ===========================================
// MINECRAFT LINKS
// ===========================================

async function linkMinecraft(odiscordId, uuid, username) {
  const database = await connectDB();
  await database.collection('minecraft_links').updateOne(
    { odiscordId },
    { $set: { odiscordId, uuid, username, linkedAt: Date.now() } },
    { upsert: true }
  );
}

async function getMinecraftByDiscord(odiscordId) {
  const database = await connectDB();
  return database.collection('minecraft_links').findOne({ odiscordId });
}

async function getDiscordByMinecraft(uuid) {
  const database = await connectDB();
  return database.collection('minecraft_links').findOne({ uuid });
}

async function unlinkMinecraft(odiscordId) {
  const database = await connectDB();
  const result = await database.collection('minecraft_links').deleteOne({ odiscordId });
  return result.deletedCount > 0;
}

// ===========================================
// SESSIONS
// ===========================================

async function setUserSession(odiscordId, lobbyId) {
  const database = await connectDB();
  await database.collection('sessions').updateOne(
    { odiscordId },
    { $set: { odiscordId, lobbyId, updatedAt: Date.now() } },
    { upsert: true }
  );
}

async function getUserSession(odiscordId) {
  const database = await connectDB();
  return database.collection('sessions').findOne({ odiscordId });
}

async function clearUserSession(odiscordId) {
  const database = await connectDB();
  await database.collection('sessions').deleteOne({ odiscordId });
}

async function clearLobbySession(lobbyId) {
  const database = await connectDB();
  await database.collection('sessions').deleteMany({ lobbyId });
}

// ===========================================
// MATCHES
// ===========================================

async function saveMatch(matchData) {
  const database = await connectDB();
  const match = {
    id: `M${Date.now()}`,
    timestamp: Date.now(),
    date: new Date().toISOString(),
    ...matchData
  };
  await database.collection('matches').insertOne(match);
  return match;
}

async function getPlayerMatches(odiscordId, limit = 10) {
  const database = await connectDB();
  return database.collection('matches')
    .find({
      $or: [
        { 'winners.odiscordId': odiscordId },
        { 'losers.odiscordId': odiscordId }
      ]
    })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
}

async function getRecentMatches(limit = 20) {
  const database = await connectDB();
  return database.collection('matches')
    .find({})
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
}

async function clearAllMatches() {
  const database = await connectDB();
  await database.collection('matches').deleteMany({});
  console.log('All matches cleared');
}

// ===========================================
// PLAYER MANAGEMENT
// ===========================================

async function getPlayer(odiscordId) {
  const database = await connectDB();
  const player = await database.collection('players').findOne({ odiscordId });
  
  if (!player) return null;
  
  player.rank = getRank(player.elo);
  player.kdr = player.totalDeaths > 0 
    ? (player.totalKills / player.totalDeaths).toFixed(2) 
    : (player.totalKills || 0).toFixed(2);
  
  return player;
}

async function getOrCreatePlayer(odiscordId, username, avatar) {
  const database = await connectDB();
  let player = await database.collection('players').findOne({ odiscordId });
  
  if (!player) {
    player = {
      odiscordId,
      username,
      avatar,
      elo: CONFIG.STARTING_ELO,
      wins: 0,
      losses: 0,
      gamesPlayed: 0,
      totalKills: 0,
      totalDeaths: 0,
      totalAssists: 0,
      totalDamage: 0,
      totalHealing: 0,
      classStats: {
        Tank: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 },
        Brawler: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 },
        Sniper: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 },
        Trickster: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 },
        Support: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 }
      },
      createdAt: Date.now()
    };
    await database.collection('players').insertOne(player);
  } else {
    // Update username and avatar
    await database.collection('players').updateOne(
      { odiscordId },
      { $set: { username, avatar } }
    );
    player.username = username;
    player.avatar = avatar;
    
    // Ensure classStats exists for older players
    if (!player.classStats) {
      await database.collection('players').updateOne(
        { odiscordId },
        { $set: { 
          classStats: {
            Tank: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 },
            Brawler: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 },
            Sniper: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 },
            Trickster: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 },
            Support: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 }
          }
        }}
      );
      player.classStats = {
        Tank: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 },
        Brawler: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 },
        Sniper: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 },
        Trickster: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 },
        Support: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 }
      };
    }
  }
  
  player.rank = getRank(player.elo);
  player.kdr = player.totalDeaths > 0 
    ? (player.totalKills / player.totalDeaths).toFixed(2) 
    : (player.totalKills || 0).toFixed(2);
  
  return player;
}

async function updatePlayer(odiscordId, data) {
  const database = await connectDB();
  await database.collection('players').updateOne(
    { odiscordId },
    { $set: data }
  );
}

async function getAllPlayers() {
  const database = await connectDB();
  const players = await database.collection('players').find({}).toArray();
  return players.map(p => ({
    ...p,
    rank: getRank(p.elo),
    kdr: p.totalDeaths > 0 
      ? (p.totalKills / p.totalDeaths).toFixed(2) 
      : (p.totalKills || 0).toFixed(2)
  }));
}

// ===========================================
// ELO CALCULATION (Team Average Based)
// ===========================================

function calculateTeamAverageElo(team, getPlayerFunc) {
  if (team.length === 0) return CONFIG.STARTING_ELO;
  const totalElo = team.reduce((sum, p) => sum + (p.elo || CONFIG.STARTING_ELO), 0);
  return totalElo / team.length;
}

function calculateEloChange(winnerAvgElo, loserAvgElo) {
  // Base ELO pool is 50 (winners gain, losers lose)
  const BASE_ELO = 50;
  
  // Calculate expected score based on ELO difference
  const eloDiff = loserAvgElo - winnerAvgElo;
  const expectedWinner = 1 / (1 + Math.pow(10, eloDiff / 400));
  
  // Calculate ELO change (more for upsets, less for expected wins)
  // Range: ~20 (heavy favorite wins) to ~30 (underdog wins)
  const eloChange = Math.round(BASE_ELO * (1 - expectedWinner + 0.5) / 1.5);
  
  // Clamp between 20 and 30
  return Math.max(20, Math.min(30, eloChange));
}

async function processMatchResult(winnerIds, loserIds, lobbyId) {
  const database = await connectDB();
  
  // Get all players
  const winners = [];
  const losers = [];
  
  for (const id of winnerIds) {
    const player = await getPlayer(id);
    if (player) winners.push(player);
  }
  
  for (const id of loserIds) {
    const player = await getPlayer(id);
    if (player) losers.push(player);
  }
  
  // Calculate team average ELOs
  const winnerAvgElo = calculateTeamAverageElo(winners);
  const loserAvgElo = calculateTeamAverageElo(losers);
  
  // Calculate ELO change based on team averages
  const eloChange = calculateEloChange(winnerAvgElo, loserAvgElo);
  const eloLoss = 50 - eloChange; // Total pool is 50
  
  const results = {
    lobbyId,
    winnerAvgElo: Math.round(winnerAvgElo),
    loserAvgElo: Math.round(loserAvgElo),
    eloGain: eloChange,
    eloLoss: eloLoss,
    winners: [],
    losers: []
  };
  
  // Update winners
  for (const player of winners) {
    const oldElo = player.elo;
    const newElo = oldElo + eloChange;
    
    await updatePlayer(player.odiscordId, {
      elo: newElo,
      wins: (player.wins || 0) + 1,
      gamesPlayed: (player.gamesPlayed || 0) + 1
    });
    
    results.winners.push({
      odiscordId: player.odiscordId,
      username: player.username,
      oldElo,
      newElo,
      change: eloChange
    });
  }
  
  // Update losers
  for (const player of losers) {
    const oldElo = player.elo;
    const newElo = Math.max(0, oldElo - eloLoss); // Don't go below 0
    
    await updatePlayer(player.odiscordId, {
      elo: newElo,
      losses: (player.losses || 0) + 1,
      gamesPlayed: (player.gamesPlayed || 0) + 1
    });
    
    results.losers.push({
      odiscordId: player.odiscordId,
      username: player.username,
      oldElo,
      newElo,
      change: -eloLoss
    });
  }
  
  // Save match
  await saveMatch(results);
  
  return results;
}

// ===========================================
// RANK HELPERS
// ===========================================

function getRank(elo) {
  if (elo >= CONFIG.RANKS.Netherite) return 'Netherite';
  if (elo >= CONFIG.RANKS.Diamond) return 'Diamond';
  if (elo >= CONFIG.RANKS.Amethyst) return 'Amethyst';
  if (elo >= CONFIG.RANKS.Emerald) return 'Emerald';
  if (elo >= CONFIG.RANKS.Gold) return 'Gold';
  if (elo >= CONFIG.RANKS.Iron) return 'Iron';
  return 'Copper';
}

// ===========================================
// LEADERBOARD
// ===========================================

async function getLeaderboard(limit = 50) {
  const database = await connectDB();
  const players = await database.collection('players')
    .find({ gamesPlayed: { $gt: 0 } })
    .sort({ elo: -1 })
    .limit(limit)
    .toArray();
  
  return players.map(p => ({
    ...p,
    rank: getRank(p.elo),
    kdr: p.totalDeaths > 0 
      ? (p.totalKills / p.totalDeaths).toFixed(2) 
      : (p.totalKills || 0).toFixed(2)
  }));
}

// ===========================================
// MIGRATION: Import from JSON files
// ===========================================

async function migrateFromJSON(playersData, matchesData, linksData) {
  const database = await connectDB();
  
  // Import players
  if (playersData && Object.keys(playersData).length > 0) {
    const players = Object.values(playersData);
    for (const player of players) {
      await database.collection('players').updateOne(
        { odiscordId: player.odiscordId },
        { $set: player },
        { upsert: true }
      );
    }
    console.log(`Migrated ${players.length} players`);
  }
  
  // Import matches
  if (matchesData && matchesData.length > 0) {
    for (const match of matchesData) {
      await database.collection('matches').updateOne(
        { id: match.id },
        { $set: match },
        { upsert: true }
      );
    }
    console.log(`Migrated ${matchesData.length} matches`);
  }
  
  // Import minecraft links
  if (linksData && linksData.byDiscord) {
    for (const [discordId, data] of Object.entries(linksData.byDiscord)) {
      await database.collection('minecraft_links').updateOne(
        { odiscordId: discordId },
        { $set: { odiscordId: discordId, uuid: data.uuid, username: data.username } },
        { upsert: true }
      );
    }
    console.log(`Migrated minecraft links`);
  }
}

module.exports = {
  connectDB,
  getLeaderboard,
  getPlayer,
  getOrCreatePlayer,
  updatePlayer,
  getAllPlayers,
  processMatchResult,
  getRank,
  setUserSession,
  getUserSession,
  clearUserSession,
  clearLobbySession,
  getPlayerMatches,
  getRecentMatches,
  saveMatch,
  clearAllMatches,
  linkMinecraft,
  getMinecraftByDiscord,
  getDiscordByMinecraft,
  unlinkMinecraft,
  migrateFromJSON
};
