const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
} = require('discord.js');
const {
  addToBasket,
  clearBasket,
  getBasket,
  getBasketTotal,
  removeFromBasket,
} = require('../../utils/shopDatabase');
const { createPurchaseTicket } = require('../../utils/purchaseTicket');

const PAYPAL_EMOJI = '<:PayPal:1502028520694485074>';
const ROBUX_EMOJI = '<:Robux:1502032310969831424>';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('basket')
    .setDescription('Manage your reserved shop codes.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Reserve one specific stored code and add it to your basket.')
        .addStringOption((option) =>
          option
            .setName('code')
            .setDescription('The exact code you want to reserve')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('view')
        .setDescription('View the codes currently in your basket.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remove one reserved code from your basket.')
        .addStringOption((option) =>
          option
            .setName('code')
            .setDescription('The exact code to remove from your basket')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('clear')
        .setDescription('Remove every reserved code from your basket.')
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'add') {
      const code = interaction.options.getString('code');
      const item = await addToBasket(userId, code);

      if (item === 'duplicate') {
        return interaction.reply({ content: 'That code is already in your basket.', ephemeral: true });
      }

      if (item === false) {
        return interaction.reply({
          content: "That one-time code is already reserved in someone else's basket.",
          ephemeral: true,
        });
      }

      if (!item) {
        return interaction.reply({ content: 'That stored code was not found.', ephemeral: true });
      }

      return interaction.reply({
        content:
          `Added **${item.product_name || item.productName}** to your basket.\n` +
          `Price: ${PAYPAL_EMOJI} ${Number(item.price || 0).toFixed(2)}\n` +
          `Code: \`${item.code}\``,
        ephemeral: true,
      });
    }

    if (subcommand === 'view') {
      const basket = await getBasket(userId);

      if (basket.length === 0) {
        return interaction.reply({ content: 'Your basket is empty.', ephemeral: true });
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
        const robuxLine = robuxTotal > 0 ? ` | ${ROBUX_EMOJI} ${robuxTotal}` : '';

        return `**${name}** x${data.quantity} | ${PAYPAL_EMOJI} ${gbpTotal.toFixed(2)}${robuxLine}`;
      });

      const total = await getBasketTotal(userId);

      return interaction.reply({
        content:
          `**Your Basket**\n\n` +
          lines.join('\n') +
          `\n\n**Total ${PAYPAL_EMOJI} ${Number(total.gbp || 0).toFixed(2)}**` +
          `\n**Total ${ROBUX_EMOJI} ${Number(total.robux || 0)}**`,
        components: [buildCartButtons()],
        ephemeral: true,
      });
    }

    if (subcommand === 'remove') {
      const code = interaction.options.getString('code');
      const item = await removeFromBasket(userId, code);

      if (!item) {
        return interaction.reply({ content: 'That code was not found in your basket.', ephemeral: true });
      }

      return interaction.reply({
        content: `Removed **${item.product_name || item.productName}** from your basket.`,
        ephemeral: true,
      });
    }

    if (subcommand === 'clear') {
      const removedCount = await clearBasket(userId);

      return interaction.reply({
        content: `Cleared ${removedCount} item(s) from your basket.`,
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: 'That basket action is not supported.',
      ephemeral: true,
    });
  },

  async handleButton(interaction) {
    const [, action] = interaction.customId.split(':');

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

    if (action === 'clear') {
      const removedCount = await clearBasket(interaction.user.id);

      await interaction.update({
        content:
          removedCount > 0
            ? `Cleared ${removedCount} item(s) from your basket.`
            : 'Your basket was already empty.',
        components: [],
      });
    }
  },
};

function buildCartButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('basket:checkout')
      .setLabel('Checkout')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('basket:clear')
      .setLabel('Clear Cart')
      .setStyle(ButtonStyle.Danger)
  );
}
