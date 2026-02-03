/* eslint-disable no-inline-comments */
// index.js
const fs = require('fs').promises;
const path = require('path');
const {
	Client,
	Events,
	GatewayIntentBits,
	Partials,
	PermissionsBitField,
} = require('discord.js');

const { handleMsg, handleMsgRole, handleClr, handleSet } = require('./commands');
const { reactionMatches } = require('./emojiUtils');
const { pushFileToGitHub } = require('./githubSync');

const token = process.env.TOKEN;
const OWNER_ID = process.env.OWNER_ID || null;
const PREFIX = '!';
const PERM_FILE = path.join(__dirname, 'permissions.json');
const DATA_FILE = path.join(__dirname, 'reactionRoleMap.json');

let commandPermissions = {};
const reactionRoleMap = new Map();

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

// Load/save helpers
async function loadMappings() {
	try {
		const raw = await fs.readFile(DATA_FILE, 'utf8');
		const obj = JSON.parse(raw);
		for (const [msgId, arr] of Object.entries(obj)) reactionRoleMap.set(msgId, arr);
		console.log(`Loaded ${reactionRoleMap.size} reaction-role message entries from disk.`);
	}
	catch (err) {
		if (err && err.code === 'ENOENT') console.log('No existing mapping file found; starting with empty map.');
		else console.error('Failed to load mappings:', err?.message || err);
	}
}

async function saveMappings() {
	const obj = {};
	for (const [msgId, arr] of reactionRoleMap.entries()) obj[msgId] = arr;

	try {
		await fs.writeFile(DATA_FILE, JSON.stringify(obj, null, 2), 'utf8');
		console.log('Saved reaction-role mappings to disk.');
	}
	catch (err) {
		console.error('Failed to write mappings to disk:', err?.message || err);
	}

	const githubToken = process.env.GITHUB_TOKEN;
	const githubOwner = process.env.GITHUB_OWNER;
	const githubRepo = process.env.GITHUB_REPO;
	const githubBranch = process.env.GITHUB_BRANCH || 'main';

	if (githubToken && githubOwner && githubRepo) {
		try {
			await pushFileToGitHub({
				owner: githubOwner,
				repo: githubRepo,
				path: path.basename(DATA_FILE),
				branch: githubBranch,
				contentObj: obj,
				token: githubToken,
				commitMessage: `Auto-update ${path.basename(DATA_FILE)} by bot`,
			});
			console.log('Pushed reaction-role mappings to GitHub.');
		}
		catch (err) {
			console.warn('Failed to push reaction-role mappings to GitHub:', err?.message || err);
		}
	}
	else {
		console.log('GitHub push skipped: missing GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO env vars.');
	}
}

async function loadPermissions() {
	try {
		const raw = await fs.readFile(PERM_FILE, 'utf8');
		commandPermissions = JSON.parse(raw) || {};
		console.log('Loaded command permissions.');
	}
	catch (err) {
		if (err && err.code === 'ENOENT') {
			console.log('No permissions file, starting fresh.');
			commandPermissions = {};
		}
		else {
			console.error('Failed to load permissions:', err?.message || err);
			commandPermissions = {};
		}
	}
}

async function savePermissions() {
	try {
		await fs.writeFile(PERM_FILE, JSON.stringify(commandPermissions, null, 2), 'utf8');
		console.log('Saved command permissions locally.');
	}
	catch (err) {
		console.error('Failed to write permissions to disk:', err?.message || err);
	}

	if (process.env.GITHUB_TOKEN && process.env.GITHUB_OWNER && process.env.GITHUB_REPO) {
		try {
			await pushFileToGitHub({
				owner: process.env.GITHUB_OWNER,
				repo: process.env.GITHUB_REPO,
				path: path.basename(PERM_FILE),
				branch: process.env.GITHUB_BRANCH || 'main',
				contentObj: commandPermissions,
				token: process.env.GITHUB_TOKEN,
				commitMessage: `Auto-update ${path.basename(PERM_FILE)} by bot`,
			});
			console.log('Pushed permissions.json to GitHub.');
		}
		catch (err) {
			console.warn('Failed to push permissions to GitHub:', err?.message || err);
		}
	}
}

loadMappings().catch(err => console.error('loadMappings error:', err));
loadPermissions().catch(err => console.error('loadPermissions error:', err));

process.on('unhandledRejection', (reason, promise) => {
	console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Permission helper
function canRunCommand(command, member) {
	if (!member) return false;
	if (String(member.id) === String(OWNER_ID)) return true;
	const required = commandPermissions[command];
	if (!required || required.length === 0) return false;
	return required.some(roleId => member.roles.cache.has(roleId));
}

// Message handler
client.on(Events.MessageCreate, async (message) => {
	if (message.author.bot) return;
	const content = message.content.trim();
	if (!content.startsWith(PREFIX)) return;
	const [command, ...rest] = content.slice(PREFIX.length).split(/\s+/);

	if (!canRunCommand(command, message.member)) {
		await message.channel.send('You do not have permission to use this command.');
		return;
	}

	try {
		if (command === 'set') {
			await handleSet(message, rest, commandPermissions, savePermissions);
		}
		else if (command === 'msg') {
			await handleMsg(message, rest);
		}
		else if (command === 'msgrole') {
			await handleMsgRole(message, rest, reactionRoleMap, saveMappings);
		}
		else if (command === 'clr') {
			await handleClr(message, rest);
		}
	}
	catch (err) {
		console.error('Error handling message command:', err);
		try { await message.channel.send('An error occurred while processing your command.'); }
		catch { /* ignore */ }
	}
});

client.on(Events.InteractionCreate, async (interaction) => {
	// Button interactions for claim flow (place at top of InteractionCreate handler)
	if (interaction.isButton && interaction.customId && interaction.customId.startsWith('rr|')) {
		try {
			const parts = interaction.customId.split('|');
			const messageId = parts[1];
			const emojiId = decodeURIComponent(parts[2] || '');
			const roleId = parts[3];

			const mappings = reactionRoleMap.get(messageId) || [];
			const mapping = mappings.find(m => m.emojiId === emojiId && m.roleId === roleId);

			if (!mapping) {
				await interaction.reply({ content: 'This role mapping no longer exists.', ephemeral: true });
				return;
			}

			const guild = interaction.guild;
			if (!guild) {
				await interaction.reply({ content: 'Guild context not available.', ephemeral: true });
				return;
			}

			const member = interaction.member;
			if (!member) {
				await interaction.reply({ content: 'Member info not available.', ephemeral: true });
				return;
			}

			// If user lacks the required role, reply ephemerally and return (no DM, no public message)
			if (mapping.requireRoleId && !member.roles.cache.has(mapping.requireRoleId)) {
				const requiredRole = guild.roles.cache.get(mapping.requireRoleId);
				const requiredName = requiredRole ? requiredRole.name : `role ID ${mapping.requireRoleId}`;
				await interaction.reply({
					content: `You need the role **${requiredName}** before you can claim this role.`,
					ephemeral: true,
				});
				return;
			}

			// Resolve role and check bot permissions
			const role = guild.roles.cache.get(mapping.roleId);
			if (!role) {
				await interaction.reply({ content: 'Target role not found (it may have been deleted).', ephemeral: true });
				return;
			}

			const me = guild.members.me;
			if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
				await interaction.reply({ content: 'I do not have permission to manage roles.', ephemeral: true });
				return;
			}
			if (role.position >= me.roles.highest.position) {
				await interaction.reply({ content: 'I cannot assign that role due to role hierarchy.', ephemeral: true });
				return;
			}

			// Add role if user doesn't already have it
			if (!member.roles.cache.has(role.id)) {
				await member.roles.add(role);
				await interaction.reply({ content: `You have been given the role **${role.name}**.`, ephemeral: true });
			}
			else {
				await interaction.reply({ content: `You already have the role **${role.name}**.`, ephemeral: true });
			}
		}
		catch (err) {
			console.error('Error handling claim button interaction:', err);
			try { if (!interaction.replied) await interaction.reply({ content: 'An error occurred.', ephemeral: true }); }
			catch { /* ignore */ }
		}
		return;
	}
	// ...existing code...
});

// Reaction handlers (fallback for reaction-based assignment)
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

		const member = await guild.members.fetch(user.id).catch(fetchErr => {
			console.debug('Failed to fetch member for reaction add:', fetchErr?.message || fetchErr);
			return null;
		});
		if (!member) return;

		const role = guild.roles.cache.get(mapping.roleId);
		// const roleName = role ? role.name : `role ID ${mapping.roleId}`;

		if (mapping.requireRoleId && !member.roles.cache.has(mapping.requireRoleId)) {
			// Remove the user's reaction to avoid confusion (best-effort)
			try {
				// reaction.users.remove may require the bot to have Manage Messages permission in some contexts
				await reaction.users.remove(user.id).catch(() => null);
			}
			catch (removeErr) {
				// ignore removal errors; we intentionally do not notify publicly or DM
				console.debug('Could not remove reaction:', removeErr?.message || removeErr);
			}
			// Do not DM or send a public message; return silently
			return;
		}

		if (!role) return;

		const me = guild.members.me;
		if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return;
		if (role.position >= me.roles.highest.position) return;

		if (!member.roles.cache.has(role.id)) {
			await member.roles.add(role);
			console.log(`Added role ${role.name} to ${member.user.tag}`);
		}
	}
	catch (err) {
		console.error('Error in messageReactionAdd handler:', err);
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

		const member = await guild.members.fetch(user.id).catch(fetchErr => {
			console.debug('Failed to fetch member for reaction remove:', fetchErr?.message || fetchErr);
			return null;
		});
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
	}
	catch (err) {
		console.error('Error in messageReactionRemove handler:', err);
	}
});

// Cleanup handlers
client.on(Events.MessageDelete, async (message) => {
	try {
		const msgId = message.id;
		if (reactionRoleMap.has(msgId)) {
			reactionRoleMap.delete(msgId);
			await saveMappings();
			console.log(`Removed mappings for deleted message ${msgId}`);
		}
	}
	catch (err) {
		console.error('Error during MessageDelete cleanup:', err);
	}
});

client.on(Events.GuildRoleDelete, async (role) => {
	try {
		let changed = false;
		for (const [msgId, mappings] of Array.from(reactionRoleMap.entries())) {
			const filtered = mappings.filter(m => m.roleId !== role.id && m.requireRoleId !== role.id);
			if (filtered.length === 0 && mappings.length > 0) {
				reactionRoleMap.delete(msgId);
				changed = true;
			}
			else if (filtered.length !== mappings.length) {
				reactionRoleMap.set(msgId, filtered);
				changed = true;
			}
		}
		if (changed) {
			await saveMappings();
			console.log(`Cleaned up mappings referencing deleted role ${role.id}`);
		}

		let permChanged = false;
		for (const [cmd, arr] of Object.entries(commandPermissions)) {
			const filtered = (arr || []).filter(id => id !== role.id);
			if (filtered.length !== (arr || []).length) {
				if (filtered.length === 0) delete commandPermissions[cmd];
				else commandPermissions[cmd] = filtered;
				permChanged = true;
			}
		}
		if (permChanged) {
			await savePermissions();
			console.log(`Cleaned up permissions referencing deleted role ${role.id}`);
		}
	}
	catch (err) {
		console.error('Error during GuildRoleDelete cleanup:', err);
	}
});

client.once(Events.ClientReady, (readyClient) => {
	console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.login(token).catch(err => {
	console.error('Failed to login:', err);
	process.exit(1);
});
