// deploy-commands.js
// Registers slash commands for your Discord application.
// Usage (local): CLIENT_ID=... GUILD_ID=... TOKEN=... node deploy-commands.js
// If you prefer .env, create a .env file and uncomment the dotenv line below.

// require('dotenv').config();

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
// eslint-disable-next-line no-inline-comments
const guildId = process.env.GUILD_ID || null; // optional: use for fast guild registration

if (!token || !clientId) {
	console.error('Missing required environment variables. Please set TOKEN and CLIENT_ID.');
	process.exit(1);
}

// Build commands. Required options must be added before optional options.
const commands = [
	new SlashCommandBuilder()
		.setName('msg')
		.setDescription('Send a message to a channel')
	// required options first
		.addChannelOption(opt => opt
			.setName('channel')
			.setDescription('Target channel')
			.setRequired(true))
		.addStringOption(opt => opt
			.setName('text')
			.setDescription('Message text')
			.setRequired(true))
		.toJSON(),

	new SlashCommandBuilder()
		.setName('msgrole')
		.setDescription('Register a reaction-role mapping for an existing message')
	// required options first
		.addStringOption(opt => opt
			.setName('message_id')
			.setDescription('Target message ID')
			.setRequired(true))
		.addStringOption(opt => opt
			.setName('emoji')
			.setDescription('Emoji (unicode or custom like name:id)')
			.setRequired(true))
		.addRoleOption(opt => opt
			.setName('give_role')
			.setDescription('Role to give when reacting')
			.setRequired(true))
	// optional options must come after required ones
		.addRoleOption(opt => opt
			.setName('require_role')
			.setDescription('Optional role required before giving the role')
			.setRequired(false))
		.toJSON(),

	new SlashCommandBuilder()
		.setName('clr')
		.setDescription('Clear messages in a channel')
		.addChannelOption(opt => opt
			.setName('channel')
			.setDescription('Target channel to clear')
			.setRequired(true))
		.addStringOption(opt => opt
			.setName('count')
			.setDescription('Number of messages to delete or "all"')
			.setRequired(true))
		.toJSON(),

	new SlashCommandBuilder()
		.setName('set')
		.setDescription('Manage command permissions (owner only)')
	// required options first
		.addStringOption(opt => opt
			.setName('command')
			.setDescription('Command name to modify (e.g., msgrole, clr)')
			.setRequired(true))
		.addStringOption(opt => opt
			.setName('action')
			.setDescription('Action to perform')
			.setRequired(true)
			.addChoices(
				{ name: 'add', value: 'add' },
				{ name: 'remove', value: 'remove' },
				{ name: 'list', value: 'list' },
			))
	// optional role argument must come after required ones
		.addRoleOption(opt => opt
			.setName('role')
			.setDescription('Role to add or remove (not required for list)')
			.setRequired(false))
		.toJSON(),
];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
	try {
		console.log('Registering slash commands...');
		if (guildId) {
			// Register to a single guild (instant)
			await rest.put(
				Routes.applicationGuildCommands(clientId, guildId),
				{ body: commands },
			);
			console.log(`Successfully registered ${commands.length} guild commands to guild ${guildId}.`);
		}
		else {
			// Register globally (may take up to an hour to propagate)
			await rest.put(
				Routes.applicationCommands(clientId),
				{ body: commands },
			);
			console.log(`Successfully registered ${commands.length} global commands. Note: global commands can take up to an hour to appear.`);
		}
	}
	catch (err) {
		console.error('Failed to register commands:', err);
		process.exit(1);
	}
})();
