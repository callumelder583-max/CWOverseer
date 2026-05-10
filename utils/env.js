const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, '');

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function getDiscordToken() {
  const rawToken = process.env.DISCORD_TOKEN;

  if (!rawToken) {
    return null;
  }

  const normalizedToken = rawToken
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/^Bot\s+/i, '');

  if (!normalizedToken) {
    return null;
  }

  if (/[\r\n\t]/.test(normalizedToken)) {
    throw new Error(
      'DISCORD_TOKEN contains whitespace or line breaks. Paste only the raw bot token value into your environment variable.'
    );
  }

  return normalizedToken;
}

module.exports = {
  getDiscordToken,
  loadEnv,
};
