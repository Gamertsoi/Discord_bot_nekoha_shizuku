// index.js
const { Client, Events, GatewayIntentBits, Partials, PermissionsBitField } = require('discord.js');
const { handleMsg, handleMsgRole, handleClr } = require('./commands');
const { reactionMatches } = require('./emojiUtils');

// Use environment variable for token (Railway Variables)
const token = process.env.TOKEN;
const PREFIX = '!';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Reaction-role mappings (in-memory or persisted via JSON as you already set up)
const fs = require('fs').promises;
const path = require('path');
const DATA_FILE = path.join(__dirname, 'reactionRoleMap.json');
const reactionRoleMap = new Map();

async function loadMappings() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const obj = JSON.parse(raw);
    for (const [msgId, arr] of Object.entries(obj)) {
      reactionRoleMap.set(msgId, arr);
    }
    console.log(`Loaded ${reactionRoleMap.size} mappings.`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('No mapping file found, starting fresh.');
    } else {
      console.error('Failed to load mappings:', err);
    }
  }
}

async function saveMappings() {
  const obj = {};
  for (const [msgId, arr] of reactionRoleMap.entries()) {
    obj[msgId] = arr;
  }
  await fs.writeFile(DATA_FILE, JSON.stringify(obj, null, 2), 'utf8');
  console.log('Saved mappings.');
}

loadMappings().catch(console.error);

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim();
  if (!content.startsWith(PREFIX)) return;
  const [command, ...rest] = content.slice(PREFIX.length).split(/\s+/);

  if (command === 'msg') {
    await handleMsg(message, rest);
  } else if (command === 'msgrole') {
    await handleMsgRole(message, rest, reactionRoleMap, saveMappings);
  } else if (command === 'clr') {
    await handleClr(message, rest);
  }
});

// Reaction add/remove handlers
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    const mappings = reactionRoleMap.get(reaction.message.id);
    if (!mappings) return;

    const mapping = mappings.find(m => reactionMatches(m.emojiId, reaction));
    if (!mapping) return;

    const guild = reaction.message.guild;
    if (!guild) return;

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    const role = guild.roles.cache.get(mapping.roleId);
    if (!role) return;

    const me = guild.members.me;
    if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return;
    if (role.position >= me.roles.highest.position) return;

    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role);
      console.log(`Added role ${role.name} to ${member.user.tag}`);
    }
  } catch (err) {
    console.error('Error in reaction add:', err);
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    const mappings = reactionRoleMap.get(reaction.message.id);
    if (!mappings) return;

    const mapping = mappings.find(m => reactionMatches(m.emojiId, reaction));
    if (!mapping) return;

    const guild = reaction.message.guild;
    if (!guild) return;

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    const role = guild.roles.cache.get(mapping.roleId);
    if (!role) return;

    const me = guild.members.me;
    if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return;
    if (role.position >= me.roles.highest.position) return;

    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role);
      console.log(`Removed role ${role.name} from ${member.user.tag}`);
    }
  } catch (err) {
    console.error('Error in reaction remove:', err);
  }
});

// Auto-cleanup
client.on(Events.MessageDelete, async (message) => {
  const msgId = message.id;
  if (reactionRoleMap.has(msgId)) {
    reactionRoleMap.delete(msgId);
    await saveMappings();
    console.log(`Removed mappings for deleted message ${msgId}`);
  }
});

client.on(Events.GuildRoleDelete, async (role) => {
  let changed = false;
  for (const [msgId, mappings] of Array.from(reactionRoleMap.entries())) {
    const filtered = mappings.filter(m => m.roleId !== role.id);
    if (filtered.length === 0 && mappings.length > 0) {
      reactionRoleMap.delete(msgId);
      changed = true;
    } else if (filtered.length !== mappings.length) {
      reactionRoleMap.set(msgId, filtered);
      changed = true;
    }
  }
  if (changed) {
    await saveMappings();
    console.log(`Cleaned up mappings referencing deleted role ${role.id}`);
  }
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.login(token);
