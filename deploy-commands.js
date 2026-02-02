// deploy-commands.js
const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID; // your bot's application ID
const guildId = process.env.GUILD_ID;   // optional: register per guild for faster dev

const commands = [
  new SlashCommandBuilder()
    .setName('msg')
    .setDescription('Send a message to a channel')
    .addChannelOption(opt =>
      opt.setName('channel').setDescription('Target channel').setRequired(true))
    .addStringOption(opt =>
      opt.setName('text').setDescription('Message text').setRequired(true)),

  new SlashCommandBuilder()
    .setName('msgrole')
    .setDescription('Set up reaction role mapping')
    .addStringOption(opt =>
      opt.setName('message_id').setDescription('Target message ID').setRequired(true))
    .addStringOption(opt =>
      opt.setName('emoji').setDescription('Emoji').setRequired(true))
    .addRoleOption(opt =>
      opt.setName('give_role').setDescription('Role to give').setRequired(true))
    .addRoleOption(opt =>
      opt.setName('require_role').setDescription('Role required before giving').setRequired(false)),

  new SlashCommandBuilder()
    .setName('clr')
    .setDescription('Clear messages in a channel')
    .addChannelOption(opt =>
      opt.setName('channel').setDescription('Target channel').setRequired(true))
    .addStringOption(opt =>
      opt.setName('count').setDescription('Number or "all"').setRequired(true)),

  new SlashCommandBuilder()
    .setName('set')
    .setDescription('Manage command permissions')
    .addStringOption(opt =>
      opt.setName('command').setDescription('Command name').setRequired(true))
    .addRoleOption(opt =>
      opt.setName('role').setDescription('Role to permit/remove').setRequired(false))
    .addStringOption(opt =>
      opt.setName('action').setDescription('add/remove/list').setRequired(true)
      .addChoices(
        { name: 'add', value: 'add' },
        { name: 'remove', value: 'remove' },
        { name: 'list', value: 'list' }
      )),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands },
    );
    console.log('Slash commands registered.');
  } catch (error) {
    console.error(error);
  }
})();
