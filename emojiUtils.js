// emojiUtils.js
function normalizeEmojiInput(raw) {
	const customMatch = raw.match(/^(?:<a?:)?([a-zA-Z0-9_]+):(\d+)>?$/);
	if (customMatch) return `${customMatch[1]}:${customMatch[2]}`;
	return raw;
}

function reactionMatches(emojiId, reaction) {
	if (!reaction) return false;
	if (reaction.emoji.id) return `${reaction.emoji.name}:${reaction.emoji.id}` === emojiId;
	return reaction.emoji.name === emojiId;
}

module.exports = { normalizeEmojiInput, reactionMatches };

