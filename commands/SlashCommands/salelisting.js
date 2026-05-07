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

const {
  addProductToBasket,
  clearBasket,
  getBasket,
  getBasketTotal,
  getProductListingData,
  removeProductFromBasket,
} = require('../../utils/shopDatabase');
const { createPurchaseTicket } = require('../../utils/purchaseTicket');

const SESSION_TTL_MS = 15 * 60 * 1000;
const PAYPAL_EMOJI = '<:PayPal:1502028520694485074>';
const ROBUX_EMOJI = '<:Robux:1502032310969831424>';

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
      .setPlaceholder(trimForPlaceholder(`${listingData.productName} For Sale`))
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
      .setPlaceholder(
        trimForPlaceholder(listingData.imageUrl || '1234567890 or https://...')
      )
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
          value: 'Unlimited',
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
      productName: draft.listingData.productName,
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
    const [, action, payload] = interaction.customId.split(':');

    if (action === 'add') {
      const productName = decodeProductName(payload);
      const item = await addProductToBasket(interaction.user.id, productName);

      if (!item) {
        await interaction.reply({
          content: `No available stock was found for **${productName}**.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content:
          `Added **${item.product_name || item.productName}** to your basket.\n` +
          `${PAYPAL_EMOJI} ${Number(item.price || 0).toFixed(2)}\n` +
          `${ROBUX_EMOJI} ${Number(item.robux_price || 0)}`,
        ephemeral: true,
      });
      return;
    }

    if (action === 'viewcart') {
      const basket = await getBasket(interaction.user.id);
      const total = await getBasketTotal(interaction.user.id);

      await interaction.reply({
        content: formatBasketView(basket, total),
        components: basket.length > 0 ? [buildCartButtons()] : [],
        ephemeral: true,
      });
      return;
    }

    if (action === 'remove') {
      const productName = decodeProductName(payload);
      const item = await removeProductFromBasket(interaction.user.id, productName);

      if (!item) {
        await interaction.reply({
          content: `You do not have **${productName}** in your basket.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: `Removed one **${item.product_name || item.productName}** from your basket.`,
        ephemeral: true,
      });
      return;
    }

    if (action === 'checkout') {
      await interaction.deferReply({ ephemeral: true });
      const result = await createPurchaseTicket(interaction);

      if (!result.ok) {
        await interaction.editReply({
          content: result.message,
        });
        return;
      }

      await interaction.editReply({
        content: `Purchase ticket created successfully: ${result.ticketChannel}`,
      });
      return;
    }

    if (action === 'clearcart') {
      const removedCount = await clearBasket(interaction.user.id);

      await interaction.update({
        content:
          removedCount > 0
            ? `Cleared ${removedCount} item(s) from your basket.`
            : 'Your basket was already empty.',
        components: [],
      });
      return;
    }

    const sessionId = payload;
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
          components: [buildListingButtons(session.productName)],
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

function trimForPlaceholder(value) {
  return value.length > 100 ? `${value.slice(0, 97)}...` : value;
}

function buildListingButtons(productName) {
  const encodedProductName = encodeProductName(productName);

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`salelisting:add:${encodedProductName}`)
      .setLabel('\u{1F4B2} Add Product To Cart')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`salelisting:remove:${encodedProductName}`)
      .setLabel('\u274C Remove Item From Cart')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('salelisting:viewcart')
      .setLabel('\u{1F440} View Your Cart')
      .setStyle(ButtonStyle.Primary)
  );
}

function buildCartButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('salelisting:checkout')
      .setLabel('Checkout')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('salelisting:clearcart')
      .setLabel('Clear Cart')
      .setStyle(ButtonStyle.Danger)
  );
}

function encodeProductName(value) {
  return encodeURIComponent(value);
}

function decodeProductName(value) {
  return decodeURIComponent(value);
}

function formatPriceOptions(listingData) {
  const lines = [];

  if (listingData.prices.length > 0) {
    lines.push(
      `${PAYPAL_EMOJI} ${listingData.prices
        .map((price) => price.toFixed(2))
        .join(', ')}`
    );
  }

  if (listingData.robuxPrices.length > 0) {
    lines.push(`${ROBUX_EMOJI} ${listingData.robuxPrices.join(', ')}`);
  }

  return lines.join('\n') || 'No prices have been set yet.';
}

function formatBasketView(basket, total) {
  if (!basket || basket.length === 0) {
    return 'Your basket is empty.';
  }

  const grouped = {};

  for (const item of basket) {
    const name = item.product_name || item.productName;

    if (!grouped[name]) {
      grouped[name] = {
        quantity: 0,
        price: Number(item.price || 0),
        robuxPrice: Number(item.robux_price || 0),
      };
    }

    grouped[name].quantity += 1;
  }

  const lines = Object.entries(grouped).map(([name, data]) => {
    const gbpTotal = data.price * data.quantity;
    const robuxTotal = data.robuxPrice * data.quantity;

    return (
      `**${name}** x${data.quantity} | ` +
      `${PAYPAL_EMOJI} ${gbpTotal.toFixed(2)} | ` +
      `${ROBUX_EMOJI} ${robuxTotal}`
    );
  });

  return (
    `Your current cart:\n\n` +
    `${lines.join('\n')}\n\n` +
    `Total ${PAYPAL_EMOJI} ${Number(total.gbp || 0).toFixed(2)}\n` +
    `Total ${ROBUX_EMOJI} ${Number(total.robux || 0)}`
  );
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
