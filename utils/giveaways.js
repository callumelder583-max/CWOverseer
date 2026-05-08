const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const GIVEAWAYS_FILE = path.join(__dirname, '..', 'data', 'giveaways.json');
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

function ensureGiveawayState(client) {
  if (!client.giveawayTimeouts) {
    client.giveawayTimeouts = new Map();
  }
}

function ensureGiveawaysFile() {
  const dataDir = path.dirname(GIVEAWAYS_FILE);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(GIVEAWAYS_FILE)) {
    fs.writeFileSync(GIVEAWAYS_FILE, '[]', 'utf8');
  }
}

function loadGiveaways() {
  ensureGiveawaysFile();

  try {
    const raw = fs.readFileSync(GIVEAWAYS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to load giveaways:', error);
    return [];
  }
}

function saveGiveaways(giveaways) {
  ensureGiveawaysFile();
  fs.writeFileSync(GIVEAWAYS_FILE, `${JSON.stringify(giveaways, null, 2)}\n`, 'utf8');
}

function getGiveaway(giveawayId) {
  return loadGiveaways().find((giveaway) => giveaway.id === giveawayId) || null;
}

function upsertGiveaway(updatedGiveaway) {
  const giveaways = loadGiveaways();
  const existingIndex = giveaways.findIndex((giveaway) => giveaway.id === updatedGiveaway.id);

  if (existingIndex === -1) {
    giveaways.push(updatedGiveaway);
  } else {
    giveaways[existingIndex] = updatedGiveaway;
  }

  saveGiveaways(giveaways);
  return updatedGiveaway;
}

function removeGiveaway(giveawayId) {
  const giveaways = loadGiveaways().filter((giveaway) => giveaway.id !== giveawayId);
  saveGiveaways(giveaways);
}

function buildGiveawayEmbed(giveaway) {
  const ended = giveaway.status === 'ended';
  const endedAt = giveaway.endedAt || giveaway.endAt;
  const embed = new EmbedBuilder()
    .setColor(ended ? '#E67E22' : '#F1C40F')
    .setTitle(ended ? 'Giveaway Ended' : 'Giveaway')
    .setDescription(`**Prize:** ${giveaway.prize}`)
    .addFields(
      { name: 'Winners', value: String(giveaway.winnerCount), inline: true },
      { name: 'Duration', value: giveaway.durationText, inline: true },
      { name: 'Host', value: giveaway.host, inline: true },
      {
        name: ended ? 'Ended' : 'Ends',
        value: `<t:${Math.floor((ended ? endedAt : giveaway.endAt) / 1000)}:${ended ? 'F' : 'R'}>`,
        inline: true,
      },
      { name: 'Entries', value: String(giveaway.entries.length), inline: true }
    )
    .setFooter({ text: `Giveaway ID: ${giveaway.id}` })
    .setTimestamp(new Date(giveaway.createdAt));

  if (ended) {
    embed.addFields({
      name: 'Winner Result',
      value: formatWinnerText(giveaway.winnerIds),
    });
  } else {
    embed.addFields({
      name: 'How To Enter',
      value: 'Press the **Join Giveaway** button below.',
    });
  }

  return embed;
}

function buildGiveawayComponents(giveaway) {
  if (giveaway.status === 'ended') {
    const components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`giveaway:reroll:${giveaway.id}`)
          .setLabel('Reroll')
          .setStyle(ButtonStyle.Primary)
      ),
    ];

    if (giveaway.linkUrl) {
      components.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('Open Link')
            .setStyle(ButtonStyle.Link)
            .setURL(giveaway.linkUrl)
        )
      );
    }

    return components;
  }

  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:join:${giveaway.id}`)
      .setLabel('Join Giveaway')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`giveaway:leave:${giveaway.id}`)
      .setLabel('Leave Giveaway')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`giveaway:end:${giveaway.id}`)
      .setLabel('End Early')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`giveaway:reroll:${giveaway.id}`)
      .setLabel('Reroll')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true)
  );

  if (!giveaway.linkUrl) {
    return [controlRow];
  }

  return [
    controlRow,
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Open Link')
        .setStyle(ButtonStyle.Link)
        .setURL(giveaway.linkUrl)
    ),
  ];
}

function scheduleGiveaway(client, giveawayId) {
  ensureGiveawayState(client);
  clearGiveawayTimer(client, giveawayId);

  const giveaway = getGiveaway(giveawayId);

  if (!giveaway || giveaway.status === 'ended') {
    return;
  }

  const delay = giveaway.endAt - Date.now();

  if (delay <= 0) {
    setImmediate(() => endGiveaway(client, giveawayId).catch((error) => {
      console.error(`Failed to auto-end giveaway ${giveawayId}:`, error);
    }));
    return;
  }

  const timeout = setTimeout(() => {
    if (delay > MAX_TIMEOUT_MS) {
      scheduleGiveaway(client, giveawayId);
      return;
    }

    endGiveaway(client, giveawayId).catch((error) => {
      console.error(`Failed to auto-end giveaway ${giveawayId}:`, error);
    });
  }, Math.min(delay, MAX_TIMEOUT_MS));

  client.giveawayTimeouts.set(giveawayId, timeout);
}

function clearGiveawayTimer(client, giveawayId) {
  ensureGiveawayState(client);
  const timeout = client.giveawayTimeouts.get(giveawayId);

  if (timeout) {
    clearTimeout(timeout);
    client.giveawayTimeouts.delete(giveawayId);
  }
}

async function restoreGiveaways(client) {
  ensureGiveawayState(client);
  const giveaways = loadGiveaways();

  for (const giveaway of giveaways) {
    if (giveaway.status !== 'ended') {
      scheduleGiveaway(client, giveaway.id);
    }
  }
}

async function refreshGiveawayMessage(client, giveaway) {
  const channel = await client.channels.fetch(giveaway.channelId);

  if (!channel || !channel.isTextBased()) {
    throw new Error(`Giveaway channel ${giveaway.channelId} was not found.`);
  }

  const message = await channel.messages.fetch(giveaway.messageId);

  await message.edit({
    content: giveaway.status === 'ended' ? '**Giveaway Closed**' : '**New Giveaway**',
    embeds: [buildGiveawayEmbed(giveaway)],
    components: buildGiveawayComponents(giveaway),
  });

  return message;
}

async function endGiveaway(client, giveawayId, options = {}) {
  const giveaway = getGiveaway(giveawayId);

  if (!giveaway || giveaway.status === 'ended') {
    return giveaway;
  }

  clearGiveawayTimer(client, giveawayId);

  const winnerIds = pickWinners(giveaway.entries, giveaway.winnerCount);
  const endedGiveaway = {
    ...giveaway,
    status: 'ended',
    endedAt: Date.now(),
    winnerIds,
  };

  upsertGiveaway(endedGiveaway);

  try {
    const message = await refreshGiveawayMessage(client, endedGiveaway);
    await message.reply({
      content:
        winnerIds.length > 0
          ? `Congratulations ${winnerIds.map((id) => `<@${id}>`).join(', ')}! You won **${endedGiveaway.prize}**.`
          : `No valid entries were received for **${endedGiveaway.prize}**.`,
    });
  } catch (error) {
    console.error(`Failed to update ended giveaway ${giveawayId}:`, error);
  }

  if (options.removeAfterEnd) {
    removeGiveaway(giveawayId);
  }

  return endedGiveaway;
}

async function rerollGiveaway(client, giveawayId) {
  const giveaway = getGiveaway(giveawayId);

  if (!giveaway || giveaway.status !== 'ended') {
    return null;
  }

  const winnerIds = pickWinners(giveaway.entries, giveaway.winnerCount);
  const updatedGiveaway = {
    ...giveaway,
    winnerIds,
    rerolledAt: Date.now(),
  };

  upsertGiveaway(updatedGiveaway);

  try {
    const message = await refreshGiveawayMessage(client, updatedGiveaway);
    await message.reply({
      content:
        winnerIds.length > 0
          ? `Rerolled winners: ${winnerIds.map((id) => `<@${id}>`).join(', ')}`
          : `Reroll complete, but there are still no valid entries for **${updatedGiveaway.prize}**.`,
    });
  } catch (error) {
    console.error(`Failed to reroll giveaway ${giveawayId}:`, error);
  }

  return updatedGiveaway;
}

function pickWinners(entries, winnerCount) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }

  const pool = [...entries];
  const winners = [];

  while (pool.length > 0 && winners.length < winnerCount) {
    const index = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(index, 1)[0]);
  }

  return winners;
}

function formatWinnerText(winnerIds) {
  if (!winnerIds || winnerIds.length === 0) {
    return 'No winners could be drawn because nobody entered.';
  }

  return winnerIds.map((id) => `<@${id}>`).join(', ');
}

module.exports = {
  buildGiveawayComponents,
  buildGiveawayEmbed,
  clearGiveawayTimer,
  endGiveaway,
  ensureGiveawayState,
  getGiveaway,
  loadGiveaways,
  refreshGiveawayMessage,
  restoreGiveaways,
  rerollGiveaway,
  scheduleGiveaway,
  upsertGiveaway,
};
