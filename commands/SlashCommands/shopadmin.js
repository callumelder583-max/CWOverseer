const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const {
  addCode,
  deleteCode,
  getCodes,
  getProductSummary,
  getStockSummary,
} = require('../../utils/shopDatabase');

const PAYPAL_EMOJI = '<:PayPal:1502028520694485074>';
const ROBUX_EMOJI = '<:Robux:1502032310969831424>';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shopadmin')
    .setDescription('Manage shop stock codes.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('addcode')
        .setDescription('Add a stock code to the shop database.')
        .addStringOption((option) =>
          option
            .setName('product')
            .setDescription('The product name for this code')
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName('code')
            .setDescription('The stock code to store')
            .setRequired(true)
        )
        .addAttachmentOption((option) =>
          option
            .setName('image')
            .setDescription('Optional image for this code')
            .setRequired(false)
        )
        .addNumberOption((option) =>
          option
            .setName('price')
            .setDescription('Optional GBP price for this code')
            .setRequired(false)
        )
        .addIntegerOption((option) =>
          option
            .setName('robux_price')
            .setDescription('Optional Robux price for this code')
            .setRequired(false)
        )
        .addBooleanOption((option) =>
          option
            .setName('one_time')
            .setDescription('Whether this code should be consumed after purchase')
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('stock')
        .setDescription('View stock for one product or all products.')
        .addStringOption((option) =>
          option
            .setName('product')
            .setDescription('Optional product name')
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('viewcodes')
        .setDescription('View the actual stored codes for admins only.')
        .addStringOption((option) =>
          option
            .setName('product')
            .setDescription('Optional product name to filter by')
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('deletecode')
        .setDescription('Delete one stored code by its item id.')
        .addStringOption((option) =>
          option
            .setName('item_id')
            .setDescription('The item id shown in viewcodes')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'addcode') {
      const productName = interaction.options.getString('product');
      const code = interaction.options.getString('code');
      const image = interaction.options.getAttachment('image');
      const price = interaction.options.getNumber('price') || 0;
      const robuxPrice = interaction.options.getInteger('robux_price');
      const oneTime = interaction.options.getBoolean('one_time') || false;

      const item = await addCode(
        productName,
        code,
        interaction.user.id,
        oneTime,
        image?.url || null,
        price,
        robuxPrice
      );

      await interaction.reply({
        content:
          `Stored a new ${item.oneTime ? 'one-time' : 'reusable'} code for **${item.productName}** ` +
          `with item id \`${item.id}\`.` +
          `\nPrice: ${PAYPAL_EMOJI} ${Number(item.price || 0).toFixed(2)}` +
          (item.robuxPrice ? `\n${ROBUX_EMOJI} ${item.robuxPrice}` : '') +
          `\nItem Image: ${item.imageUrl || 'None'}`,
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'stock') {
      const productName = interaction.options.getString('product');

      if (productName) {
        const summary = await getProductSummary(productName);

        await interaction.reply({
          content:
            `**${summary.productName}** stock\n` +
            `Total codes: ${summary.total}\n` +
            `Available: ${summary.available}\n` +
            `Reserved in baskets: ${summary.reserved}\n` +
            `Reusable codes: ${summary.reusable}\n` +
            `One-time codes: ${summary.oneTime}`,
          ephemeral: true,
        });
        return;
      }

      const stock = await getStockSummary();

      if (stock.length === 0) {
        await interaction.reply({
          content: 'The shop database is empty right now.',
          ephemeral: true,
        });
        return;
      }

      const lines = stock.map(
        (entry) =>
          `**${entry.productName}**: ${entry.available} available, ${entry.reserved} reserved, ` +
          `${entry.reusable} reusable, ${entry.oneTime} one-time`
      );

      await interaction.reply({
        content: lines.join('\n'),
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'viewcodes') {
      const productName = interaction.options.getString('product');
      const codes = await getCodes(productName);

      if (codes.length === 0) {
        await interaction.reply({
          content: productName
            ? `No stored codes were found for **${productName}**.`
            : 'No stored codes were found.',
          ephemeral: true,
        });
        return;
      }

      const lines = codes.map((item) => {
        const name = item.product_name || item.productName;
        const imageUrl = item.image_url || item.imageUrl || 'None';

        return (
          `**${name}** | \`${item.id}\` | \`${item.code}\` | ${item.status} | ` +
          `${item.one_time ? 'one-time' : 'reusable'} | baskets: ${item.basketReservations} | ` +
          `image: ${imageUrl}`
        );
      });

      const chunks = [];
      let currentChunk = '';

      for (const line of lines) {
        const candidate = currentChunk ? `${currentChunk}\n${line}` : line;

        if (candidate.length > 1900) {
          chunks.push(currentChunk);
          currentChunk = line;
          continue;
        }

        currentChunk = candidate;
      }

      if (currentChunk) {
        chunks.push(currentChunk);
      }

      await interaction.reply({
        content: chunks[0],
        ephemeral: true,
      });

      for (let index = 1; index < chunks.length; index += 1) {
        await interaction.followUp({
          content: chunks[index],
          ephemeral: true,
        });
      }

      return;
    }

    if (subcommand === 'deletecode') {
      const itemId = interaction.options.getString('item_id');
      const removedItem = await deleteCode(itemId);

      if (!removedItem) {
        await interaction.reply({
          content: `No stored code was found with item id \`${itemId}\`.`,
          ephemeral: true,
        });
        return;
      }

      const productName = removedItem.product_name || removedItem.productName;

      await interaction.reply({
        content:
          `Deleted stored code \`${removedItem.id}\` for **${productName}**.` +
          `\nRemoved code: \`${removedItem.code}\``,
        ephemeral: true,
      });
    }
  },
};
