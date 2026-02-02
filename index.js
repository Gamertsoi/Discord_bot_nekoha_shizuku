/* eslint-disable no-inline-comments */
// index.js
const fs = require('fs').promises;
const path = require('path');
const { Client, Events, GatewayIntentBits, Partials, PermissionsBitField } = require('discord.js');
const token = process.env.TOKEN;
const { handleMsg, handleMsgRole, handleClr, handleSet } = require('./commands');
const { reactionMatches } = require('./emojiUtils');
const PERM_FILE = path.join(__dirname, 'permissions.json');
let commandPermissions = {};
const { pushFileToGitHub } = require('./githubSync');

const PREFIX = '!';
const OWNER_ID = process.env.OWNER_ID; // Optional: restrict certain commands to this user ID
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

// RoleMap store
const DATA_FILE = path.join(__dirname, 'reactionRoleMap.json');
const reactionRoleMap = new Map();

async function loadMappings() {
	try {
		const raw = await fs.readFile(DATA_FILE, 'utf8');
		const obj = JSON.parse(raw);
		for (const [msgId, arr] of Object.entries(obj)) {
			reactionRoleMap.set(msgId, arr);
		}
		console.log(`Loaded ${reactionRoleMap.size} reaction-role message entries from disk.`);
	}
	catch (err) {
		if (err.code === 'ENOENT') {
			console.log('No existing mapping file found; starting with empty map.');
		}
		else {
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
	console.log('Saved reaction-role mappings to disk.');

	// Best-effort push to GitHub (optional)
	const githubToken = process.env.GITHUB_TOKEN;
	const githubOwner = process.env.GITHUB_OWNER;
	const githubRepo = process.env.GITHUB_REPO;
	const githubBranch = process.env.GITHUB_BRANCH || 'main';

	if (githubToken && githubOwner && githubRepo) {
		try {
			await pushFileToGitHub({
				owner: githubOwner,
				repo: githubRepo,
				path: path.basename(DATA_FILE), // 'reactionRoleMap.json'
				branch: githubBranch,
				contentObj: obj,
				token: githubToken,
				commitMessage: `Auto-update ${path.basename(DATA_FILE)} by bot`,
			});
			console.log('Pushed reaction-role mappings to GitHub.');
		}
		catch (err) {
			console.warn('Failed to push reaction-role mappings to GitHub:', err.message);
		}
	}
	else {
		console.log('GitHub push skipped: missing GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO env vars.');
	}
}


loadMappings().catch(err => console.error('loadMappings error:', err));

// Prevent crashes from unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
	console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// --- Permissions store ---
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
			console.error('Failed to load permissions:', err);
			commandPermissions = {};
		}
	}
}

async function savePermissions() {
	await fs.writeFile(PERM_FILE, JSON.stringify(commandPermissions, null, 2), 'utf8');
	console.log('Saved command permissions locally.');

	if (process.env.GITHUB_TOKEN && process.env.GITHUB_OWNER && process.env.GITHUB_REPO) {
		try {
			await pushFileToGitHub({
				owner: process.env.GITHUB_OWNER,
				repo: process.env.GITHUB_REPO,
				path: path.basename(PERM_FILE), // 'permissions.json'
				branch: process.env.GITHUB_BRANCH || 'main',
				contentObj: commandPermissions,
				token: process.env.GITHUB_TOKEN,
				commitMessage: `Auto-update ${path.basename(PERM_FILE)} by bot`,
			});
			console.log('Pushed permissions.json to GitHub.');
		}
		catch (err) {
			console.warn('Failed to push permissions to GitHub:', err.message);
		}
	}
}

loadPermissions().catch(console.error);

// Permission check: owner always allowed; if command has roles, member must have at least one
function canRunCommand(command, member) {
	if (!member) return false; // safety
	if (member.id === OWNER_ID) return true;

	const required = commandPermissions[command];
	if (!required || required.length === 0) {
		// no roles configured → only owner allowed
		return false;
	}

	// member must have at least one of the required roles
	for (const roleId of required) {
		if (member.roles.cache.has(roleId)) return true;
	}
	return false;
}

// --- Message handler ---
client.on(Events.MessageCreate, async (message) => {
	if (message.author.bot) return;
	const content = message.content.trim();
	if (!content.startsWith(PREFIX)) return;
	const [command, ...rest] = content.slice(PREFIX.length).split(/\s+/);

	// permission check
	if (!canRunCommand(command, message.member)) {
		return message.channel.send('You do not have permission to use this command.');
	}
	if (command === 'set') {
		await handleSet(message, rest, commandPermissions, savePermissions);
		return;
	}
	if (command === 'msg') {
		await handleMsg(message, rest);
	}
	else if (command === 'msgrole') {
		await handleMsgRole(message, rest, reactionRoleMap, saveMappings);
	}
	else if (command === 'clr') {
		await handleClr(message, rest);
	}
});


// Reaction handlers (updated MessageReactionAdd)
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

		// If a requireRoleId is set, ensure the member already has that role
		if (mapping.requireRoleId && !member.roles.cache.has(mapping.requireRoleId)) {
			const requiredRole = guild.roles.cache.get(mapping.requireRoleId);
			const requiredName = requiredRole ? requiredRole.name : `role ID ${mapping.requireRoleId}`;
			const roleName = role ? role.name : `role ID ${mapping.roleId}`;
			// Try to DM the user privately
			try {
				await member.send(
					`You reacted to a message in ${reaction.message.channel} to get the role **${roleName}**, ` +
        			`but you need the role **${requiredName}** first. ` +
        			'Please obtain that role and try again.',
				);
			}
			catch (dmErr) {
				// DM failed (user may have DMs closed) — ignore, we'll attempt a short channel notice below
				console.debug(`Could not DM ${member.user.tag}: ${dmErr?.message}`);
			}

			// Optional: short in-channel notice that will be deleted after 10s
			try {
				const notice = await reaction.message.channel.send({
					content: `<@${member.id}>, you need the role **${requiredName}** to receive that role. I sent you a DM with details.`,
				});
				setTimeout(() => {
					notice.delete().catch(() => {
						// ignore
					});
				}, 10_000);
			}
			catch (chanErr) {
				console.debug('Could not send ephemeral-like channel notice:', chanErr?.message);
			}

			// Do not grant the role
			return;
		}

		const role = guild.roles.cache.get(mapping.roleId);
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
	}
	catch (err) {
		console.error('Error in messageReactionRemove handler:', err);
	}
});

// Auto-cleanup handlers (unchanged)
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
			const filtered = mappings.filter(m => m.roleId !== role.id);
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
	}
	catch (err) {
		console.error('Error during GuildRoleDelete cleanup:', err);
	}
});


client.once(Events.ClientReady, (readyClient) => {
	console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.login(token);