const { REST, Routes } = require('discord.js');
const { getCommands } = require('./handlers/loadCommands');
const { getDiscordToken, loadEnv } = require('./utils/env');

loadEnv();

let token;

try {
  token = getDiscordToken();
} catch (error) {
  console.error(`Invalid DISCORD_TOKEN: ${error.message}`);
  process.exit(1);
}

const clientId = process.env.CLIENT_ID || process.env.APPLICATION_ID;
const guildId = process.env.GUILD_ID || process.env.DEV_GUILD_ID;

if (!token) {
  console.error('Missing DISCORD_TOKEN in .env.');
  process.exit(1);
}

if (!guildId) {
  console.error(
    'Missing GUILD_ID or DEV_GUILD_ID in .env. Guild deployment is the fastest way to update slash commands immediately.'
  );
  process.exit(1);
}

const commands = getCommands().map((command) => command.data.toJSON());
const rest = new REST({ version: '10' }).setToken(token);

async function deployCommands() {
  try {
    const applicationId = clientId || (await getApplicationId());

    console.log(`Deploying ${commands.length} slash command(s) to guild ${guildId}...`);

    await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
      body: commands,
    });

    console.log('Slash commands updated successfully.');
  } catch (error) {
    console.error('Failed to deploy slash commands:', error);
    process.exit(1);
  }
}

deployCommands();

async function getApplicationId() {
  const application = await rest.get(Routes.oauth2CurrentApplication());
  return application.id;
}
