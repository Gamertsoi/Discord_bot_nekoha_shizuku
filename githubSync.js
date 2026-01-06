// githubSync.js
const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
const btoa = (str) => Buffer.from(str).toString('base64');

async function pushFileToGitHub({ owner, repo, path, branch = 'main', contentObj, token, commitMessage }) {
	const apiBase = 'https://api.github.com';
	const filePath = encodeURIComponent(path);
	const headers = { Authorization: `token ${token}`, 'User-Agent': 'repo-sync-bot' };

	// Try to get existing file to obtain SHA
	const getUrl = `${apiBase}/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
	let sha = null;
	const getRes = await fetch(getUrl, { headers });
	if (getRes.status === 200) {
		const data = await getRes.json();
		sha = data.sha;
	}
	else if (getRes.status !== 404) {
		const txt = await getRes.text();
		throw new Error(`Failed to read file from GitHub: ${getRes.status} ${txt}`);
	}

	const contentStr = JSON.stringify(contentObj, null, 2);
	const body = {
		message: commitMessage || `Auto-update ${path} by bot`,
		content: btoa(contentStr),
		branch,
	};
	if (sha) body.sha = sha;

	const putUrl = `${apiBase}/repos/${owner}/${repo}/contents/${filePath}`;
	const putRes = await fetch(putUrl, {
		method: 'PUT',
		headers: { ...headers, 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

	if (!putRes.ok) {
		const errText = await putRes.text();
		throw new Error(`GitHub update failed: ${putRes.status} ${errText}`);
	}

	return await putRes.json();
}

module.exports = { pushFileToGitHub };

