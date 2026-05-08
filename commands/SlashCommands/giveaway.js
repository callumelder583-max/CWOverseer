const crypto = require('crypto');
const {
  ActionRowBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const {
  buildGiveawayComponents,
  buildGiveawayEmbed,
  endGiveaway,
  getGiveaway,
  refreshGiveawayMessage,
  rerollGiveaway,
  scheduleGiveaway,
  upsertGiveaway,
} = require('../../utils/giveaways');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Create and manage giveaways.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('create')
        .setDescription('Open a modal to create a giveaway.')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand !== 'create') {
      await interaction.reply({
        content: 'That giveaway action is not supported.',
        ephemeral: true,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId('giveaway:create')
      .setTitle('Create Giveaway');

    const prizeInput = new TextInputBuilder()
      .setCustomId('prize')
      .setLabel('Prize')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(256)
      .setRequired(true);

    const winnersInput = new TextInputBuilder()
      .setCustomId('winners')
      .setLabel('Winners')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(20)
      .setRequired(true)
      .setPlaceholder('1');

    const durationInput = new TextInputBuilder()
      .setCustomId('duration')
      .setLabel('Duration')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(100)
      .setRequired(true)
      .setPlaceholder('10m, 2h, 3d, or 24 hours');

    const hostInput = new TextInputBuilder()
      .setCustomId('host')
      .setLabel('Host')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(100)
      .setRequired(true)
      .setPlaceholder('@username or display name');

    const linkInput = new TextInputBuilder()
      .setCustomId('linkUrl')
      .setLabel('Link URL (Optional)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('https://example.com');

    modal.addComponents(
      new ActionRowBuilder().addComponents(prizeInput),
      new ActionRowBuilder().addComponents(winnersInput),
      new ActionRowBuilder().addComponents(durationInput),
      new ActionRowBuilder().addComponents(hostInput),
      new ActionRowBuilder().addComponents(linkInput)
    );

    await interaction.showModal(modal);
  },

  async handleModalSubmit(interaction) {
    const prize = interaction.fields.getTextInputValue('prize').trim();
    const winnersRaw = interaction.fields.getTextInputValue('winners').trim();
    const durationRaw = interaction.fields.getTextInputValue('duration').trim();
    const host = interaction.fields.getTextInputValue('host').trim();
    const linkUrl = interaction.fields.getTextInputValue('linkUrl').trim();

    const winnerCount = Number.parseInt(winnersRaw, 10);

    if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 50) {
      await interaction.reply({
        content: 'Winners must be a whole number between 1 and 50.',
        ephemeral: true,
      });
      return;
    }

    const durationMs = parseDuration(durationRaw);

    if (!durationMs || durationMs < 60_000) {
      await interaction.reply({
        content: 'Duration must be at least 1 minute, for example `10m`, `2h`, or `24 hours`.',
        ephemeral: true,
      });
      return;
    }

    if (linkUrl && !isValidUrl(linkUrl)) {
      await interaction.reply({
        content: 'The link URL must be a valid `http` or `https` URL.',
        ephemeral: true,
      });
      return;
    }

    const createdAt = Date.now();
    const giveawayId = crypto.randomBytes(8).toString('hex');
    const giveaway = {
      id: giveawayId,
      prize,
      winnerCount,
      durationText: durationRaw,
      host,
      linkUrl: linkUrl || null,
      entries: [],
      winnerIds: [],
      channelId: interaction.channelId,
      guildId: interaction.guildId,
      messageId: null,
      createdAt,
      endAt: createdAt + durationMs,
      createdByUserId: interaction.user.id,
      status: 'active',
    };

    const payload = {
      content: '**New Giveaway**',
      embeds: [buildGiveawayEmbed(giveaway)],
      components: buildGiveawayComponents(giveaway),
    };

    await interaction.reply(payload);

    const message = await interaction.fetchReply();
    giveaway.messageId = message.id;

    upsertGiveaway(giveaway);
    scheduleGiveaway(interaction.client, giveaway.id);
  },

  async handleButton(interaction) {
    const [, action, giveawayId] = interaction.customId.split(':');

    if (!giveawayId) {
      await interaction.reply({
        content: 'That giveaway action is invalid.',
        ephemeral: true,
      });
      return;
    }

    const giveaway = getGiveaway(giveawayId);

    if (!giveaway) {
      await interaction.reply({
        content: 'That giveaway could not be found.',
        ephemeral: true,
      });
      return;
    }

    if (action === 'join') {
      await handleJoin(interaction, giveaway);
      return;
    }

    if (action === 'leave') {
      await handleLeave(interaction, giveaway);
      return;
    }

    if (action === 'end') {
      await handleEnd(interaction, giveaway);
      return;
    }

    if (action === 'reroll') {
      await handleReroll(interaction, giveaway);
    }
  },
};

async function handleJoin(interaction, giveaway) {
  if (giveaway.status === 'ended') {
    await interaction.reply({
      content: 'This giveaway has already ended.',
      ephemeral: true,
    });
    return;
  }

  if (giveaway.entries.includes(interaction.user.id)) {
    await interaction.reply({
      content: 'You are already entered in this giveaway.',
      ephemeral: true,
    });
    return;
  }

  const updatedGiveaway = {
    ...giveaway,
    entries: [...giveaway.entries, interaction.user.id],
  };

  upsertGiveaway(updatedGiveaway);
  await refreshGiveawayMessage(interaction.client, updatedGiveaway);

  await interaction.reply({
    content: `You joined the giveaway for **${updatedGiveaway.prize}**.`,
    ephemeral: true,
  });
}

async function handleLeave(interaction, giveaway) {
  if (giveaway.status === 'ended') {
    await interaction.reply({
      content: 'This giveaway has already ended.',
      ephemeral: true,
    });
    return;
  }

  if (!giveaway.entries.includes(interaction.user.id)) {
    await interaction.reply({
      content: 'You are not currently entered in this giveaway.',
      ephemeral: true,
    });
    return;
  }

  const updatedGiveaway = {
    ...giveaway,
    entries: giveaway.entries.filter((entry) => entry !== interaction.user.id),
  };

  upsertGiveaway(updatedGiveaway);
  await refreshGiveawayMessage(interaction.client, updatedGiveaway);

  await interaction.reply({
    content: `You left the giveaway for **${updatedGiveaway.prize}**.`,
    ephemeral: true,
  });
}

async function handleEnd(interaction, giveaway) {
  if (!canManageGiveaway(interaction, giveaway)) {
    await interaction.reply({
      content: 'Only the giveaway creator or staff can end this giveaway early.',
      ephemeral: true,
    });
    return;
  }

  if (giveaway.status === 'ended') {
    await interaction.reply({
      content: 'This giveaway has already ended.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: 'Ending giveaway...',
    ephemeral: true,
  });

  await endGiveaway(interaction.client, giveaway.id);
}

async function handleReroll(interaction, giveaway) {
  if (!canManageGiveaway(interaction, giveaway)) {
    await interaction.reply({
      content: 'Only the giveaway creator or staff can reroll this giveaway.',
      ephemeral: true,
    });
    return;
  }

  if (giveaway.status !== 'ended') {
    await interaction.reply({
      content: 'You can reroll only after the giveaway has ended.',
      ephemeral: true,
    });
    return;
  }

  const updatedGiveaway = await rerollGiveaway(interaction.client, giveaway.id);

  await interaction.reply({
    content: updatedGiveaway
      ? `Rerolled **${updatedGiveaway.prize}** successfully.`
      : 'That giveaway could not be rerolled.',
    ephemeral: true,
  });
}

function canManageGiveaway(interaction, giveaway) {
  return (
    interaction.user.id === giveaway.createdByUserId ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)
  );
}

function isValidUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseDuration(value) {
  const normalized = value.trim().toLowerCase();

  const compactMatch = normalized.match(/^(\d+)\s*(s|m|h|d|w)$/);

  if (compactMatch) {
    return Number(compactMatch[1]) * unitToMs(compactMatch[2]);
  }

  const wordsMatch = normalized.match(/^(\d+)\s*(second|seconds|minute|minutes|hour|hours|day|days|week|weeks)$/);

  if (wordsMatch) {
    return Number(wordsMatch[1]) * unitToMs(wordsMatch[2]);
  }

  return null;
}

function unitToMs(unit) {
  switch (unit) {
    case 's':
    case 'second':
    case 'seconds':
      return 1000;
    case 'm':
    case 'minute':
    case 'minutes':
      return 60_000;
    case 'h':
    case 'hour':
    case 'hours':
      return 60 * 60_000;
    case 'd':
    case 'day':
    case 'days':
      return 24 * 60 * 60_000;
    case 'w':
    case 'week':
    case 'weeks':
      return 7 * 24 * 60 * 60_000;
    default:
      return 0;
  }
}
