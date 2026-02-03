/* eslint-disable no-inline-comments */
// commands.js
const { PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { normalizeEmojiInput } = require('./emojiUtils');
const OWNER_ID = process.env.OWNER_ID || null;

/**
 * handleSet(message, args, commandPermissions, savePermissions)
 * Manage command permission roles: list, add, remove
 */
async function handleSet(message, args, commandPermissions, savePermissions) {
	args = args || [];

	// list
	if (args.length === 1 && args[0].toLowerCase() === 'list') {
		const entries = Object.entries(commandPermissions || {});
		if (entries.length === 0) return message.channel.send('No command restrictions have been set.');

		const lines = [];
		for (const [cmd, roleIds] of entries) {
			const roleNames = (roleIds || [])
				.map(id => {
					const r = message.guild.roles.cache.get(id);
					return r ? `${r.name} (<@&${id}>)` : `(deleted role: ${id})`;
				})
				.join(', ');
			lines.push(`${cmd} → ${roleNames}`);
		}

		const chunkSize = 1900;
		let out = '**Current command restrictions:**\n';
		for (const line of lines) {
			if ((out + line + '\n').length > chunkSize) {
				await message.channel.send(out);
				out = '';
			}
			out += line + '\n';
		}
		if (out.length > 0) await message.channel.send(out);
		return;
	}

	// permission: owner only by default
	const isOwner = message.author.id === OWNER_ID;
	if (!isOwner) return message.channel.send('Only the bot owner can manage command permissions.');

	// remove: !set <cmd> <role> remove
	if (args.length >= 2 && args[args.length - 1].toLowerCase() === 'remove') {
		const targetCmd = args[0].toLowerCase();
		const roleArg = args.slice(1, -1).join(' ');
		const role =
      message.mentions.roles.first() ||
      message.guild.roles.cache.get(roleArg) ||
      message.guild.roles.cache.find(r => r.name === roleArg) ||
      message.guild.roles.cache.find(r => r.name.toLowerCase() === roleArg.toLowerCase());

		if (!role) return message.channel.send('Role not found.');

		const arr = commandPermissions[targetCmd] || [];
		const filtered = arr.filter(id => id !== role.id);
		if (filtered.length === arr.length) {
			return message.channel.send(`Role ${role.name} was not permitted for command \`${targetCmd}\`.`);
		}

		if (filtered.length === 0) delete commandPermissions[targetCmd];
		else commandPermissions[targetCmd] = filtered;

		await savePermissions();
		return message.channel.send(`Removed role ${role.name} from permitted list for \`${targetCmd}\`.`);
	}

	// add: !set <cmd> <role>
	if (args.length < 2) {
		return message.channel.send('Usage: !set <command> <role_name_or_id_or_mention> | !set <command> <role> remove | !set list');
	}

	const targetCmd = args[0].toLowerCase();
	const roleArg = args.slice(1).join(' ');

	const role =
    message.mentions.roles.first() ||
    message.guild.roles.cache.get(roleArg) ||
    message.guild.roles.cache.find(r => r.name === roleArg) ||
    message.guild.roles.cache.find(r => r.name.toLowerCase() === roleArg.toLowerCase());

	if (!role) return message.channel.send('Role not found.');

	const arr = commandPermissions[targetCmd] || [];
	if (arr.includes(role.id)) {
		return message.channel.send(`Role ${role.name} is already permitted to use \`${targetCmd}\`.`);
	}

	arr.push(role.id);
	commandPermissions[targetCmd] = arr;
	await savePermissions();

	return message.channel.send(`Added role ${role.name} to permitted list for \`${targetCmd}\`.`);
}

/**
 * handleMsg(message, args)
 * Send a message to a channel
 */
async function handleMsg(message, args) {
	const rawTarget = args[0];
	const text = args.slice(1).join(' ');
	if (!rawTarget || !text) return message.reply('Usage: !msg <#channel|channel_id|channel-name> <message>');

	let targetChannel = message.mentions.channels.first() || null;

	if (!targetChannel) {
		const idMatch = rawTarget.match(/^<#?(\d+)>?$/);
		const maybeId = idMatch ? idMatch[1] : rawTarget;
		try {
			targetChannel = await message.guild.channels.fetch(maybeId).catch(fetchErr => {
				console.debug('Channel fetch failed:', fetchErr?.message || fetchErr);
				return null;
			});
		}
		catch (fetchErr) {
			console.debug('Channel fetch error:', fetchErr?.message || fetchErr);
			targetChannel = null;
		}
	}

	if (!targetChannel) targetChannel = message.guild.channels.cache.find(c => c.name === rawTarget);
	if (!targetChannel) return message.reply('Channel not found in this server.');

	const me = message.guild.members.me;
	if (!targetChannel.permissionsFor(me).has(PermissionsBitField.Flags.SendMessages)) {
		return message.reply('I do not have permission to send messages in that channel.');
	}

	try {
		await targetChannel.send(text);
		await message.channel.send(`✅ Sent your message to <#${targetChannel.id}>`);
	}
	catch (err) {
		console.error('handleMsg send error:', err);
		try { await message.channel.send('Failed to send message. Check permissions and channel type.'); }
		catch { /* ignore */ }
	}
}

/**
 * handleMsgRole(message, args, reactionRoleMap, saveMappings)
 * Add/remove/list reaction-role mappings. Adds a "Claim role" button for ephemeral interaction.
 */
async function handleMsgRole(message, args, reactionRoleMap, saveMappings) {
	args = args || [];

	// list
	if (args.length === 1 && args[0].toLowerCase() === 'list') {
		if (reactionRoleMap.size === 0) return message.channel.send('No reaction-role mappings registered.');

		const lines = [];
		for (const [msgId, mappings] of reactionRoleMap.entries()) {
			for (const m of mappings) {
				const giveRole = message.guild.roles.cache.get(m.roleId);
				if (!giveRole) continue;
				const channelId = m.channelId || message.channel.id;
				const link = `https://discord.com/channels/${message.guild.id}/${channelId}/${msgId}`;
				const requirePart = m.requireRoleId
					? ` (requires ${ (message.guild.roles.cache.get(m.requireRoleId) || { name: `(deleted role: ${m.requireRoleId})` }).name } <@&${m.requireRoleId}>)`
					: '';
				lines.push(`<${link}> \`${m.emojiId}\` → ${giveRole.name} (<@&${giveRole.id}>)${requirePart}`);
			}
		}

		if (lines.length === 0) return message.channel.send('No reaction-role mappings found for this server.');

		const chunkSize = 1900;
		let out = '';
		for (const line of lines) {
			if ((out + line + '\n').length > chunkSize) {
				await message.channel.send(out);
				out = '';
			}
			out += line + '\n';
		}
		if (out.length > 0) await message.channel.send(out);
		return;
	}

	// remove
	if (args.length >= 1 && args[0].toLowerCase() === 'remove') {
		if (args.length < 3) return message.channel.send('Usage: !msgrole remove <message_id> <emoji>');
		if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
			return message.channel.send('You need the Manage Roles permission to use this command.');
		}

		const messageId = args[1];
		const rawEmoji = args[2];
		const emojiId = normalizeEmojiInput(rawEmoji);

		const existing = reactionRoleMap.get(messageId);
		if (!existing) return message.channel.send('No mappings found for that message ID.');

		const filtered = existing.filter(m => m.emojiId !== emojiId);
		if (filtered.length === existing.length) {
			return message.channel.send('No mapping found for that emoji on the specified message.');
		}

		if (filtered.length === 0) reactionRoleMap.delete(messageId);
		else reactionRoleMap.set(messageId, filtered);

		try { await saveMappings(); }
		catch (saveErr) { console.warn('Failed to save mappings after removal:', saveErr?.message || saveErr); }

		return message.channel.send(`Removed mapping for emoji \`${rawEmoji}\` on message ${messageId}.`);
	}

	// add mapping
	if (args.length < 3) {
		return message.channel.send('Usage: !msgrole <message_id> <emoji> <give_role_name_or_mention_or_id> [require_role_name_or_mention_or_id] or !msgrole list or !msgrole remove <message_id> <emoji>');
	}

	if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
		return message.channel.send('You need the Manage Roles permission to use this command.');
	}

	const messageId = args[0];
	const rawEmoji = args[1];
	const emojiId = normalizeEmojiInput(rawEmoji);

	// Determine giveRoleArg and optional requireRoleArg
	let giveRoleArg = null;
	let requireRoleArg = null;

	if (args.length === 3) {
		giveRoleArg = args.slice(2).join(' ');
	}
	else {
		const possibleRequire = args[args.length - 1];
		const tryResolveRequire =
      message.mentions.roles.first() ||
      message.guild.roles.cache.get(possibleRequire) ||
      message.guild.roles.cache.find(r => r.name === possibleRequire) ||
      message.guild.roles.cache.find(r => r.name.toLowerCase() === possibleRequire.toLowerCase());

		if (tryResolveRequire) {
			requireRoleArg = possibleRequire;
			giveRoleArg = args.slice(2, -1).join(' ');
		}
		else {
			giveRoleArg = args.slice(2).join(' ');
		}
	}

	// Resolve giveRole
	let giveRole = null;
	if (message.mentions.roles.size > 0) {
		giveRole = message.mentions.roles.first();
		if (requireRoleArg && message.mentions.roles.size > 1) {
			const maybe = message.mentions.roles.find(r => r.name.toLowerCase() === giveRoleArg.toLowerCase() || `<@&${r.id}>` === giveRoleArg);
			if (maybe) giveRole = maybe;
		}
	}
	if (!giveRole) {
		giveRole = message.guild.roles.cache.get(giveRoleArg) ||
               message.guild.roles.cache.find(r => r.name === giveRoleArg) ||
               message.guild.roles.cache.find(r => r.name.toLowerCase() === giveRoleArg.toLowerCase()) || null;
	}

	if (!giveRole) return message.channel.send('Give role not found. Use a role mention, role ID, or exact role name.');

	// Resolve requireRole
	let requireRole = null;
	if (requireRoleArg) {
		const mentionedRoles = message.mentions.roles;
		if (mentionedRoles.size > 1) {
			const mentionsArray = Array.from(mentionedRoles.values());
			requireRole = mentionsArray.find(r => r.id !== giveRole.id) || mentionsArray[0];
		}
		else {
			requireRole = message.guild.roles.cache.get(requireRoleArg) ||
                    message.guild.roles.cache.find(r => r.name === requireRoleArg) ||
                    message.guild.roles.cache.find(r => r.name.toLowerCase() === requireRoleArg.toLowerCase()) || null;
		}
		if (!requireRole) return message.channel.send('Require role not found. Use a role mention, role ID, or exact role name.');
	}

	// Find target message and channelId
	let targetMessage = null;
	let targetChannelId = null;
	try {
		const textChannels = message.guild.channels.cache.filter(ch =>
			ch.isTextBased() && ch.viewable && ch.permissionsFor(message.guild.members.me).has(PermissionsBitField.Flags.ViewChannel),
		);

		for (const ch of textChannels.values()) {
			try {
				targetMessage = await ch.messages.fetch(messageId);
				if (targetMessage) {
					targetChannelId = ch.id;
					break;
				}
			}
			catch (fetchErr) {
				console.debug('Message fetch failed in channel:', ch.id, fetchErr?.message || fetchErr);
			}
		}
	}
	catch (err) {
		console.error('Error fetching message:', err);
	}

	if (!targetMessage) {
		return message.channel.send('Could not find that message in this server. Make sure the message ID is correct and the bot can view the channel.');
	}

	const me = message.guild.members.me;
	if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
		return message.channel.send('I need the Manage Roles permission to assign roles.');
	}
	if (giveRole.position >= me.roles.highest.position) {
		return message.channel.send('I cannot assign that role because it is equal or higher than my highest role.');
	}

	const existing = reactionRoleMap.get(messageId) || [];
	if (existing.some(e =>
		e.emojiId === emojiId &&
    e.roleId === giveRole.id &&
    ((e.requireRoleId || null) === (requireRole ? requireRole.id : null)),
	)) {
		return message.channel.send('This emoji-role mapping already exists for that message with the same requirement.');
	}

	existing.push({
		emojiId,
		roleId: giveRole.id,
		channelId: targetChannelId,
		requireRoleId: requireRole ? requireRole.id : null,
	});
	reactionRoleMap.set(messageId, existing);

	try { await saveMappings(); }
	catch (saveErr) { console.warn('Failed to save mappings:', saveErr?.message || saveErr); }

	// Try to add reaction to the target message
	try {
		const customMatch = emojiId.match(/^([a-zA-Z0-9_]+):(\d+)$/);
		if (customMatch) {
			const emojiObj = message.guild.emojis.cache.get(customMatch[2]);
			if (emojiObj) await targetMessage.react(emojiObj);
		}
		else {
			await targetMessage.react(emojiId);
		}
	}
	catch (reactErr) {
		console.warn('Could not add reaction to target message:', reactErr?.message || reactErr);
	}

	// Add a "Claim role" button so users can click and receive ephemeral replies
	try {
		const customId = `rr|${messageId}|${encodeURIComponent(emojiId)}|${giveRole.id}`;
		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId(customId)
				.setLabel('Claim role')
				.setStyle(ButtonStyle.Primary),
		);

		// If bot can edit the message, attach components; otherwise reply with the button
		try {
			await targetMessage.edit({ components: [row] });
		}
		catch {
			await targetMessage.reply({ content: 'Click the button to claim the role:', components: [row] });
		}
	}
	catch (btnErr) {
		console.debug('Could not add claim button:', btnErr?.message || btnErr);
	}

	return message.channel.send(
		`Registered reaction-role: react with \`${rawEmoji}\` on message ${messageId} to get role <@&${giveRole.id}>` +
    (requireRole ? ` (requires <@&${requireRole.id}>).` : '.'),
	);
}

/**
 * handleClr(message, args)
 * Clear messages in a channel
 */
async function handleClr(message, args) {
	if (!args || args.length < 2) return message.channel.send('Usage: !clr <#channel|channel_id> <number|all>');
	if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
		return message.channel.send('You need the Manage Messages permission to use this command.');
	}

	const channelArg = args[0];
	const countArg = String(args[1]).toLowerCase();

	let targetChannel = message.mentions.channels.first() || null;
	if (!targetChannel) {
		const idMatch = channelArg.match(/^<#?(\d+)>?$/);
		const maybeId = idMatch ? idMatch[1] : channelArg;
		try {
			targetChannel = await message.guild.channels.fetch(maybeId).catch(fetchErr => {
				console.debug('Channel fetch failed:', fetchErr?.message || fetchErr);
				return null;
			});
		}
		catch (fetchErr) {
			console.debug('Channel fetch error:', fetchErr?.message || fetchErr);
			targetChannel = null;
		}
	}
	if (!targetChannel) targetChannel = message.guild.channels.cache.find(c => c.name === channelArg);
	if (!targetChannel) return message.channel.send('Channel not found in this server.');

	const me = message.guild.members.me;
	const needed = [
		PermissionsBitField.Flags.ViewChannel,
		PermissionsBitField.Flags.ReadMessageHistory,
		PermissionsBitField.Flags.ManageMessages,
	];
	for (const perm of needed) {
		if (!targetChannel.permissionsFor(me).has(perm)) {
			return message.channel.send('I need View Channel, Read Message History and Manage Messages permissions in that channel to clear messages.');
		}
	}

	async function bulkDeleteCollection(col) {
		if (!col || col.size === 0) return 0;
		try {
			await targetChannel.bulkDelete(col, true);
			return col.size;
		}
		catch (err) {
			console.warn('bulkDelete failed:', err?.message || err);
			return 0;
		}
	}

	const excludeCommandId = message.id;

	if (countArg === 'all') {
		let totalDeleted = 0;
		try {
			while (true) {
				const fetched = await targetChannel.messages.fetch({ limit: 100 });
				if (!fetched || fetched.size === 0) break;

				const filteredFetched = fetched.filter(m => m.id !== excludeCommandId);

				const now = Date.now();
				const fourteenDays = 14 * 24 * 60 * 60 * 1000;
				const bulkable = filteredFetched.filter(m => (now - m.createdTimestamp) < fourteenDays);
				const older = filteredFetched.filter(m => (now - m.createdTimestamp) >= fourteenDays);

				if (bulkable.size > 0) {
					await bulkDeleteCollection(bulkable);
					totalDeleted += bulkable.size;
				}

				for (const oldMsg of older.values()) {
					try {
						await oldMsg.delete();
						totalDeleted++;
						await new Promise(res => setTimeout(res, 250));
					}
					catch (delErr) {
						console.debug(`Failed to delete old message ${oldMsg.id}: ${delErr?.message || delErr}`);
					}
				}

				if (fetched.size < 100) break;
			}

			try { await message.channel.send(`Cleared messages in <#${targetChannel.id}>. Total deleted (approx): ${totalDeleted}`); }
			catch (replyErr) { console.debug('Could not send clear confirmation:', replyErr?.message || replyErr); }
			return;
		}
		catch (err) {
			console.error('Error clearing all messages:', err);
			try { await message.channel.send('Failed to clear messages. Check my permissions and try again.'); }
			catch { /* ignore */ }
			return;
		}
	}

	const num = parseInt(countArg, 10);
	if (Number.isNaN(num) || num <= 0) return message.channel.send('Please provide a valid number greater than 0, or use `all`.');

	let remaining = num;
	let totalDeleted = 0;
	try {
		while (remaining > 0) {
			const fetchLimit = Math.min(100, remaining);
			const fetched = await targetChannel.messages.fetch({ limit: fetchLimit });
			if (!fetched || fetched.size === 0) break;

			const toDelete = fetched.filter(m => m.id !== excludeCommandId);
			if (toDelete.size === 0) break;

			await targetChannel.bulkDelete(toDelete, true);
			totalDeleted += toDelete.size;
			remaining -= toDelete.size;

			if (fetched.size < fetchLimit) break;
			await new Promise(res => setTimeout(res, 250));
		}

		try { await message.channel.send(`Deleted approximately ${totalDeleted} message(s) from <#${targetChannel.id}>.`); }
		catch (replyErr) { console.debug('Could not send deletion confirmation:', replyErr?.message || replyErr); }
		return;
	}
	catch (err) {
		console.error('Error deleting messages:', err);
		try { await message.channel.send('Failed to delete messages. Check my permissions and try again.'); }
		catch { /* ignore */ }
		return;
	}
}

module.exports = {
	handleSet,
	handleMsg,
	handleMsgRole,
	handleClr,
};