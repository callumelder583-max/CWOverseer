const { SlashCommandBuilder } = require('discord.js');
const {
  addToBasket,
  clearBasket,
  getBasket,
  getBasketTotal,
  removeFromBasket,
} = require('../../utils/shopDatabase');

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

    // Adds Code to Basket
    if (subcommand === 'add') {
      const code = interaction.options.getString('code');
      const item = await addToBasket(userId, code);

      if (item === 'duplicate') {
        return interaction.reply({ content: 'That code is already in your basket.', ephemeral: true });
      }

      if (item === false) {
        return interaction.reply({ content: 'That one-time code is already reserved in someone else\'s basket.', ephemeral: true });
      }

      if (!item) {
        return interaction.reply({ content: 'That stored code was not found.', ephemeral: true });
      }

      return interaction.reply({
        content:
          `Added **${item.product_name || item.productName}** to your basket.\n` +
          `💰 Price: £${Number(item.price || 0).toFixed(2)}\n` +
          `Code: \`${item.code}\``,
        ephemeral: true,
      });
    }

    // Views Basket
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
            price: item.price || 0,
          };
        }

        grouped[name].quantity += 1;
      }

      const lines = Object.entries(grouped).map(([name, data]) => {
        const total = Number(data.price || 0) * data.quantity;
        return `**${name}** x${data.quantity} - £${total.toFixed(2)}`;
      });

      const total = await getBasketTotal(userId);

      return interaction.reply({
        content:
          `🛒 **Your Basket**\n\n` +
          lines.join('\n') +
          `\n\n💰 **Total: £${Number(total.gbp || 0).toFixed(2)}**` +
          (total.robux ? `\n🟩 **Robux: ${total.robux}**` : ''),
        ephemeral: true,
      });
    }

    // Removes code from basket
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

    // Clears basket
    if (subcommand === 'clear') {
      const removedCount = await clearBasket(userId);

      return interaction.reply({
        content: `Cleared ${removedCount} item(s) from your basket.`,
        ephemeral: true,
      });
    }
  },
};
