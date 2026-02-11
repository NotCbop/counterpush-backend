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

discordClient.once('ready', async () => {
  console.log(`Discord bot logged in as ${discordClient.user.tag}`);
  
  // Register slash commands
  try {
    const guild = discordClient.guilds.cache.get(CONFIG.GUILD_ID);
    if (guild) {
      await guild.commands.create({
        name: 'closelobby',
        description: 'Close a lobby (host or moderator)',
        options: [
          {
            name: 'code',
            description: 'The lobby code',
            type: 3, // STRING
            required: true
          }
        ]
      });
      
      await guild.commands.create({
        name: 'setelo',
        description: 'Set a player\'s ELO (moderator only)',
        options: [
          {
            name: 'user',
            description: 'The user to set ELO for',
            type: 6, // USER
            required: true
          },
          {
            name: 'elo',
            description: 'The new ELO value',
            type: 4, // INTEGER
            required: true
          }
        ]
      });
      
      await guild.commands.create({
        name: 'declarewinner',
        description: 'Declare the winner of a lobby (host or moderator)',
        options: [
          {
            name: 'code',
            description: 'The lobby code',
            type: 3, // STRING
            required: true
          },
          {
            name: 'team',
            description: 'The winning team',
            type: 3, // STRING
            required: true,
            choices: [
              { name: 'Team 1', value: 'team1' },
              { name: 'Team 2', value: 'team2' }
            ]
          }
        ]
      });
      
      await guild.commands.create({
        name: 'draw',
        description: 'Declare a match as a draw (host or moderator)',
        options: [
          {
            name: 'code',
            description: 'The lobby code',
            type: 3, // STRING
            required: true
          }
        ]
      });
      
      await guild.commands.create({
        name: 'closelobbies',
        description: 'Close all active lobbies (moderator only)',
        options: []
      });
      
      console.log('Slash commands registered');
    }
  } catch (e) {
    console.error('Error registering slash commands:', e);
  }
});

// Moderator role ID
const MODERATOR_ROLE_ID = '1468766786416676971';

// Handle slash commands
discordClient.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  
  // Check if user has moderator role
  const isModerator = interaction.member?.roles?.cache?.has(MODERATOR_ROLE_ID);
  
  if (interaction.commandName === 'closelobby') {
    const code = interaction.options.getString('code').toUpperCase();
    const odiscordId = interaction.user.id;
    
    const lobby = lobbies.get(code);
    
    if (!lobby) {
      await interaction.reply({ content: '❌ Lobby not found.', ephemeral: true });
      return;
    }
    
    // Allow if user is host OR has moderator role
    if (lobby.host.odiscordId !== odiscordId && !isModerator) {
      await interaction.reply({ content: '❌ You are not the host of this lobby.', ephemeral: true });
      return;
    }
    
    const closedBy = isModerator && lobby.host.odiscordId !== odiscordId ? 'a moderator' : 'the host';
    
    // Close the lobby
    io.to(code).emit('lobbyClosed', { reason: `Lobby closed by ${closedBy} via Discord` });
    await deleteLobby(code);
    io.emit('lobbiesUpdate', getPublicLobbies());
    
    await interaction.reply({ content: `✅ Lobby **${code}** has been closed.`, ephemeral: true });
  }
  
  if (interaction.commandName === 'setelo') {
    // Only moderators can use this command
    if (!isModerator) {
      await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
      return;
    }
    
    const targetUser = interaction.options.getUser('user');
    const newElo = interaction.options.getInteger('elo');
    
    if (newElo < 0 || newElo > 5000) {
      await interaction.reply({ content: '❌ ELO must be between 0 and 5000.', ephemeral: true });
      return;
    }
    
    // Get or create player
    const player = db.getPlayer(targetUser.id);
    
    if (!player) {
      await interaction.reply({ content: '❌ Player not found in database. They need to join a lobby first.', ephemeral: true });
      return;
    }
    
    const oldElo = player.elo;
    const oldRank = db.getRank(oldElo);
    
    // Update ELO
    db.updatePlayer(targetUser.id, { elo: newElo });
    
    const newRank = db.getRank(newElo);
    
    // Update rank role if changed
    if (newRank !== oldRank) {
      await updatePlayerRankRole(targetUser.id, newRank);
    }
    
    await interaction.reply({ 
      content: `✅ Set **${targetUser.username}**'s ELO from **${oldElo}** to **${newElo}** (Rank: ${oldRank} → ${newRank})`, 
      ephemeral: true 
    });
  }
  
  if (interaction.commandName === 'declarewinner') {
    const code = interaction.options.getString('code').toUpperCase();
    const winnerTeam = interaction.options.getString('team');
    const odiscordId = interaction.user.id;
    
    const lobby = lobbies.get(code);
    
    if (!lobby) {
      await interaction.reply({ content: '❌ Lobby not found.', ephemeral: true });
      return;
    }
    
    // Allow if user is host OR has moderator role
    if (lobby.host.odiscordId !== odiscordId && !isModerator) {
      await interaction.reply({ content: '❌ Only the host or moderators can declare winners.', ephemeral: true });
      return;
    }
    
    if (lobby.phase !== 'playing') {
      await interaction.reply({ content: '❌ Match is not in progress.', ephemeral: true });
      return;
    }
    
    // Process the match result
    const winnerIds = lobby.teams[winnerTeam].map(p => p.odiscordId);
    const loserTeam = winnerTeam === 'team1' ? 'team2' : 'team1';
    const loserIds = lobby.teams[loserTeam].map(p => p.odiscordId);
    
    const results = db.processMatchResult(winnerIds, loserIds, lobby.id);
    
    // Update rank roles
    for (const player of [...results.winners, ...results.losers]) {
      await updatePlayerRankRole(player.odiscordId, player.newRank);
    }
    
    // Update lobby state
    lobby.phase = 'finished';
    lobby.score[winnerTeam] = 2;
    lobby.score[loserTeam] = 0;
    
    io.to(code).emit('matchFinished', results);
    io.to(code).emit('lobbyUpdate', lobby);
    
    // Send match result to Discord
    await sendMatchResultToDiscord(lobby, results);
    
    // Move players back to main VC
    await movePlayersToMainVC(lobby);
    
    // Delete team VCs
    await deleteTeamVoiceChannels(lobby);
    
    const declaredBy = isModerator && lobby.host.odiscordId !== odiscordId ? 'Moderator' : 'Host';
    await interaction.reply({ 
      content: `✅ **${winnerTeam === 'team1' ? 'Team 1' : 'Team 2'}** declared winner of lobby **${code}** by ${declaredBy}.`, 
      ephemeral: true 
    });
  }
  
  if (interaction.commandName === 'draw') {
    const code = interaction.options.getString('code').toUpperCase();
    const odiscordId = interaction.user.id;
    
    const lobby = lobbies.get(code);
    
    if (!lobby) {
      await interaction.reply({ content: '❌ Lobby not found.', ephemeral: true });
      return;
    }
    
    // Allow if user is host OR has moderator role
    if (lobby.host.odiscordId !== odiscordId && !isModerator) {
      await interaction.reply({ content: '❌ Only the host or moderators can declare a draw.', ephemeral: true });
      return;
    }
    
    if (lobby.phase !== 'playing') {
      await interaction.reply({ content: '❌ Match is not in progress.', ephemeral: true });
      return;
    }
    
    // Process draw - no ELO changes
    const allPlayers = [...lobby.teams.team1, ...lobby.teams.team2];
    
    // Save match as draw
    const drawResult = {
      lobbyId: lobby.id,
      team1: lobby.teams.team1,
      team2: lobby.teams.team2,
      winner: 'draw',
      score: { team1: 0, team2: 0 },
      winners: [],
      losers: [],
      isDraw: true
    };
    
    db.saveMatch(drawResult);
    
    // Update lobby state
    lobby.phase = 'finished';
    lobby.isDraw = true;
    
    io.to(code).emit('matchDraw', { lobby });
    io.to(code).emit('lobbyUpdate', lobby);
    
    // Move players back to main VC
    await movePlayersToMainVC(lobby);
    
    // Delete team VCs
    await deleteTeamVoiceChannels(lobby);
    
    // Send draw notification to Discord
    const channel = discordClient.channels.cache.get(CONFIG.MATCH_RESULTS_CHANNEL_ID);
    if (channel) {
      const embed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle('🤝 Match Draw')
        .setDescription(`**Lobby:** ${lobby.id}\nThe match has been declared a draw. No ELO changes.`)
        .addFields(
          { name: '🔵 Team 1', value: lobby.teams.team1.map(p => p.username).join('\n') || 'None', inline: true },
          { name: '🔴 Team 2', value: lobby.teams.team2.map(p => p.username).join('\n') || 'None', inline: true }
        )
        .setTimestamp();
      
      await channel.send({ embeds: [embed] });
    }
    
    const declaredBy = isModerator && lobby.host.odiscordId !== odiscordId ? 'Moderator' : 'Host';
    await interaction.reply({ 
      content: `✅ Lobby **${code}** declared as a **draw** by ${declaredBy}. No ELO changes.`, 
      ephemeral: true 
    });
  }
  
  if (interaction.commandName === 'closelobbies') {
    // Only moderators can use this command
    if (!isModerator) {
      await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
      return;
    }
    
    const lobbyCount = lobbies.size;
    
    if (lobbyCount === 0) {
      await interaction.reply({ content: '✅ No active lobbies to close.', ephemeral: true });
      return;
    }
    
    // Close all lobbies
    const lobbyCodes = Array.from(lobbies.keys());
    for (const code of lobbyCodes) {
      io.to(code).emit('lobbyClosed', { reason: 'All lobbies closed by moderator' });
      await deleteLobby(code);
    }
    
    io.emit('lobbiesUpdate', getPublicLobbies());
    
    await interaction.reply({ 
      content: `✅ Closed **${lobbyCount}** lobby(s).`, 
      ephemeral: true 
    });
  }
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
  console.log('Creating lobby VC for:', lobbyId);
  
  if (!discordClient.isReady()) {
    console.log('Discord client not ready');
    return null;
  }
  
  try {
    const guild = discordClient.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) {
      console.log('Guild not found:', CONFIG.GUILD_ID);
      return null;
    }
    
    console.log('Guild found:', guild.name);
    
    const category = CONFIG.VOICE_CATEGORY_ID ? 
      guild.channels.cache.get(CONFIG.VOICE_CATEGORY_ID) : null;
    
    if (CONFIG.VOICE_CATEGORY_ID && !category) {
      console.log('Category not found:', CONFIG.VOICE_CATEGORY_ID);
    }
    
    // Create lobby VC (waiting room)
    const lobbyVC = await guild.channels.create({
      name: `🎮 Lobby ${lobbyId}`,
      type: ChannelType.GuildVoice,
      parent: category?.id || null,
      userLimit: 10
    });
    
    console.log(`Created lobby VC: ${lobbyVC.name} (${lobbyVC.id})`);
    
    return {
      lobbyVCId: lobbyVC.id,
      lobbyVCName: lobbyVC.name
    };
  } catch (e) {
    console.error('Error creating lobby voice channels:', e.message);
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
    
    // Only move players who are in this lobby's VCs
    const lobbyVCs = [lobby.lobbyVCId, lobby.team1VCId, lobby.team2VCId].filter(Boolean);
    
    for (const player of allPlayers) {
      const member = await guild.members.fetch(player.odiscordId).catch(() => null);
      if (member && member.voice?.channel && lobbyVCs.includes(member.voice.channelId)) {
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
const purgeImmunity = new Set(); // Players who were purged and are immune next time
const dailyImmunity = new Map(); // Discord ID -> timestamp when immunity expires (5 hour cooldown)

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

async function deleteLobby(code) {
  const lobby = lobbies.get(code);
  if (lobby) {
    // Move all players to main VC
    await moveAllPlayersToMainVC(lobby);
    
    // Delete voice channels
    deleteVoiceChannel(lobby.lobbyVCId);
    deleteVoiceChannel(lobby.team1VCId);
    deleteVoiceChannel(lobby.team2VCId);
    
    db.clearLobbySession(code);
    lobbies.delete(code);
    console.log(`Lobby ${code} deleted`);
  }
}

// Helper to move ALL players (not just teams) to main VC
async function moveAllPlayersToMainVC(lobby) {
  if (!discordClient.isReady()) return;
  
  try {
    const guild = discordClient.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) return;
    
    // Only move players who are in this lobby's VCs
    const lobbyVCs = [lobby.lobbyVCId, lobby.team1VCId, lobby.team2VCId].filter(Boolean);
    
    for (const player of lobby.players) {
      const member = await guild.members.fetch(player.odiscordId).catch(() => null);
      if (member && member.voice?.channel && lobbyVCs.includes(member.voice.channelId)) {
        await member.voice.setChannel(CONFIG.MAIN_VC_ID).catch(e => console.error('Move error:', e));
      }
    }
    
    console.log(`Moved all players to main VC for lobby ${lobby.id}`);
  } catch (e) {
    console.error('Error moving players to main VC:', e);
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

// Player search endpoint for autocomplete
app.get('/api/players/search/:query', (req, res) => {
  const query = req.params.query.toLowerCase();
  const players = db.getAllPlayers();
  
  // Filter players by username (case-insensitive partial match)
  const matches = players
    .filter(p => p.username.toLowerCase().includes(query))
    .slice(0, 10) // Limit to 10 results
    .map(p => ({
      odiscordId: p.odiscordId,
      username: p.username,
      avatar: p.avatar,
      elo: p.elo,
      rank: p.rank
    }));
  
  res.json(matches);
});

app.get('/api/matches', (req, res) => {
  const matches = db.getRecentMatches(20);
  res.json(matches);
});

app.get('/api/matches/:playerId', (req, res) => {
  const matches = db.getPlayerMatches(req.params.playerId, 20);
  res.json(matches);
});

// Admin backup endpoint - download all data
// Access: /api/admin/backup?key=YOUR_SECRET_KEY
app.get('/api/admin/backup', (req, res) => {
  const secretKey = req.query.key;
  
  // Simple secret key protection - change this!
  if (secretKey !== 'counterpush-backup-2024') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const backup = {
    exportedAt: new Date().toISOString(),
    players: db.getAllPlayers(),
    matches: db.getRecentMatches(1000),
    // Include raw data if needed
  };
  
  res.setHeader('Content-Disposition', 'attachment; filename=counterpush-backup.json');
  res.setHeader('Content-Type', 'application/json');
  res.json(backup);
});

// Admin reset endpoint - reset all ELO and stats
// Access: /api/admin/reset?key=YOUR_SECRET_KEY&confirm=yes
app.post('/api/admin/reset', (req, res) => {
  const secretKey = req.query.key;
  const confirm = req.query.confirm;
  
  if (secretKey !== 'counterpush-backup-2024') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (confirm !== 'yes') {
    return res.status(400).json({ 
      error: 'Please add ?confirm=yes to confirm reset',
      warning: 'This will reset ALL player ELO and stats!'
    });
  }
  
  // Reset all players
  const players = db.getAllPlayers();
  let resetCount = 0;
  
  for (const player of players) {
    db.updatePlayer(player.odiscordId, {
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
      }
    });
    resetCount++;
  }
  
  // Clear matches
  db.clearAllMatches();
  
  console.log(`[ADMIN] Reset ${resetCount} players and cleared all matches`);
  
  res.json({ 
    success: true, 
    message: `Reset ${resetCount} players to ${CONFIG.STARTING_ELO} ELO and cleared all matches`
  });
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
// MINECRAFT LINKING API
// ===========================================

// Get Minecraft UUID from username using Mojang API
async function getMinecraftUUID(username) {
  try {
    const response = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
    if (!response.ok) return null;
    const data = await response.json();
    return { uuid: data.id, username: data.name };
  } catch (e) {
    console.error('Error fetching Minecraft UUID:', e);
    return null;
  }
}

// Fetch player stats from Minecraft server
async function fetchMinecraftStats(uuid) {
  try {
    // Format UUID with dashes (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    const formattedUuid = uuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
    const response = await fetch(`${CONFIG.MINECRAFT_STATS_URL}/stats/${formattedUuid}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data;
  } catch (e) {
    console.error('Error fetching Minecraft stats:', e);
    return null;
  }
}

// Fetch player's current class from Minecraft server
async function fetchPlayerClass(uuid) {
  try {
    const formattedUuid = uuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
    const response = await fetch(`${CONFIG.MINECRAFT_STATS_URL}/class/${formattedUuid}`);
    if (!response.ok) return null;
    const data = await response.json();
    // Convert class ID to name
    const classNames = { 1: 'Tank', 2: 'Brawler', 3: 'Sniper', 4: 'Trickster', 5: 'Support' };
    return classNames[data.classId] || null;
  } catch (e) {
    console.error('Error fetching player class:', e);
    return null;
  }
}

// Link Minecraft account
app.post('/api/link/minecraft', async (req, res) => {
  const { discordId, minecraftUsername } = req.body;
  
  if (!discordId || !minecraftUsername) {
    return res.status(400).json({ error: 'Missing discordId or minecraftUsername' });
  }
  
  // Get UUID from Mojang
  const mcData = await getMinecraftUUID(minecraftUsername);
  if (!mcData) {
    return res.status(404).json({ error: 'Minecraft username not found' });
  }
  
  // Link the accounts
  db.linkMinecraft(discordId, mcData.uuid, mcData.username);
  
  res.json({ 
    success: true, 
    minecraft: { uuid: mcData.uuid, username: mcData.username }
  });
});

// Get linked Minecraft account
app.get('/api/link/minecraft/:discordId', (req, res) => {
  const link = db.getMinecraftByDiscord(req.params.discordId);
  if (!link) {
    return res.status(404).json({ error: 'No Minecraft account linked' });
  }
  res.json(link);
});

// Unlink Minecraft account
app.delete('/api/link/minecraft/:discordId', (req, res) => {
  const success = db.unlinkMinecraft(req.params.discordId);
  if (!success) {
    return res.status(404).json({ error: 'No Minecraft account linked' });
  }
  res.json({ success: true });
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

    // No max player limit - purge will handle overflow
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

    // Check if we need to purge players
    if (lobby.players.length > lobby.maxPlayers) {
      lobby.phase = 'purging';
      lobby.purgeData = {
        originalCount: lobby.players.length,
        targetCount: lobby.maxPlayers,
        eliminated: []
      };
      io.to(lobby.id).emit('lobbyUpdate', lobby);
      io.to(lobby.id).emit('purgeStart', { 
        totalPlayers: lobby.players.length, 
        targetPlayers: lobby.maxPlayers,
        toEliminate: lobby.players.length - lobby.maxPlayers
      });
      
      // Run purge after countdown (5 seconds for dramatic effect)
      setTimeout(() => {
        runPurge(lobby);
      }, 5000);
      
      return;
    }

    lobby.phase = 'captain-select';
    io.to(lobby.id).emit('lobbyUpdate', lobby);
    io.emit('lobbiesUpdate', getPublicLobbies());
    
    console.log(`Lobby ${lobbyId} started captain select`);
  });

  // Purge function - randomly eliminates players
  async function runPurge(lobby) {
    const toEliminate = lobby.players.length - lobby.maxPlayers;
    const eliminated = [];
    
    const now = Date.now();
    const FIVE_HOURS = 5 * 60 * 60 * 1000; // 5 hours in milliseconds
    
    // Check for daily immunity (first game of day - 5 hour cooldown)
    const dailyImmunePlayers = lobby.players.filter(p => {
      const immuneUntil = dailyImmunity.get(p.odiscordId);
      // If no entry or expired, they have daily immunity
      return !immuneUntil || immuneUntil < now;
    });
    
    // Don't eliminate the host OR players with purge immunity OR players with daily immunity
    const immunePlayers = lobby.players.filter(p => purgeImmunity.has(p.odiscordId));
    const allImmunePlayers = lobby.players.filter(p => 
      purgeImmunity.has(p.odiscordId) || dailyImmunePlayers.includes(p)
    );
    
    const eliminatablePlayers = lobby.players.filter(p => 
      p.odiscordId !== lobby.host.odiscordId && 
      !purgeImmunity.has(p.odiscordId) &&
      !dailyImmunePlayers.includes(p)
    );
    
    // Clear purge immunity for players who used it
    immunePlayers.forEach(p => {
      purgeImmunity.delete(p.odiscordId);
      console.log(`${p.username} used their purge immunity`);
    });
    
    // Set daily immunity cooldown for players who used it (5 hour cooldown)
    dailyImmunePlayers.forEach(p => {
      dailyImmunity.set(p.odiscordId, now + FIVE_HOURS);
      console.log(`${p.username} used their first-game immunity (next available in 5 hours)`);
    });
    
    // Notify immune players (combine both types)
    const immuneNotifications = [];
    immunePlayers.forEach(p => {
      immuneNotifications.push({ odiscordId: p.odiscordId, username: p.username, type: 'purge' });
    });
    dailyImmunePlayers.filter(p => !immunePlayers.some(ip => ip.odiscordId === p.odiscordId)).forEach(p => {
      immuneNotifications.push({ odiscordId: p.odiscordId, username: p.username, type: 'daily' });
    });
    
    if (immuneNotifications.length > 0) {
      io.to(lobby.id).emit('immunityUsed', { players: immuneNotifications });
    }
    
    for (let i = 0; i < toEliminate; i++) {
      if (eliminatablePlayers.length === 0) break;
      
      const randomIndex = Math.floor(Math.random() * eliminatablePlayers.length);
      const player = eliminatablePlayers.splice(randomIndex, 1)[0];
      eliminated.push(player);
      
      // Remove from lobby
      lobby.players = lobby.players.filter(p => p.odiscordId !== player.odiscordId);
      db.clearUserSession(player.odiscordId);
      
      // Grant purge immunity for next lobby
      purgeImmunity.add(player.odiscordId);
      console.log(`${player.username} was purged and granted immunity for next lobby`);
    }
    
    lobby.purgeData.eliminated = eliminated;
    
    // Get lobby VC IDs for checking
    const lobbyVCId = lobby.lobbyVCId;
    
    // Send elimination events one by one with delay
    eliminated.forEach((player, index) => {
      setTimeout(() => {
        io.to(lobby.id).emit('playerEliminated', { 
          player, 
          index: index + 1, 
          total: eliminated.length,
          hasImmunity: true // Let them know they have immunity next time
        });
        
        // Move eliminated player to main VC (only if in lobby VC)
        movePlayerToMainVC(player.odiscordId, lobbyVCId);
      }, index * 1000); // 1 second between each elimination
    });
    
    // After all eliminations, transition to captain select
    setTimeout(() => {
      lobby.phase = 'captain-select';
      delete lobby.purgeData;
      io.to(lobby.id).emit('purgeComplete', { survivors: lobby.players });
      io.to(lobby.id).emit('lobbyUpdate', lobby);
      io.emit('lobbiesUpdate', getPublicLobbies());
      console.log(`Lobby ${lobby.id} purge complete, ${eliminated.length} eliminated`);
    }, eliminated.length * 1000 + 2000); // Wait for all eliminations + 2 seconds
  }
  
  // Helper to move a single player to main VC (only if in specific VC)
  async function movePlayerToMainVC(odiscordId, fromVCId) {
    if (!discordClient.isReady()) return;
    
    try {
      const guild = discordClient.guilds.cache.get(CONFIG.GUILD_ID);
      if (!guild) return;
      
      const member = await guild.members.fetch(odiscordId).catch(() => null);
      // Only move if they're in the lobby VC
      if (member && member.voice?.channelId === fromVCId) {
        await member.voice.setChannel(CONFIG.MAIN_VC_ID).catch(e => console.error('Move error:', e));
        console.log(`Moved purged player ${member.user.username} to main VC`);
      }
    } catch (e) {
      console.error('Error moving purged player to main VC:', e);
    }
  }

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
      
      // Start draft mode
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
    
    // Emit draft pick event for sound
    io.to(lobby.id).emit('draftPick', { player, team: lobby.currentTurn });

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

  socket.on('declareDraw', async ({ lobbyId }) => {
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
      socket.emit('error', { message: 'Only the host can declare a draw' });
      return;
    }

    // Process draw - no ELO changes
    lobby.phase = 'finished';
    lobby.isDraw = true;
    lobby.score = { team1: 0, team2: 0 };
    
    // Save match as draw
    const drawResult = {
      lobbyId: lobby.id,
      team1: lobby.teams.team1,
      team2: lobby.teams.team2,
      winner: 'draw',
      score: { team1: 0, team2: 0 },
      winners: [],
      losers: [],
      isDraw: true
    };
    
    db.saveMatch(drawResult);
    
    io.to(lobby.id).emit('matchDraw', { lobby });
    io.to(lobby.id).emit('lobbyUpdate', lobby);
    
    // Send draw notification to Discord
    const channel = discordClient.channels.cache.get(CONFIG.MATCH_RESULTS_CHANNEL_ID);
    if (channel) {
      const embed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle('🤝 Match Draw')
        .setDescription(`**Lobby:** ${lobby.id}\nThe match has been declared a draw. No ELO changes.`)
        .addFields(
          { name: '🔵 Team 1', value: lobby.teams.team1.map(p => p.username).join('\n') || 'None', inline: true },
          { name: '🔴 Team 2', value: lobby.teams.team2.map(p => p.username).join('\n') || 'None', inline: true }
        )
        .setTimestamp();
      
      await channel.send({ embeds: [embed] });
    }
    
    // Move players back to main VC
    await movePlayersToMainVC(lobby);
    
    // Delete team VCs
    await deleteTeamVoiceChannels(lobby);
  });

  async function finishMatch(lobby) {
    lobby.phase = 'finished';

    const winnerTeam = lobby.score.team1 >= 2 ? 'team1' : 'team2';
    const winnerIds = lobby.teams[winnerTeam].map(p => p.odiscordId);
    const loserIds = lobby.teams[winnerTeam === 'team1' ? 'team2' : 'team1'].map(p => p.odiscordId);

    // Fetch Minecraft stats and class for all players
    const allPlayers = [...lobby.teams.team1, ...lobby.teams.team2];
    const playerStats = {};
    const playerClasses = {};
    
    for (const player of allPlayers) {
      const mcLink = db.getMinecraftByDiscord(player.odiscordId);
      if (mcLink) {
        const stats = await fetchMinecraftStats(mcLink.uuid);
        const playerClass = await fetchPlayerClass(mcLink.uuid);
        
        if (stats) {
          playerStats[player.odiscordId] = stats;
          playerClasses[player.odiscordId] = playerClass || 'Unknown';
          
          // Update lifetime stats
          const currentPlayer = db.getPlayer(player.odiscordId);
          if (currentPlayer) {
            const updateData = {
              totalKills: (currentPlayer.totalKills || 0) + (stats.kills || 0),
              totalDeaths: (currentPlayer.totalDeaths || 0) + (stats.deaths || 0),
              totalAssists: (currentPlayer.totalAssists || 0) + (stats.assists || 0),
              totalDamage: (currentPlayer.totalDamage || 0) + (stats.damage || 0),
              totalHealing: (currentPlayer.totalHealing || 0) + (stats.healing || 0)
            };
            
            // Update class-specific stats
            if (playerClass && currentPlayer.classStats) {
              const classStats = currentPlayer.classStats[playerClass] || { 
                kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, gamesPlayed: 0, wins: 0 
              };
              const isWinner = winnerIds.includes(player.odiscordId);
              
              updateData.classStats = {
                ...currentPlayer.classStats,
                [playerClass]: {
                  kills: classStats.kills + (stats.kills || 0),
                  deaths: classStats.deaths + (stats.deaths || 0),
                  assists: classStats.assists + (stats.assists || 0),
                  damage: classStats.damage + (stats.damage || 0),
                  healing: classStats.healing + (stats.healing || 0),
                  gamesPlayed: classStats.gamesPlayed + 1,
                  wins: classStats.wins + (isWinner ? 1 : 0)
                }
              };
            }
            
            db.updatePlayer(player.odiscordId, updateData);
          }
        }
      }
    }

    // Calculate ELO (not affected by stats)
    const results = db.processMatchResult(winnerIds, loserIds, lobby.id);
    
    // Add stats and class to results for display
    for (const player of results.winners) {
      player.stats = playerStats[player.odiscordId] || null;
      player.class = playerClasses[player.odiscordId] || null;
    }
    for (const player of results.losers) {
      player.stats = playerStats[player.odiscordId] || null;
      player.class = playerClasses[player.odiscordId] || null;
    }
    
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
    setTimeout(async () => {
      io.to(lobby.id).emit('lobbyClosed', { reason: 'Match complete! Thanks for playing.' });
      await deleteLobby(lobby.id);
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

  socket.on('leaveLobby', async ({ lobbyId }) => {
    const lobby = getLobby(lobbyId);
    
    if (!lobby) return;

    if (lobby.phase !== 'waiting') {
      socket.emit('error', { message: 'Cannot leave after game started' });
      return;
    }

    if (socket.odiscordId === lobby.host.odiscordId) {
      io.to(lobbyId).emit('lobbyClosed', { reason: 'Host left the lobby' });
      await deleteLobby(lobbyId);
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

  socket.on('closeLobby', async ({ lobbyId }) => {
    const lobby = getLobby(lobbyId);
    
    if (!lobby) return;
    
    if (socket.odiscordId !== lobby.host.odiscordId) {
      socket.emit('error', { message: 'Only host can close lobby' });
      return;
    }

    io.to(lobbyId).emit('lobbyClosed', { reason: 'Host closed the lobby' });
    await deleteLobby(lobbyId);
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
