const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const {
  ORDER_STATUSES,
  applyStatusEmojiToChannelName,
  createPurchaseTicket,
  resolveStatusInput,
  updateTicketTopicStatus,
} = require('../../utils/purchaseTicket');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purchase')
    .setDescription('Create a purchase ticket with the codes in your basket.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const result = await createPurchaseTicket(interaction);

    if (!result.ok) {
      return interaction.editReply({
        content: result.message,
      });
    }

    await interaction.editReply({
      content: `Purchase ticket created successfully: ${result.ticketChannel}`,
    });
  },

  async handleButton(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: 'This button can only be used inside a server.',
        ephemeral: true,
      });
    }

    const [, action] = interaction.customId.split(':');
    const channel = interaction.channel;

    if (action === 'cancel') {
      await interaction.reply({
        content: 'Cancelling order and closing ticket...',
      });

      await channel.delete();
      return;
    }

    if (action === 'status') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: 'Only staff can update order statuses.',
          ephemeral: true,
        });
      }

      const modal = new ModalBuilder()
        .setCustomId('purchase:statusmodal')
        .setTitle('Update Order Status');

      const statusInput = new TextInputBuilder()
        .setCustomId('status')
        .setLabel('Status')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(40)
        .setPlaceholder('Finished, Paid, Awaiting Payment, or Awaiting Staff');

      modal.addComponents(new ActionRowBuilder().addComponents(statusInput));
      await interaction.showModal(modal);
      return;
    }

    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({
        content: 'Only staff can use ticket controls.',
        ephemeral: true,
      });
    }

    if (action === 'claim') {
      const alreadyClaimed = channel.topic?.includes('Claimed by:');

      if (alreadyClaimed) {
        return interaction.reply({
          content: `Already claimed.\n${channel.topic}`,
          ephemeral: true,
        });
      }

      await channel.edit({
        name: channel.name.startsWith('claimed-')
          ? channel.name
          : `claimed-${channel.name}`,
        topic: `${channel.topic} | Claimed by: ${interaction.user.tag}`,
      });

      return interaction.reply({
        content: `${interaction.user} claimed this ticket.`,
      });
    }

    if (action === 'close') {
      await interaction.reply({
        content: 'Closing ticket...',
      });

      await channel.delete();
    }
  },

  async handleModalSubmit(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'This modal can only be used inside a server ticket.',
        ephemeral: true,
      });
      return;
    }

    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply({
        content: 'Only staff can update order statuses.',
        ephemeral: true,
      });
      return;
    }

    const statusKey = resolveStatusInput(interaction.fields.getTextInputValue('status'));

    if (!statusKey) {
      await interaction.reply({
        content:
          'Invalid status. Use one of: `Finished`, `Paid`, `Awaiting Payment`, or `Awaiting Staff`.',
        ephemeral: true,
      });
      return;
    }

    const status = ORDER_STATUSES[statusKey];
    const channel = interaction.channel;

    await channel.edit({
      name: applyStatusEmojiToChannelName(channel.name, status.emoji),
      topic: updateTicketTopicStatus(channel.topic, status.label),
    });

    await interaction.reply({
      content: `Order status updated to ${status.emoji} ${status.label}.`,
    });
  },
};
