const crypto = require('crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const { getProductListingData } = require('../../utils/shopDatabase');

const SESSION_TTL_MS = 15 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('salelisting')
    .setDescription('Build and post a sale listing embed for a shop product.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName('product')
        .setDescription('The product name to pull current price options from')
        .setRequired(true)
    ),

  async execute(interaction) {
    const productName = interaction.options.getString('product');
    const listingData = await getProductListingData(productName);

    if (!listingData) {
      await interaction.reply({
        content: `No shop product named **${productName}** was found.`,
        ephemeral: true,
      });
      return;
    }

    const draftId = crypto.randomBytes(8).toString('hex');
    const drafts = ensureStore(interaction.client, 'saleListingDrafts');

    drafts.set(draftId, {
      channelId: interaction.channelId,
      createdAt: Date.now(),
      listingData,
      userId: interaction.user.id,
    });

    const modal = new ModalBuilder()
      .setCustomId(`salelisting:modal:${draftId}`)
      .setTitle(`Sale Listing: ${trimForTitle(listingData.productName)}`);

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Title')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(256)
      .setPlaceholder(`${listingData.productName} For Sale`)
      .setRequired(false);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Description')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(4000)
      .setRequired(true);

    const footerInput = new TextInputBuilder()
      .setCustomId('footer')
      .setLabel('Footer message')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(2048)
      .setRequired(false);

    const imageInput = new TextInputBuilder()
      .setCustomId('image')
      .setLabel('Image ID or URL')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(listingData.imageUrl || '1234567890 or https://...')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(descriptionInput),
      new ActionRowBuilder().addComponents(footerInput),
      new ActionRowBuilder().addComponents(imageInput)
    );

    await interaction.showModal(modal);
  },

  async handleModalSubmit(interaction) {
    const [, , draftId] = interaction.customId.split(':');
    const drafts = ensureStore(interaction.client, 'saleListingDrafts');
    const draft = drafts.get(draftId);

    if (!draft || Date.now() - draft.createdAt > SESSION_TTL_MS) {
      drafts.delete(draftId);
      await interaction.reply({
        content: 'This sale listing draft expired. Run `/salelisting` again.',
        ephemeral: true,
      });
      return;
    }

    if (draft.userId !== interaction.user.id) {
      await interaction.reply({
        content: 'Only the creator can submit this sale listing.',
        ephemeral: true,
      });
      return;
    }

    const title =
      interaction.fields.getTextInputValue('title').trim() ||
      `${draft.listingData.productName} For Sale`;
    const description = interaction.fields
      .getTextInputValue('description')
      .trim();
    const footer = interaction.fields.getTextInputValue('footer').trim();
    const imageInput = interaction.fields.getTextInputValue('image').trim();

    const imageUrl = resolveImageInput(imageInput) || draft.listingData.imageUrl;

    if (imageInput && !imageUrl) {
      await interaction.reply({
        content:
          'The image field must be a full URL or a numeric Roblox image asset ID.',
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#2B8CFF')
      .setTitle(title)
      .setDescription(description)
      .addFields(
        {
          name: 'Product',
          value: draft.listingData.productName,
          inline: true,
        },
        {
          name: 'Stock',
          value: `${draft.listingData.available} available`,
          inline: true,
        },
        {
          name: 'Price Options',
          value: formatPriceOptions(draft.listingData),
        }
      );

    if (footer) {
      embed.setFooter({ text: footer });
    }

    if (imageUrl) {
      embed.setImage(imageUrl);
    }

    const sessionId = crypto.randomBytes(8).toString('hex');
    const sessions = ensureStore(interaction.client, 'saleListingSessions');

    sessions.set(sessionId, {
      channelId: draft.channelId,
      createdAt: Date.now(),
      embedData: embed.toJSON(),
      userId: interaction.user.id,
    });

    drafts.delete(draftId);

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`salelisting:send:${sessionId}`)
        .setLabel('Send Listing')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`salelisting:cancel:${sessionId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      content: 'Here is your sale listing preview. Send it when it looks right.',
      embeds: [embed],
      components: [buttons],
      ephemeral: true,
    });
  },

  async handleButton(interaction) {
    const [, action, sessionId] = interaction.customId.split(':');
    const sessions = ensureStore(interaction.client, 'saleListingSessions');
    const session = sessions.get(sessionId);

    if (!session || Date.now() - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(sessionId);
      await interaction.update({
        content: 'This sale listing session expired. Run `/salelisting` again.',
        embeds: [],
        components: [],
      });
      return;
    }

    if (session.userId !== interaction.user.id) {
      await interaction.reply({
        content: 'Only the creator can use these buttons.',
        ephemeral: true,
      });
      return;
    }

    if (action === 'cancel') {
      sessions.delete(sessionId);
      await interaction.update({
        content: 'Sale listing cancelled.',
        embeds: [],
        components: [],
      });
      return;
    }

    if (action === 'send') {
      try {
        const channel = await interaction.client.channels.fetch(session.channelId);

        if (!channel || !channel.isTextBased()) {
          throw new Error('Invalid channel');
        }

        await channel.send({
          embeds: [EmbedBuilder.from(session.embedData)],
        });

        sessions.delete(sessionId);

        await interaction.update({
          content: 'Sale listing sent successfully.',
          embeds: [],
          components: [],
        });
      } catch (error) {
        console.error(error);

        await interaction.update({
          content: 'Failed to send the sale listing.',
          embeds: [],
          components: [],
        });
      }
    }
  },
};

function ensureStore(client, key) {
  if (!client[key]) {
    client[key] = new Map();
  }

  return client[key];
}

function trimForTitle(value) {
  return value.length > 30 ? `${value.slice(0, 27)}...` : value;
}

function formatPriceOptions(listingData) {
  const lines = [];

  if (listingData.prices.length > 0) {
    lines.push(
      `GBP: ${listingData.prices
        .map((price) => `GBP ${price.toFixed(2)}`)
        .join(', ')}`
    );
  }

  if (listingData.robuxPrices.length > 0) {
    lines.push(`Robux: ${listingData.robuxPrices.join(', ')}`);
  }

  return lines.join('\n') || 'No prices have been set yet.';
}

function resolveImageInput(value) {
  if (!value) {
    return null;
  }

  if (isValidUrl(value)) {
    return value;
  }

  if (/^\d+$/.test(value)) {
    return `https://www.roblox.com/asset-thumbnail/image?assetId=${value}&width=420&height=420&format=png`;
  }

  return null;
}

function isValidUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
