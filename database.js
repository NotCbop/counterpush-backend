const fs = require('fs');
const path = require('path');
const CONFIG = require('./config');

const DB_PATH = path.join(__dirname, 'data', 'players.json');
const SESSIONS_PATH = path.join(__dirname, 'data', 'sessions.json');
const MATCHES_PATH = path.join(__dirname, 'data', 'matches.json');
const LINKS_PATH = path.join(__dirname, 'data', 'minecraft_links.json');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ===========================================
// LOAD AND SAVE
// ===========================================

function loadDatabase() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading database:', error);
  }
  return {};
}

function saveDatabase(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving database:', error);
  }
}

// ===========================================
// MINECRAFT LINKS
// ===========================================

function loadLinks() {
  try {
    if (fs.existsSync(LINKS_PATH)) {
      const data = fs.readFileSync(LINKS_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading links:', error);
  }
  return { byDiscord: {}, byUUID: {} };
}

function saveLinks(data) {
  try {
    fs.writeFileSync(LINKS_PATH, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving links:', error);
  }
}

function linkMinecraft(odiscordId, uuid, username) {
  const links = loadLinks();
  links.byDiscord[odiscordId] = { uuid, username };
  links.byUUID[uuid] = { odiscordId, username };
  saveLinks(links);
}

function getMinecraftByDiscord(odiscordId) {
  const links = loadLinks();
  return links.byDiscord[odiscordId] || null;
}

function getDiscordByMinecraft(uuid) {
  const links = loadLinks();
  return links.byUUID[uuid] || null;
}

function unlinkMinecraft(odiscordId) {
  const links = loadLinks();
  const link = links.byDiscord[odiscordId];
  if (link) {
    delete links.byUUID[link.uuid];
    delete links.byDiscord[odiscordId];
    saveLinks(links);
    return true;
  }
  return false;
}

// ===========================================
// SESSIONS
// ===========================================

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_PATH)) {
      const data = fs.readFileSync(SESSIONS_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading sessions:', error);
  }
  return {};
}

function saveSessions(data) {
  try {
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving sessions:', error);
  }
}

function setUserSession(odiscordId, lobbyId) {
  const sessions = loadSessions();
  sessions[odiscordId] = { lobbyId, updatedAt: Date.now() };
  saveSessions(sessions);
}

function getUserSession(odiscordId) {
  const sessions = loadSessions();
  return sessions[odiscordId] || null;
}

function clearUserSession(odiscordId) {
  const sessions = loadSessions();
  delete sessions[odiscordId];
  saveSessions(sessions);
}

function clearLobbySession(lobbyId) {
  const sessions = loadSessions();
  for (const odiscordId of Object.keys(sessions)) {
    if (sessions[odiscordId].lobbyId === lobbyId) {
      delete sessions[odiscordId];
    }
  }
  saveSessions(sessions);
}

// ===========================================
// MATCHES
// ===========================================

function loadMatches() {
  try {
    if (fs.existsSync(MATCHES_PATH)) {
      const data = fs.readFileSync(MATCHES_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading matches:', error);
  }
  return [];
}

function saveMatches(data) {
  try {
    fs.writeFileSync(MATCHES_PATH, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving matches:', error);
  }
}

function saveMatch(matchData) {
  const matches = loadMatches();
  const match = {
    id: `M${Date.now()}`,
    timestamp: Date.now(),
    date: new Date().toISOString(),
    ...matchData
  };
  matches.unshift(match);
  // Keep only last 1000 matches
  if (matches.length > 1000) {
    matches.length = 1000;
  }
  saveMatches(matches);
  return match;
}

function getPlayerMatches(odiscordId, limit = 10) {
  const matches = loadMatches();
  return matches
    .filter(m => 
      m.winners?.some(p => p.odiscordId === odiscordId) ||
      m.losers?.some(p => p.odiscordId === odiscordId)
    )
    .slice(0, limit);
}

function getRecentMatches(limit = 20) {
  const matches = loadMatches();
  return matches.slice(0, limit);
}

function clearAllMatches() {
  saveMatches([]);
  console.log('All matches cleared');
}

// ===========================================
// PLAYER MANAGEMENT
// ===========================================

function getPlayer(odiscordId) {
  const db = loadDatabase();
  const player = db[odiscordId];
  
  if (!player) return null;
  
  player.rank = getRank(player.elo);
  player.kdr = player.totalDeaths > 0 
    ? (player.totalKills / player.totalDeaths).toFixed(2) 
    : (player.totalKills || 0).toFixed(2);
  
  // Add Minecraft info
  const mcLink = getMinecraftByDiscord(odiscordId);
  if (mcLink) {
    player.minecraftUuid = mcLink.uuid;
    player.minecraftUsername = mcLink.username;
  }
  
  return player;
}

function getOrCreatePlayer(odiscordId, username, avatar) {
  const db = loadDatabase();
  
  if (!db[odiscordId]) {
    db[odiscordId] = {
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
    saveDatabase(db);
  } else {
    // Update username and avatar
    db[odiscordId].username = username;
    db[odiscordId].avatar = avatar;
    
    // Ensure classStats exists for older players
    if (!db[odiscordId].classStats) {
      db[odiscordId].classStats = {
        Tank: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 },
        Brawler: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 },
        Sniper: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 },
        Trickster: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 },
        Support: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 }
      };
    }
    saveDatabase(db);
  }
  
  const player = db[odiscordId];
  player.rank = getRank(player.elo);
  player.kdr = player.totalDeaths > 0 
    ? (player.totalKills / player.totalDeaths).toFixed(2) 
    : (player.totalKills || 0).toFixed(2);
  
  return player;
}

function updatePlayer(odiscordId, data) {
  const db = loadDatabase();
  if (db[odiscordId]) {
    Object.assign(db[odiscordId], data);
    saveDatabase(db);
  }
}

function getAllPlayers() {
  const db = loadDatabase();
  const links = loadLinks();
  
  return Object.values(db).map(p => {
    const mcLink = links.byDiscord[p.odiscordId];
    return {
      ...p,
      rank: getRank(p.elo),
      kdr: p.totalDeaths > 0 
        ? (p.totalKills / p.totalDeaths).toFixed(2) 
        : (p.totalKills || 0).toFixed(2),
      minecraftUuid: mcLink?.uuid || null,
      minecraftUsername: mcLink?.username || null
    };
  });
}

// ===========================================
// ELO CALCULATION (Team Average Based)
// ===========================================

function calculateTeamAverageElo(team) {
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

function processMatchResult(winnerIds, loserIds, lobbyId) {
  const db = loadDatabase();
  
  // Get all players
  const winners = winnerIds.map(id => getPlayer(id)).filter(p => p);
  const losers = loserIds.map(id => getPlayer(id)).filter(p => p);
  
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
    
    updatePlayer(player.odiscordId, {
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
    
    updatePlayer(player.odiscordId, {
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
  
  // NOTE: Don't save match here - caller will add stats and save
  
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

function getLeaderboard(limit = 50) {
  const db = loadDatabase();
  const players = Object.values(db)
    .filter(p => p.gamesPlayed > 0)
    .sort((a, b) => b.elo - a.elo)
    .slice(0, limit)
    .map(p => ({
      ...p,
      rank: getRank(p.elo),
      kdr: p.totalDeaths > 0 
        ? (p.totalKills / p.totalDeaths).toFixed(2) 
        : (p.totalKills || 0).toFixed(2)
    }));
  
  return players;
}

module.exports = {
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
  unlinkMinecraft
};
