const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Client, GatewayIntentBits, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
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
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

discordClient.once('ready', () => {
  console.log(`Discord bot logged in as ${discordClient.user.tag}`);
});

// ===========================================
// HELPER: Update player's rank role
// ===========================================

async function updatePlayerRankRole(odiscordId, newRank) {
  if (!discordClient.isReady()) return;
  
  try {
    const guild = discordClient.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) return;
    
    const member = await guild.members.fetch(odiscordId).catch(() => null);
    if (!member) return;
    
    const allRankRoleIds = Object.values(CONFIG.RANK_ROLES);
    const rolesToRemove = member.roles.cache.filter(role => allRankRoleIds.includes(role.id));
    
    for (const [roleId, role] of rolesToRemove) {
      await member.roles.remove(role).catch(e => console.error('Error removing role:', e));
    }
    
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
// HELPER: Create Voice Channels for Lobby
// ===========================================

async function createLobbyVoiceChannels(lobbyId) {
  if (!discordClient.isReady()) return null;
  
  try {
    const guild = discordClient.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) return null;
    
    const category = CONFIG.VOICE_CATEGORY_ID ? 
      guild.channels.cache.get(CONFIG.VOICE_CATEGORY_ID) : null;
    
    // Create lobby VC (waiting room)
    const lobbyVC = await guild.channels.create({
      name: `🎮 Lobby ${lobbyId}`,
      type: ChannelType.GuildVoice,
      parent: category?.id,
      userLimit: 10
    });
    
    console.log(`Created lobby VC: ${lobbyVC.name}`);
    
    return {
      lobbyVCId: lobbyVC.id,
      lobbyVCName: lobbyVC.name
    };
  } catch (e) {
    console.error('Error creating lobby voice channels:', e);
    return null;
  }
}

// ===========================================
// HELPER: Create Team Voice Channels
// ===========================================

async function createTeamVoiceChannels(lobbyId) {
  if (!discordClient.isReady()) return null;
  
  try {
    const guild = discordClient.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) return null;
    
    const category = CONFIG.VOICE_CATEGORY_ID ? 
      guild.channels.cache.get(CONFIG.VOICE_CATEGORY_ID) : null;
    
    // Create team VCs
    const team1VC = await guild.channels.create({
      name: `🔵 Team 1 - ${lobbyId}`,
      type: ChannelType.GuildVoice,
      parent: category?.id,
      userLimit: 5
    });
    
    const team2VC = await guild.channels.create({
      name: `🔴 Team 2 - ${lobbyId}`,
      type: ChannelType.GuildVoice,
      parent: category?.id,
      userLimit: 5
    });
    
    console.log(`Created team VCs for lobby ${lobbyId}`);
    
    return {
      team1VCId: team1VC.id,
      team2VCId: team2VC.id
    };
  } catch (e) {
    console.error('Error creating team voice channels:', e);
    return null;
  }
}

// ===========================================
// HELPER: Delete Voice Channels
// ===========================================

async function deleteVoiceChannel(channelId) {
  if (!discordClient.isReady() || !channelId) return;
  
  try {
    const guild = discordClient.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) return;
    
    const channel = guild.channels.cache.get(channelId);
    if (channel) {
      await channel.delete();
      console.log(`Deleted VC: ${channelId}`);
    }
  } catch (e) {
    console.error('Error deleting voice channel:', e);
  }
}

// ===========================================
// HELPER: Check if all players are in lobby VC
// ===========================================

async function areAllPlayersInLobbyVC(lobby) {
  if (!discordClient.isReady() || !lobby.lobbyVCId) return false;
  
  try {
    const guild = discordClient.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) return false;
    
    const lobbyVC = guild.channels.cache.get(lobby.lobbyVCId);
    if (!lobbyVC) return false;
    
    for (const player of lobby.players) {
      const member = await guild.members.fetch(player.odiscordId).catch(() => null);
      if (!member || member.voice?.channelId !== lobby.lobbyVCId) {
        return false;
      }
    }
    
    return true;
  } catch (e) {
    console.error('Error checking players in VC:', e);
    return false;
  }
}

// ===========================================
// HELPER: Get players in lobby VC
// ===========================================

async function getPlayersInLobbyVC(lobby) {
  if (!discordClient.isReady() || !lobby.lobbyVCId) return [];
  
  try {
    const guild = discordClient.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) return [];
    
    const inVC = [];
    for (const player of lobby.players) {
      const member = await guild.members.fetch(player.odiscordId).catch(() => null);
      if (member && member.voice?.channelId === lobby.lobbyVCId) {
        inVC.push(player.odiscordId);
      }
    }
    
    return inVC;
  } catch (e) {
    console.error('Error getting players in VC:', e);
    return [];
  }
}

// ===========================================
// HELPER: Move players to team VCs
// ===========================================

async function movePlayersToTeamVCs(lobby) {
  if (!discordClient.isReady()) return;
  
  try {
    const guild = discordClient.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) return;
    
    // Move team 1
    for (const player of lobby.teams.team1) {
      const member = await guild.members.fetch(player.odiscordId).catch(() => null);
      if (member && member.voice?.channel && lobby.team1VCId) {
        await member.voice.setChannel(lobby.team1VCId).catch(e => console.error('Move error:', e));
      }
    }
    
    // Move team 2
    for (const player of lobby.teams.team2) {
      const member = await guild.members.fetch(player.odiscordId).catch(() => null);
      if (member && member.voice?.channel && lobby.team2VCId) {
        await member.voice.setChannel(lobby.team2VCId).catch(e => console.error('Move error:', e));
      }
    }
    
    console.log(`Moved players to team VCs for lobby ${lobby.id}`);
  } catch (e) {
    console.error('Error moving players to team VCs:', e);
  }
}

// ===========================================
// HELPER: Move players to main VC (after game ends)
// ===========================================

async function movePlayersToMainVC(lobby) {
  if (!discordClient.isReady()) return;
  
  try {
    const guild = discordClient.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) return;
    
    const allPlayers = [...lobby.teams.team1, ...lobby.teams.team2];
    
    for (const player of allPlayers) {
      const member = await guild.members.fetch(player.odiscordId).catch(() => null);
      if (member && member.voice?.channel) {
        await member.voice.setChannel(CONFIG.MAIN_VC_ID).catch(e => console.error('Move error:', e));
      }
    }
    
    console.log(`Moved players to main VC after game ${lobby.id}`);
  } catch (e) {
    console.error('Error moving players to main VC:', e);
  }
}

// ===========================================
// HELPER: Move player from main VC to lobby VC
// ===========================================

async function movePlayerToLobbyVC(odiscordId, lobbyVCId) {
  if (!discordClient.isReady() || !lobbyVCId) return;
  
  try {
    const guild = discordClient.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) return;
    
    const member = await guild.members.fetch(odiscordId).catch(() => null);
    if (member && member.voice?.channelId === CONFIG.MAIN_VC_ID) {
      await member.voice.setChannel(lobbyVCId).catch(e => console.error('Move error:', e));
      console.log(`Moved ${member.user.username} to lobby VC`);
    }
  } catch (e) {
    console.error('Error moving player to lobby VC:', e);
  }
}

// ===========================================
// HELPER: Send match result to Discord
// ===========================================

async function sendMatchResultToDiscord(lobby, results) {
  if (!discordClient.isReady()) return;
  
  try {
    const channel = discordClient.channels.cache.get(CONFIG.MATCH_RESULTS_CHANNEL_ID);
    if (!channel) {
      console.log('Match results channel not found');
      return;
    }
    
    const winnerTeam = lobby.score.team1 >= 2 ? 'Team 1' : 'Team 2';
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const timeStr = now.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      timeZoneName: 'short'
    });
    
    const embed = new EmbedBuilder()
      .setColor(lobby.score.team1 >= 2 ? 0x3B82F6 : 0xEF4444)
      .setTitle(`🏆 Match Complete - ${winnerTeam} Wins!`)
      .setDescription(`**Lobby:** ${lobby.id}\n**Date:** ${dateStr}\n**Time:** ${timeStr}`)
      .addFields(
        {
          name: `🔵 Team 1 ${lobby.score.team1 >= 2 ? '(Winner)' : ''}`,
          value: results.winners.filter(p => lobby.teams.team1.some(t => t.odiscordId === p.odiscordId))
            .concat(results.losers.filter(p => lobby.teams.team1.some(t => t.odiscordId === p.odiscordId)))
            .map(p => `${p.username}: ${p.oldElo} → ${p.newElo} (${p.change >= 0 ? '+' : ''}${p.change})`)
            .join('\n') || 'No players',
          inline: true
        },
        {
          name: `🔴 Team 2 ${lobby.score.team2 >= 2 ? '(Winner)' : ''}`,
          value: results.winners.filter(p => lobby.teams.team2.some(t => t.odiscordId === p.odiscordId))
            .concat(results.losers.filter(p => lobby.teams.team2.some(t => t.odiscordId === p.odiscordId)))
            .map(p => `${p.username}: ${p.oldElo} → ${p.newElo} (${p.change >= 0 ? '+' : ''}${p.change})`)
            .join('\n') || 'No players',
          inline: true
        },
        {
          name: '📊 Final Score',
          value: `**${lobby.score.team1}** - **${lobby.score.team2}**`,
          inline: false
        }
      )
      .setTimestamp()
      .setFooter({ text: 'Counterpush Ranked' });
    
    await channel.send({ embeds: [embed] });
    console.log('Match result sent to Discord');
  } catch (e) {
    console.error('Error sending match result to Discord:', e);
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

function createLobby(hostId, hostData, maxPlayers, isPublic = false) {
  let code;
  do {
    code = generateLobbyCode();
  } while (lobbies.has(code));

  const hostPlayer = db.getOrCreatePlayer(hostId, hostData.username, hostData.avatar);

  const lobby = {
    id: code,
    host: hostPlayer,
    players: [hostPlayer],
    maxPlayers,
    phase: 'waiting',
    captains: [],
    teams: { team1: [], team2: [] },
    currentTurn: null,
    picksLeft: 0,
    score: { team1: 0, team2: 0 },
    isPublic,
    lobbyVCId: null,
    team1VCId: null,
    team2VCId: null,
    createdAt: Date.now()
  };

  lobbies.set(code, lobby);
  db.setUserSession(hostId, code);
  
  console.log(`Lobby ${code} created by ${hostData.username} (public: ${isPublic})`);
  return lobby;
}

function getLobby(code) {
  return lobbies.get(code?.toUpperCase()) || null;
}

function deleteLobby(code) {
  const lobby = lobbies.get(code);
  if (lobby) {
    // Delete voice channels
    deleteVoiceChannel(lobby.lobbyVCId);
    deleteVoiceChannel(lobby.team1VCId);
    deleteVoiceChannel(lobby.team2VCId);
    
    db.clearLobbySession(code);
    lobbies.delete(code);
    console.log(`Lobby ${code} deleted`);
  }
}

function getPublicLobbies() {
  const publicLobbies = [];
  for (const [code, lobby] of lobbies) {
    if (lobby.isPublic && lobby.phase === 'waiting') {
      publicLobbies.push({
        id: lobby.id,
        host: { username: lobby.host.username, avatar: lobby.host.avatar },
        playerCount: lobby.players.length,
        maxPlayers: lobby.maxPlayers,
        createdAt: lobby.createdAt
      });
    }
  }
  return publicLobbies.sort((a, b) => b.createdAt - a.createdAt);
}

// ===========================================
// REST API ENDPOINTS
// ===========================================

app.get('/api/leaderboard', (req, res) => {
  const leaderboard = db.getLeaderboard(50);
  res.json(leaderboard);
});

app.get('/api/players/:id', (req, res) => {
  const player = db.getPlayer(req.params.id);
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }
  
  // Include match history
  const matches = db.getPlayerMatches(req.params.id, 10);
  res.json({ ...player, recentMatches: matches });
});

app.get('/api/players', (req, res) => {
  const players = db.getAllPlayers();
  res.json(players);
});

app.get('/api/matches', (req, res) => {
  const matches = db.getRecentMatches(20);
  res.json(matches);
});

app.get('/api/matches/:playerId', (req, res) => {
  const matches = db.getPlayerMatches(req.params.playerId, 20);
  res.json(matches);
});

app.get('/api/lobby/:code', (req, res) => {
  const lobby = getLobby(req.params.code);
  if (!lobby) {
    return res.status(404).json({ error: 'Lobby not found' });
  }
  res.json(lobby);
});

app.get('/api/lobbies', (req, res) => {
  const publicLobbies = getPublicLobbies();
  res.json(publicLobbies);
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

  socket.on('createLobby', async ({ userData, maxPlayers, isPublic }) => {
    console.log('createLobby called:', { userData: userData.username, maxPlayers, isPublic });
    
    // Check if user is already hosting a lobby
    for (const [code, existingLobby] of lobbies) {
      if (existingLobby.host.odiscordId === userData.odiscordId) {
        socket.emit('error', { message: 'You are already hosting a lobby' });
        return;
      }
    }
    
    // Check if user is already in a lobby
    const existingSession = db.getUserSession(userData.odiscordId);
    if (existingSession) {
      const existingLobby = getLobby(existingSession.lobbyId);
      if (existingLobby) {
        socket.emit('error', { message: 'You are already in a lobby. Leave it first.' });
        return;
      }
    }
    
    const lobby = createLobby(userData.odiscordId, userData, maxPlayers || CONFIG.MAX_PLAYERS, isPublic || false);
    
    // Create lobby VC if public
    if (isPublic) {
      const vcData = await createLobbyVoiceChannels(lobby.id);
      if (vcData) {
        lobby.lobbyVCId = vcData.lobbyVCId;
        lobby.lobbyVCName = vcData.lobbyVCName;
        // Move host from main VC to lobby VC
        movePlayerToLobbyVC(userData.odiscordId, lobby.lobbyVCId);
      }
    }
    
    socket.join(lobby.id);
    socket.lobbyId = lobby.id;
    socket.odiscordId = userData.odiscordId;
    socket.emit('lobbyCreated', lobby);
    
    // Broadcast to lobby browser
    io.emit('lobbiesUpdate', getPublicLobbies());
    
    console.log('Lobby created:', lobby.id);
  });

  socket.on('joinLobby', async ({ code, userData }) => {
    const lobby = getLobby(code.toUpperCase());
    
    if (!lobby) {
      socket.emit('error', { message: 'Lobby not found' });
      return;
    }

    // Check if player is already in this lobby (allow rejoin even if full or in progress)
    const existingPlayer = lobby.players.find(p => p.odiscordId === userData.odiscordId);
    if (existingPlayer) {
      socket.join(lobby.id);
      socket.lobbyId = lobby.id;
      socket.odiscordId = userData.odiscordId;
      socket.emit('lobbyJoined', lobby);
      // Move player from main VC to lobby VC if applicable
      if (lobby.lobbyVCId) {
        movePlayerToLobbyVC(userData.odiscordId, lobby.lobbyVCId);
      }
      return;
    }

    // New players can't join if game already started
    if (lobby.phase !== 'waiting') {
      socket.emit('error', { message: 'Game already in progress' });
      return;
    }

    // New players can't join if lobby is full
    if (lobby.players.length >= lobby.maxPlayers) {
      socket.emit('error', { message: 'Lobby is full' });
      return;
    }

    const player = db.getOrCreatePlayer(userData.odiscordId, userData.username, userData.avatar);
    lobby.players.push(player);
    
    db.setUserSession(userData.odiscordId, lobby.id);
    
    socket.join(lobby.id);
    socket.lobbyId = lobby.id;
    socket.odiscordId = userData.odiscordId;

    // Move player from main VC to lobby VC if applicable
    if (lobby.lobbyVCId) {
      movePlayerToLobbyVC(userData.odiscordId, lobby.lobbyVCId);
    }

    socket.emit('lobbyJoined', lobby);
    io.to(lobby.id).emit('lobbyUpdate', lobby);
    io.emit('lobbiesUpdate', getPublicLobbies());
    
    console.log(`${userData.username} joined lobby ${lobby.id}`);
  });

  socket.on('getPublicLobbies', () => {
    socket.emit('lobbiesUpdate', getPublicLobbies());
  });

  socket.on('checkVCStatus', async ({ lobbyId }) => {
    const lobby = getLobby(lobbyId);
    if (!lobby) return;
    
    const playersInVC = await getPlayersInLobbyVC(lobby);
    const allInVC = playersInVC.length === lobby.players.length;
    
    socket.emit('vcStatus', { playersInVC, allInVC });
  });

  socket.on('startCaptainSelect', async ({ lobbyId }) => {
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
      socket.emit('error', { message: 'Need at least 4 players' });
      return;
    }

    // Check if all players are in VC for public lobbies
    if (lobby.isPublic && lobby.lobbyVCId) {
      const allInVC = await areAllPlayersInLobbyVC(lobby);
      if (!allInVC) {
        socket.emit('error', { message: 'All players must be in the voice channel to start' });
        return;
      }
    }

    lobby.phase = 'captain-select';
    io.to(lobby.id).emit('lobbyUpdate', lobby);
    io.emit('lobbiesUpdate', getPublicLobbies());
    
    console.log(`Lobby ${lobbyId} started captain select`);
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
      socket.emit('error', { message: 'Not in captain select phase' });
      return;
    }

    const player = lobby.players.find(p => p.odiscordId === odiscordId);
    if (!player) {
      socket.emit('error', { message: 'Player not found' });
      return;
    }

    if (lobby.captains.some(c => c.odiscordId === odiscordId)) {
      socket.emit('error', { message: 'Player is already a captain' });
      return;
    }

    lobby.captains.push(player);

    if (lobby.captains.length === 1) {
      lobby.teams.team1.push(player);
    } else if (lobby.captains.length === 2) {
      lobby.teams.team2.push(player);
      lobby.phase = 'drafting';
      lobby.currentTurn = 'team1';
      lobby.picksLeft = 1;
    }

    io.to(lobby.id).emit('lobbyUpdate', lobby);
  });

  socket.on('removeCaptain', ({ lobbyId, odiscordId }) => {
    const lobby = getLobby(lobbyId);
    
    if (!lobby) {
      socket.emit('error', { message: 'Lobby not found' });
      return;
    }

    if (socket.odiscordId !== lobby.host.odiscordId) {
      socket.emit('error', { message: 'Only the host can remove captains' });
      return;
    }

    if (lobby.phase !== 'captain-select') {
      socket.emit('error', { message: 'Can only remove captains during captain select' });
      return;
    }

    const captainIndex = lobby.captains.findIndex(c => c.odiscordId === odiscordId);
    if (captainIndex === -1) {
      socket.emit('error', { message: 'Player is not a captain' });
      return;
    }

    // Remove from captains
    lobby.captains.splice(captainIndex, 1);
    
    // Remove from teams
    lobby.teams.team1 = lobby.teams.team1.filter(p => p.odiscordId !== odiscordId);
    lobby.teams.team2 = lobby.teams.team2.filter(p => p.odiscordId !== odiscordId);

    io.to(lobby.id).emit('lobbyUpdate', lobby);
  });

  socket.on('draftPick', async ({ lobbyId, odiscordId }) => {
    const lobby = getLobby(lobbyId);
    
    if (!lobby) {
      socket.emit('error', { message: 'Lobby not found' });
      return;
    }

    if (lobby.phase !== 'drafting') {
      socket.emit('error', { message: 'Not in drafting phase' });
      return;
    }

    const currentCaptain = lobby.currentTurn === 'team1' ? lobby.teams.team1[0] : lobby.teams.team2[0];
    if (socket.odiscordId !== currentCaptain.odiscordId) {
      socket.emit('error', { message: 'Not your turn to pick' });
      return;
    }

    const player = lobby.players.find(p => p.odiscordId === odiscordId);
    if (!player) {
      socket.emit('error', { message: 'Player not found' });
      return;
    }

    if (lobby.captains.some(c => c.odiscordId === odiscordId) ||
        lobby.teams.team1.some(t => t.odiscordId === odiscordId) ||
        lobby.teams.team2.some(t => t.odiscordId === odiscordId)) {
      socket.emit('error', { message: 'Player already picked' });
      return;
    }

    lobby.teams[lobby.currentTurn].push(player);
    lobby.picksLeft--;

    const totalPicked = lobby.teams.team1.length + lobby.teams.team2.length;
    const playersPerTeam = lobby.maxPlayers / 2;

    if (totalPicked >= lobby.maxPlayers) {
      await startPlaying(lobby);
      io.to(lobby.id).emit('lobbyUpdate', lobby);
    } else {
      if (lobby.picksLeft === 0) {
        lobby.currentTurn = lobby.currentTurn === 'team1' ? 'team2' : 'team1';
        
        const team1Remaining = playersPerTeam - lobby.teams.team1.length;
        const team2Remaining = playersPerTeam - lobby.teams.team2.length;
        const unpickedPlayers = lobby.players.length - totalPicked;
        
        if (lobby.currentTurn === 'team1') {
          lobby.picksLeft = Math.min(2, team1Remaining, unpickedPlayers);
        } else {
          lobby.picksLeft = Math.min(2, team2Remaining, unpickedPlayers);
        }
        
        if (lobby.picksLeft === 0) {
          await startPlaying(lobby);
          io.to(lobby.id).emit('lobbyUpdate', lobby);
        } else {
          io.to(lobby.id).emit('lobbyUpdate', lobby);
        }
      } else {
        io.to(lobby.id).emit('lobbyUpdate', lobby);
      }
    }
  });

  async function startPlaying(lobby) {
    // Create team VCs
    const teamVCs = await createTeamVoiceChannels(lobby.id);
    if (teamVCs) {
      lobby.team1VCId = teamVCs.team1VCId;
      lobby.team2VCId = teamVCs.team2VCId;
    }
    
    lobby.phase = 'playing';
    lobby.currentTurn = null;
    
    // Move players to team VCs
    await movePlayersToTeamVCs(lobby);
    
    // Delete lobby VC (no longer needed)
    await deleteVoiceChannel(lobby.lobbyVCId);
    lobby.lobbyVCId = null;
  }

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
      finishMatch(lobby);
    }

    io.to(lobby.id).emit('lobbyUpdate', lobby);
  });

  socket.on('declareWinner', async ({ lobbyId, winnerTeam }) => {
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

    lobby.score[winnerTeam] = 2;
    lobby.score[winnerTeam === 'team1' ? 'team2' : 'team1'] = 0;

    await finishMatch(lobby);

    io.to(lobby.id).emit('lobbyUpdate', lobby);
  });

  async function finishMatch(lobby) {
    lobby.phase = 'finished';

    const winnerTeam = lobby.score.team1 >= 2 ? 'team1' : 'team2';
    const winnerIds = lobby.teams[winnerTeam].map(p => p.odiscordId);
    const loserIds = lobby.teams[winnerTeam === 'team1' ? 'team2' : 'team1'].map(p => p.odiscordId);

    const results = db.processMatchResult(winnerIds, loserIds, lobby.id);
    lobby.eloResults = results;

    // Update rank roles
    for (const player of [...results.winners, ...results.losers]) {
      const newRank = db.getRank(player.newElo);
      const oldRank = db.getRank(player.oldElo);
      if (newRank !== oldRank) {
        updatePlayerRankRole(player.odiscordId, newRank);
      }
    }

    // Send result to Discord first (before deleting lobby)
    await sendMatchResultToDiscord(lobby, results);

    // Move all players to main VC
    await movePlayersToMainVC(lobby);
    
    // Delete team VCs
    await deleteVoiceChannel(lobby.team1VCId);
    await deleteVoiceChannel(lobby.team2VCId);

    // Emit final update before deleting
    io.to(lobby.id).emit('lobbyUpdate', lobby);
    
    // Close the lobby on the website
    setTimeout(() => {
      io.to(lobby.id).emit('lobbyClosed', { reason: 'Match complete! Thanks for playing.' });
      deleteLobby(lobby.id);
    }, 5000); // 5 second delay so players can see the results
  }

  socket.on('resetLobby', ({ lobbyId }) => {
    const lobby = getLobby(lobbyId);
    
    if (!lobby) {
      socket.emit('error', { message: 'Lobby not found' });
      return;
    }

    if (socket.odiscordId !== lobby.host.odiscordId) {
      socket.emit('error', { message: 'Only the host can reset the lobby' });
      return;
    }

    lobby.phase = 'waiting';
    lobby.captains = [];
    lobby.teams = { team1: [], team2: [] };
    lobby.currentTurn = null;
    lobby.picksLeft = 0;
    lobby.score = { team1: 0, team2: 0 };
    lobby.eloResults = null;

    io.to(lobby.id).emit('lobbyUpdate', lobby);
    io.emit('lobbiesUpdate', getPublicLobbies());
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
      io.emit('lobbiesUpdate', getPublicLobbies());
      return;
    }

    lobby.players = lobby.players.filter(p => p.odiscordId !== socket.odiscordId);
    db.clearUserSession(socket.odiscordId);
    
    socket.leave(lobbyId);
    io.to(lobbyId).emit('lobbyUpdate', lobby);
    io.emit('lobbiesUpdate', getPublicLobbies());
  });

  socket.on('kickPlayer', ({ lobbyId, odiscordId }) => {
    const lobby = getLobby(lobbyId);
    
    if (!lobby) return;
    
    if (socket.odiscordId !== lobby.host.odiscordId) {
      socket.emit('error', { message: 'Only host can kick players' });
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
    io.emit('lobbiesUpdate', getPublicLobbies());
  });

  socket.on('closeLobby', ({ lobbyId }) => {
    const lobby = getLobby(lobbyId);
    
    if (!lobby) return;
    
    if (socket.odiscordId !== lobby.host.odiscordId) {
      socket.emit('error', { message: 'Only host can close lobby' });
      return;
    }

    io.to(lobbyId).emit('lobbyClosed', { reason: 'Host closed the lobby' });
    deleteLobby(lobbyId);
    io.emit('lobbiesUpdate', getPublicLobbies());
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// ===========================================
// START SERVER
// ===========================================

discordClient.login(CONFIG.BOT_TOKEN).catch(e => {
  console.error('Failed to login to Discord:', e.message);
});

server.listen(CONFIG.PORT, () => {
  console.log(`Server running on port ${CONFIG.PORT}`);
});
