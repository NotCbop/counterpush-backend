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

function linkMinecraft(discordId, uuid, username) {
  const links = loadLinks();
  
  // Remove old links if they exist
  if (links.byDiscord[discordId]) {
    const oldUUID = links.byDiscord[discordId].uuid;
    delete links.byUUID[oldUUID];
  }
  if (links.byUUID[uuid]) {
    const oldDiscord = links.byUUID[uuid].discordId;
    delete links.byDiscord[oldDiscord];
  }
  
  // Create new link
  links.byDiscord[discordId] = { uuid, username, linkedAt: Date.now() };
  links.byUUID[uuid] = { discordId, username, linkedAt: Date.now() };
  
  saveLinks(links);
  return true;
}

function getMinecraftByDiscord(discordId) {
  const links = loadLinks();
  return links.byDiscord[discordId] || null;
}

function getDiscordByMinecraft(uuid) {
  const links = loadLinks();
  return links.byUUID[uuid] || null;
}

function unlinkMinecraft(discordId) {
  const links = loadLinks();
  if (links.byDiscord[discordId]) {
    const uuid = links.byDiscord[discordId].uuid;
    delete links.byUUID[uuid];
    delete links.byDiscord[discordId];
    saveLinks(links);
    return true;
  }
  return false;
}

// ===========================================
// SESSION MANAGEMENT
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
  sessions[odiscordId] = { lobbyId, timestamp: Date.now() };
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
// MATCH HISTORY
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
  matches.unshift(match); // Add to beginning (newest first)
  
  // Keep only last 1000 matches
  if (matches.length > 1000) {
    matches.pop();
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

// ===========================================
// PLAYER MANAGEMENT
// ===========================================

function getPlayer(odiscordId) {
  const db = loadDatabase();
  
  if (!db[odiscordId]) {
    return null;
  }
  
  const player = db[odiscordId];
  player.rank = getRank(player.elo);
  // Calculate KDR
  player.kdr = player.totalDeaths > 0 
    ? (player.totalKills / player.totalDeaths).toFixed(2) 
    : player.totalKills?.toFixed(2) || '0.00';
  return player;
}

function getOrCreatePlayer(odiscordId, username, avatar) {
  const db = loadDatabase();
  
  if (!db[odiscordId]) {
    db[odiscordId] = {
      odiscordId: odiscordId,
      username,
      avatar,
      elo: CONFIG.STARTING_ELO,
      wins: 0,
      losses: 0,
      gamesPlayed: 0,
      // Lifetime stats
      totalKills: 0,
      totalDeaths: 0,
      totalAssists: 0,
      totalDamage: 0,
      totalHealing: 0,
      createdAt: Date.now()
    };
  } else {
    db[odiscordId].username = username;
    db[odiscordId].avatar = avatar;
    // Ensure stats exist for older players
    if (db[odiscordId].totalKills === undefined) {
      db[odiscordId].totalKills = 0;
      db[odiscordId].totalDeaths = 0;
      db[odiscordId].totalAssists = 0;
      db[odiscordId].totalDamage = 0;
      db[odiscordId].totalHealing = 0;
    }
  }
  
  saveDatabase(db);
  const player = db[odiscordId];
  player.rank = getRank(player.elo);
  player.kdr = player.totalDeaths > 0 
    ? (player.totalKills / player.totalDeaths).toFixed(2) 
    : player.totalKills?.toFixed(2) || '0.00';
  return player;
}

function updatePlayer(odiscordId, data) {
  const db = loadDatabase();
  db[odiscordId] = { ...db[odiscordId], ...data };
  saveDatabase(db);
  return db[odiscordId];
}

function getAllPlayers() {
  const db = loadDatabase();
  return Object.values(db).map(p => ({
    ...p,
    rank: getRank(p.elo)
  }));
}

// ===========================================
// ELO CALCULATIONS
// ===========================================

function calculateExpectedScore(playerElo, opponentElo) {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
}

function calculateNewElo(playerElo, opponentElo, won) {
  const expected = calculateExpectedScore(playerElo, opponentElo);
  const actual = won ? 1 : 0;
  return Math.round(playerElo + CONFIG.K_FACTOR * (actual - expected));
}

function getTeamAverageElo(playerIds) {
  const db = loadDatabase();
  let totalElo = 0;
  let count = 0;
  
  for (const odiscordId of playerIds) {
    if (db[odiscordId]) {
      totalElo += db[odiscordId].elo;
      count++;
    } else {
      totalElo += CONFIG.STARTING_ELO;
      count++;
    }
  }
  
  return count > 0 ? Math.round(totalElo / count) : CONFIG.STARTING_ELO;
}

// ===========================================
// PROCESS MATCH RESULT
// ===========================================

function processMatchResult(winnerIds, loserIds, lobbyId) {
  const winnerAvgElo = getTeamAverageElo(winnerIds);
  const loserAvgElo = getTeamAverageElo(loserIds);
  
  const results = {
    winners: [],
    losers: [],
    lobbyId
  };
  
  const db = loadDatabase();
  
  for (const odiscordId of winnerIds) {
    if (!db[odiscordId]) continue;
    
    const oldElo = db[odiscordId].elo;
    const newElo = calculateNewElo(oldElo, loserAvgElo, true);
    
    db[odiscordId].elo = newElo;
    db[odiscordId].wins = (db[odiscordId].wins || 0) + 1;
    db[odiscordId].gamesPlayed = (db[odiscordId].gamesPlayed || 0) + 1;
    
    results.winners.push({
      odiscordId,
      username: db[odiscordId].username,
      avatar: db[odiscordId].avatar,
      oldElo,
      newElo,
      change: newElo - oldElo
    });
  }
  
  for (const odiscordId of loserIds) {
    if (!db[odiscordId]) continue;
    
    const oldElo = db[odiscordId].elo;
    const newElo = calculateNewElo(oldElo, winnerAvgElo, false);
    
    db[odiscordId].elo = newElo;
    db[odiscordId].losses = (db[odiscordId].losses || 0) + 1;
    db[odiscordId].gamesPlayed = (db[odiscordId].gamesPlayed || 0) + 1;
    
    results.losers.push({
      odiscordId,
      username: db[odiscordId].username,
      avatar: db[odiscordId].avatar,
      oldElo,
      newElo,
      change: newElo - oldElo
    });
  }
  
  saveDatabase(db);
  
  // Save match to history
  saveMatch(results);
  
  return results;
}

// ===========================================
// RANK HELPERS
// ===========================================

function getRank(elo) {
  if (elo >= CONFIG.RANKS.S) return 'S';
  if (elo >= CONFIG.RANKS.A) return 'A';
  if (elo >= CONFIG.RANKS.B) return 'B';
  if (elo >= CONFIG.RANKS.C) return 'C';
  if (elo >= CONFIG.RANKS.D) return 'D';
  return 'F';
}

// ===========================================
// LEADERBOARD
// ===========================================

function getLeaderboard(limit = 50) {
  const db = loadDatabase();
  const players = Object.values(db);
  
  return players
    .filter(p => p.gamesPlayed > 0)
    .sort((a, b) => b.elo - a.elo)
    .slice(0, limit)
    .map(p => ({
      ...p,
      rank: getRank(p.elo)
    }));
}

module.exports = {
  getPlayer,
  getOrCreatePlayer,
  updatePlayer,
  getAllPlayers,
  processMatchResult,
  getRank,
  getLeaderboard,
  getTeamAverageElo,
  setUserSession,
  getUserSession,
  clearUserSession,
  clearLobbySession,
  getPlayerMatches,
  getRecentMatches,
  saveMatch,
  // Minecraft linking
  linkMinecraft,
  getMinecraftByDiscord,
  getDiscordByMinecraft,
  unlinkMinecraft
};
