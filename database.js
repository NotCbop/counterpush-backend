const fs = require('fs');
const path = require('path');
const CONFIG = require('./config');

const DB_PATH = path.join(__dirname, 'data', 'players.json');
const SESSIONS_PATH = path.join(__dirname, 'data', 'sessions.json');

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
// PLAYER MANAGEMENT
// ===========================================

function getPlayer(odiscordId) {
  const db = loadDatabase();
  
  if (!db[odiscordId]) {
    return null;
  }
  
  const player = db[odiscordId];
  player.rank = getRank(player.elo);
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
      createdAt: Date.now()
    };
  } else {
    db[odiscordId].username = username;
    db[odiscordId].avatar = avatar;
  }
  
  saveDatabase(db);
  const player = db[odiscordId];
  player.rank = getRank(player.elo);
  return player;
}

function updatePlayer(odiscordId, data) {
  const db = loadDatabase();
  db[odiscordId] = { ...db[odiscordId], ...data };
  saveDatabase(db);
  return db[odiscordId];
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

function processMatchResult(winnerIds, loserIds) {
  const winnerAvgElo = getTeamAverageElo(winnerIds);
  const loserAvgElo = getTeamAverageElo(loserIds);
  
  const results = {
    winners: [],
    losers: []
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
      oldElo,
      newElo,
      change: newElo - oldElo
    });
  }
  
  saveDatabase(db);
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

function getLeaderboard(limit = 10) {
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
  processMatchResult,
  getRank,
  getLeaderboard,
  getTeamAverageElo,
  setUserSession,
  getUserSession,
  clearUserSession,
  clearLobbySession
};
