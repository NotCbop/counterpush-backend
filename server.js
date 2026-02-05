const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const CONFIG = require('./config');
const db = require('./database');

// ===========================================
// EXPRESS SERVER
// ===========================================

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: CONFIG.FRONTEND_URL,
  credentials: true
}));
app.use(express.json());

// ===========================================
// SOCKET.IO
// ===========================================

const io = new Server(server, {
  cors: {
    origin: CONFIG.FRONTEND_URL,
    methods: ['GET', 'POST']
  }
});

// ===========================================
// DISCORD BOT
// ===========================================

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

discordClient.once('ready', () => {
  console.log(`Discord bot logged in as ${discordClient.user.tag}`);
});

// ===========================================
// HELPER: Check if user is in draft voice channel
// ===========================================

async function isUserInDraftChannel(odiscordId) {
  if (!discordClient.isReady()) return false;
  
  try {
    const guild = discordClient.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) return false;
    
    const member = await guild.members.fetch(odiscordId).catch(() => null);
    if (!member) return false;
    
    return member.voice?.channelId === CONFIG.DRAFT_CHANNEL_ID;
  } catch (e) {
    console.error('Error checking voice channel:', e);
    return false;
  }
}

// ===========================================
// HELPER: Update player's rank role
// ===========================================

async function updatePlayerRankRole(odiscordId, newRank) {
  if (!discordClient.isReady()) {
    console.log('Discord bot not ready, skipping role update');
    return;
  }
  
  try {
    const guild = discordClient.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) {
      console.log('Guild not found, skipping role update');
      return;
    }
    
    const member = await guild.members.fetch(odiscordId).catch(() => null);
    if (!member) {
      console.log(`Member ${odiscordId} not found, skipping role update`);
      return;
    }
    
    // Get all rank role IDs
    const allRankRoleIds = Object.values(CONFIG.RANK_ROLES);
    
    // Remove all existing rank roles
    const rolesToRemove = member.roles.cache.filter(role => allRankRoleIds.includes(role.id));
    for (const [roleId, role] of rolesToRemove) {
      await member.roles.remove(role).catch(e => console.error('Error removing role:', e));
    }
    
    // Add the new rank role
    const newRoleId = CONFIG.RANK_ROLES[newRank];
    if (newRoleId) {
      await member.roles.add(newRoleId).catch(e => console.error('Error adding role:', e));
      console.log(`Updated ${member.user.username}'s rank role to ${newRank}`);
    }
  } catch (e) {
    console.error('Error updating rank role:', e);
  }
}

// ===========================================
// LOBBY MANAGEMENT
// ===========================================

const lobbies = new Map();

function generateLobbyCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function createLobby(hostId, hostData, maxPlayers = CONFIG.MAX_PLAYERS) {
  const code = generateLobbyCode();
  
  const host = db.getOrCreatePlayer(hostId, hostData.username, hostData.avatar);
  
  const lobby = {
    id: code,
    host: host,
    phase: 'waiting',
    players: [host],
    captains: [],
    teams: { team1: [], team2: [] },
    currentTurn: null,
    picksLeft: 1,
    score: { team1: 0, team2: 0 },
    maxPlayers: maxPlayers,
    createdAt: Date.now()
  };
  
  lobbies.set(code, lobby);
  db.setUserSession(hostId, code);
  
  console.log(`Lobby ${code} created by ${hostData.username}`);
  return lobby;
}

function getLobby(code) {
  return lobbies.get(code) || null;
}

function deleteLobby(code) {
  db.clearLobbySession(code);
  lobbies.delete(code);
}

// ===========================================
// API ROUTES
// ===========================================

app.get('/api/leaderboard', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const leaderboard = db.getLeaderboard(limit);
  res.json(leaderboard);
});

app.get('/api/players/:odiscordId', (req, res) => {
  const player = db.getPlayer(req.params.odiscordId);
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }
  res.json(player);
});

app.get('/api/lobby/:code', (req, res) => {
  const lobby = getLobby(req.params.code.toUpperCase());
  if (!lobby) {
    return res.status(404).json({ error: 'Lobby not found' });
  }
  res.json(lobby);
});

app.get('/api/session/:odiscordId', (req, res) => {
  const session = db.getUserSession(req.params.odiscordId);
  if (session) {
    const lobby = getLobby(session.lobbyId);
    if (lobby) {
      return res.json({ lobbyId: session.lobbyId, lobby });
    }
  }
  res.json({ lobbyId: null });
});

// ===========================================
// SOCKET.IO HANDLERS
// ===========================================

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('checkSession', ({ odiscordId }) => {
    const session = db.getUserSession(odiscordId);
    if (session) {
      const lobby = getLobby(session.lobbyId);
      if (lobby) {
        socket.join(session.lobbyId);
        socket.lobbyId = session.lobbyId;
        socket.odiscordId = odiscordId;
        socket.emit('rejoinedLobby', lobby);
        return;
      }
    }
    socket.emit('noSession');
  });

  socket.on('createLobby', async ({ userData, maxPlayers, testMode }) => {
    console.log('createLobby called:', { userData: userData.username, maxPlayers, testMode });
    
    // Voice channel check disabled - enable SERVER MEMBERS INTENT in Discord Developer Portal to use it
    // if (!testMode) {
    //   if (!discordClient.isReady()) {
    //     socket.emit('error', { message: 'Discord bot is not connected. Try Test Mode or wait a moment.' });
    //     return;
    //   }
    //   const inChannel = await isUserInDraftChannel(userData.odiscordId);
    //   if (!inChannel) {
    //     socket.emit('error', { message: 'You must be in the draft voice channel to create a lobby' });
    //     return;
    //   }
    // }
    
    const lobby = createLobby(userData.odiscordId, userData, maxPlayers || CONFIG.MAX_PLAYERS);
    lobby.testMode = testMode || false;
    
    socket.join(lobby.id);
    socket.lobbyId = lobby.id;
    socket.odiscordId = userData.odiscordId;
    socket.emit('lobbyCreated', lobby);
    console.log('Lobby created:', lobby.id);
  });

  socket.on('joinLobby', async ({ code, userData, testMode }) => {
    const lobby = getLobby(code.toUpperCase());
    
    if (!lobby) {
      socket.emit('error', { message: 'Lobby not found' });
      return;
    }

    if (lobby.phase !== 'waiting') {
      const existingPlayer = lobby.players.find(p => p.odiscordId === userData.odiscordId);
      if (existingPlayer) {
        socket.join(lobby.id);
        socket.lobbyId = lobby.id;
        socket.odiscordId = userData.odiscordId;
        socket.emit('lobbyJoined', lobby);
        return;
      }
      socket.emit('error', { message: 'Game already started' });
      return;
    }

    if (lobby.players.length >= lobby.maxPlayers) {
      socket.emit('error', { message: 'Lobby is full' });
      return;
    }

    if (lobby.players.find(p => p.odiscordId === userData.odiscordId)) {
      socket.join(lobby.id);
      socket.lobbyId = lobby.id;
      socket.odiscordId = userData.odiscordId;
      socket.emit('lobbyJoined', lobby);
      return;
    }

    // Voice channel check disabled
    // if (!lobby.testMode && !testMode) {
    //   const inChannel = await isUserInDraftChannel(userData.odiscordId);
    //   if (!inChannel) {
    //     socket.emit('error', { message: 'You must be in the draft voice channel to join' });
    //     return;
    //   }
    // }

    const player = db.getOrCreatePlayer(userData.odiscordId, userData.username, userData.avatar);
    lobby.players.push(player);
    
    // Assign initial rank role if this is a new player
    if (!lobby.testMode && !testMode && player.gamesPlayed === 0) {
      updatePlayerRankRole(userData.odiscordId, player.rank);
    }
    
    db.setUserSession(userData.odiscordId, lobby.id);
    
    socket.join(lobby.id);
    socket.lobbyId = lobby.id;
    socket.odiscordId = userData.odiscordId;

    socket.emit('lobbyJoined', lobby);
    io.to(lobby.id).emit('lobbyUpdate', lobby);
    
    console.log(`${userData.username} joined lobby ${lobby.id}`);
  });

  socket.on('startCaptainSelect', ({ lobbyId }) => {
    const lobby = getLobby(lobbyId);
    
    if (!lobby) {
      socket.emit('error', { message: 'Lobby not found' });
      return;
    }

    if (socket.odiscordId !== lobby.host.odiscordId) {
      socket.emit('error', { message: 'Only the host can start the game' });
      return;
    }

    if (lobby.players.length < 4) {
      socket.emit('error', { message: 'Need at least 4 players to start' });
      return;
    }

    lobby.phase = 'captain-select';
    io.to(lobby.id).emit('lobbyUpdate', lobby);
  });

  socket.on('selectCaptain', ({ lobbyId, odiscordId }) => {
    const lobby = getLobby(lobbyId);
    
    if (!lobby) {
      socket.emit('error', { message: 'Lobby not found' });
      return;
    }

    if (socket.odiscordId !== lobby.host.odiscordId) {
      socket.emit('error', { message: 'Only the host can select captains' });
      return;
    }

    if (lobby.phase !== 'captain-select') {
      socket.emit('error', { message: 'Not in captain selection phase' });
      return;
    }

    if (lobby.captains.length >= 2) {
      socket.emit('error', { message: 'Already have 2 captains' });
      return;
    }

    if (lobby.captains.find(c => c.odiscordId === odiscordId)) {
      socket.emit('error', { message: 'Player is already a captain' });
      return;
    }

    const player = lobby.players.find(p => p.odiscordId === odiscordId);
    if (!player) {
      socket.emit('error', { message: 'Player not found' });
      return;
    }

    lobby.captains.push(player);

    if (lobby.captains.length === 1) {
      lobby.teams.team1.push(player);
    } else {
      lobby.teams.team2.push(player);
      lobby.phase = 'drafting';
      lobby.currentTurn = Math.random() < 0.5 ? 'team1' : 'team2';
      lobby.picksLeft = 1;
    }

    io.to(lobby.id).emit('lobbyUpdate', lobby);
  });

  socket.on('draftPick', ({ lobbyId, odiscordId }) => {
    const lobby = getLobby(lobbyId);
    
    if (!lobby) {
      socket.emit('error', { message: 'Lobby not found' });
      return;
    }

    if (lobby.phase !== 'drafting') {
      socket.emit('error', { message: 'Not in draft phase' });
      return;
    }

    const currentCaptain = lobby.currentTurn === 'team1' 
      ? lobby.teams.team1[0] 
      : lobby.teams.team2[0];

    if (socket.odiscordId !== currentCaptain.odiscordId) {
      socket.emit('error', { message: 'Not your turn to pick' });
      return;
    }

    const player = lobby.players.find(p => p.odiscordId === odiscordId);
    if (!player) {
      socket.emit('error', { message: 'Player not found' });
      return;
    }

    if (lobby.captains.find(c => c.odiscordId === odiscordId)) {
      socket.emit('error', { message: 'Cannot pick a captain' });
      return;
    }

    if (lobby.teams.team1.find(p => p.odiscordId === odiscordId) ||
        lobby.teams.team2.find(p => p.odiscordId === odiscordId)) {
      socket.emit('error', { message: 'Player already drafted' });
      return;
    }

    lobby.teams[lobby.currentTurn].push(player);
    lobby.picksLeft--;

    if (lobby.picksLeft === 0) {
      lobby.currentTurn = lobby.currentTurn === 'team1' ? 'team2' : 'team1';
      lobby.picksLeft = 2;
    }

    const totalDrafted = lobby.teams.team1.length + lobby.teams.team2.length;
    
    if (totalDrafted >= lobby.players.length) {
      lobby.phase = 'playing';
      lobby.currentTurn = null;
      movePlayersToVoice(lobby);
    }

    io.to(lobby.id).emit('lobbyUpdate', lobby);
  });

  socket.on('addScore', ({ lobbyId, team }) => {
    const lobby = getLobby(lobbyId);
    
    if (!lobby) {
      socket.emit('error', { message: 'Lobby not found' });
      return;
    }

    if (lobby.phase !== 'playing') {
      socket.emit('error', { message: 'Match not in progress' });
      return;
    }

    const isHost = socket.odiscordId === lobby.host.odiscordId;
    
    if (!isHost) {
      socket.emit('error', { message: 'Only the host can add scores' });
      return;
    }

    lobby.score[team]++;

    if (lobby.score.team1 >= 2 || lobby.score.team2 >= 2) {
      lobby.phase = 'finished';

      const winnerTeam = lobby.score.team1 >= 2 ? 'team1' : 'team2';
      const winnerIds = lobby.teams[winnerTeam].map(p => p.odiscordId);
      const loserIds = lobby.teams[winnerTeam === 'team1' ? 'team2' : 'team1'].map(p => p.odiscordId);

      const results = db.processMatchResult(winnerIds, loserIds);
      lobby.eloResults = results;

      // Update rank roles for all players
      for (const player of [...results.winners, ...results.losers]) {
        const newRank = db.getRank(player.newElo);
        const oldRank = db.getRank(player.oldElo);
        // Only update if rank changed
        if (newRank !== oldRank) {
          updatePlayerRankRole(player.odiscordId, newRank);
        }
      }

      movePlayersBack(lobby);
      sendMatchResultToDiscord(lobby, results);
    }

    io.to(lobby.id).emit('lobbyUpdate', lobby);
  });

  // Host declares a winner directly
  socket.on('declareWinner', ({ lobbyId, winnerTeam }) => {
    const lobby = getLobby(lobbyId);
    
    if (!lobby) {
      socket.emit('error', { message: 'Lobby not found' });
      return;
    }

    if (lobby.phase !== 'playing') {
      socket.emit('error', { message: 'Match not in progress' });
      return;
    }

    const isHost = socket.odiscordId === lobby.host.odiscordId;
    
    if (!isHost) {
      socket.emit('error', { message: 'Only the host can declare the winner' });
      return;
    }

    lobby.phase = 'finished';
    lobby.score[winnerTeam] = 2;
    lobby.score[winnerTeam === 'team1' ? 'team2' : 'team1'] = 0;

    const winnerIds = lobby.teams[winnerTeam].map(p => p.odiscordId);
    const loserIds = lobby.teams[winnerTeam === 'team1' ? 'team2' : 'team1'].map(p => p.odiscordId);

    const results = db.processMatchResult(winnerIds, loserIds);
    lobby.eloResults = results;

    // Update rank roles for all players
    for (const player of [...results.winners, ...results.losers]) {
      const newRank = db.getRank(player.newElo);
      const oldRank = db.getRank(player.oldElo);
      if (newRank !== oldRank) {
        updatePlayerRankRole(player.odiscordId, newRank);
      }
    }

    movePlayersBack(lobby);
    sendMatchResultToDiscord(lobby, results);

    io.to(lobby.id).emit('lobbyUpdate', lobby);
  });

  socket.on('leaveLobby', ({ lobbyId }) => {
    const lobby = getLobby(lobbyId);
    
    if (!lobby) return;

    if (lobby.phase !== 'waiting') {
      socket.emit('error', { message: 'Cannot leave after game started' });
      return;
    }

    if (socket.odiscordId === lobby.host.odiscordId) {
      io.to(lobbyId).emit('lobbyClosed', { reason: 'Host left the lobby' });
      deleteLobby(lobbyId);
      return;
    }

    lobby.players = lobby.players.filter(p => p.odiscordId !== socket.odiscordId);
    db.clearUserSession(socket.odiscordId);
    
    socket.leave(lobbyId);
    io.to(lobbyId).emit('lobbyUpdate', lobby);
  });

  socket.on('closeLobby', ({ lobbyId }) => {
    const lobby = getLobby(lobbyId);
    
    if (!lobby) return;

    if (socket.odiscordId !== lobby.host.odiscordId) {
      socket.emit('error', { message: 'Only the host can close the lobby' });
      return;
    }

    io.to(lobbyId).emit('lobbyClosed', { reason: 'Host closed the lobby' });
    deleteLobby(lobbyId);
  });

  socket.on('resetLobby', ({ lobbyId }) => {
    const lobby = getLobby(lobbyId);
    
    if (!lobby) return;

    if (socket.odiscordId !== lobby.host.odiscordId) {
      socket.emit('error', { message: 'Only the host can reset the lobby' });
      return;
    }

    lobby.phase = 'waiting';
    lobby.captains = [];
    lobby.teams = { team1: [], team2: [] };
    lobby.currentTurn = null;
    lobby.picksLeft = 1;
    lobby.score = { team1: 0, team2: 0 };
    lobby.eloResults = null;

    io.to(lobbyId).emit('lobbyUpdate', lobby);
  });

  socket.on('kickPlayer', ({ lobbyId, odiscordId }) => {
    const lobby = getLobby(lobbyId);
    
    if (!lobby) return;

    if (socket.odiscordId !== lobby.host.odiscordId) {
      socket.emit('error', { message: 'Only the host can kick players' });
      return;
    }

    if (lobby.phase !== 'waiting') {
      socket.emit('error', { message: 'Cannot kick after game started' });
      return;
    }

    if (odiscordId === lobby.host.odiscordId) {
      socket.emit('error', { message: 'Cannot kick yourself' });
      return;
    }

    lobby.players = lobby.players.filter(p => p.odiscordId !== odiscordId);
    db.clearUserSession(odiscordId);
    
    io.to(lobbyId).emit('playerKicked', { odiscordId });
    io.to(lobbyId).emit('lobbyUpdate', lobby);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// ===========================================
// DISCORD VOICE HELPERS
// ===========================================

async function movePlayersToVoice(lobby) {
  if (!discordClient.isReady() || lobby.testMode) return;

  const guild = discordClient.guilds.cache.get(CONFIG.GUILD_ID);
  if (!guild) return;

  for (const player of lobby.teams.team1) {
    try {
      const member = await guild.members.fetch(player.odiscordId).catch(() => null);
      if (member && member.voice.channel) {
        await member.voice.setChannel(CONFIG.TEAM_1_VOICE_CHANNEL_ID);
      }
    } catch (e) {
      console.error('Error moving player:', e.message);
    }
  }

  for (const player of lobby.teams.team2) {
    try {
      const member = await guild.members.fetch(player.odiscordId).catch(() => null);
      if (member && member.voice.channel) {
        await member.voice.setChannel(CONFIG.TEAM_2_VOICE_CHANNEL_ID);
      }
    } catch (e) {
      console.error('Error moving player:', e.message);
    }
  }
}

async function movePlayersBack(lobby) {
  if (!discordClient.isReady() || lobby.testMode) return;

  const guild = discordClient.guilds.cache.get(CONFIG.GUILD_ID);
  if (!guild) return;

  const allPlayers = [...lobby.teams.team1, ...lobby.teams.team2];

  for (const player of allPlayers) {
    try {
      const member = await guild.members.fetch(player.odiscordId).catch(() => null);
      if (member && member.voice.channel) {
        await member.voice.setChannel(CONFIG.DRAFT_CHANNEL_ID);
      }
    } catch (e) {
      console.error('Error moving player back:', e.message);
    }
  }
}

async function sendMatchResultToDiscord(lobby, results) {
  if (!discordClient.isReady() || lobby.testMode) return;

  const guild = discordClient.guilds.cache.get(CONFIG.GUILD_ID);
  if (!guild) return;

  const winnerTeam = lobby.score.team1 >= 2 ? 'Team 1' : 'Team 2';
  const winnerColor = lobby.score.team1 >= 2 ? 0x3b82f6 : 0xef4444;

  let eloChanges = '';
  for (const r of results.winners) {
    eloChanges += `${r.username}: ${r.oldElo} → ${r.newElo} (+${r.change})\n`;
  }
  for (const r of results.losers) {
    eloChanges += `${r.username}: ${r.oldElo} → ${r.newElo} (${r.change})\n`;
  }

  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${winnerTeam} Wins!`)
    .setDescription(`**Lobby ${lobby.id}**\n**Score: ${lobby.score.team1} - ${lobby.score.team2}**`)
    .addFields(
      {
        name: 'Team 1',
        value: lobby.teams.team1.map(p => `<@${p.odiscordId}>`).join('\n'),
        inline: true
      },
      {
        name: 'Team 2',
        value: lobby.teams.team2.map(p => `<@${p.odiscordId}>`).join('\n'),
        inline: true
      },
      {
        name: 'ELO Changes',
        value: eloChanges || 'No changes',
        inline: false
      }
    )
    .setColor(winnerColor);

  const channel = guild.channels.cache.find(c => c.name === 'match-results' || c.name === 'general');
  if (channel) {
    channel.send({ embeds: [embed] });
  }
}

// ===========================================
// START SERVER
// ===========================================

server.listen(CONFIG.PORT, () => {
  console.log(`Server running on port ${CONFIG.PORT}`);
});

if (CONFIG.BOT_TOKEN && CONFIG.BOT_TOKEN !== 'YOUR_BOT_TOKEN_HERE') {
  discordClient.login(CONFIG.BOT_TOKEN);
} else {
  console.log('Discord bot token not configured - running without Discord integration');
}
