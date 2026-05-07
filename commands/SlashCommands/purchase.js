const {
  ActionRowBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const {
  ORDER_STATUSES,
  STAFF_ROLE_ID,
  FINISHED_ORDER_LOG_CHANNEL_ID,
  applyStatusEmojiToChannelName,
  createPurchaseTicket,
  extractOrderMetadataFromTopic,
  fetchOrderOpeningMessage,
  updateOpeningOrderEmbedStatus,
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
      if (!memberCanUseStaffControls(interaction)) {
        return interaction.reply({
          content: 'Only staff can update order statuses.',
          ephemeral: true,
        });
      }

      await interaction.reply({
        content: 'Choose the new order status:',
        components: [buildStatusSelectMenu()],
        ephemeral: true,
      });
      return;
    }

    if (!memberCanUseStaffControls(interaction)) {
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

  async handleSelectMenu(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'This menu can only be used inside a server ticket.',
        ephemeral: true,
      });
      return;
    }

    if (!memberCanUseStaffControls(interaction)) {
      await interaction.reply({
        content: 'Only staff can update order statuses.',
        ephemeral: true,
      });
      return;
    }

    const [, action] = interaction.customId.split(':');

    if (action !== 'statusselect') {
      return;
    }

    const statusKey = interaction.values[0];
    const status = ORDER_STATUSES[statusKey];

    if (!status) {
      await interaction.reply({
        content: 'That status option is not valid.',
        ephemeral: true,
      });
      return;
    }

    const channel = interaction.channel;
    const metadataBefore = extractOrderMetadataFromTopic(channel.topic);

    await channel.edit({
      name: applyStatusEmojiToChannelName(channel.name, status.emoji),
      topic: updateTicketTopicStatus(channel.topic, status.label),
    });

    const openingMessage = await fetchOrderOpeningMessage(channel);

    if (openingMessage) {
      await updateOpeningOrderEmbedStatus(openingMessage, status);
    }

    if (statusKey === 'finished' && metadataBefore.status !== ORDER_STATUSES.finished.label) {
      await sendFinishedOrderLog(interaction, openingMessage);
    }

    await interaction.update({
      content: `Order status updated to ${status.emoji} ${status.label}.`,
      components: [],
    });
  },
};

function memberCanUseStaffControls(interaction) {
  return (
    interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels) ||
    interaction.member.roles.cache.has(STAFF_ROLE_ID)
  );
}

function buildStatusSelectMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('purchase:statusselect')
      .setPlaceholder('Select a new order status')
      .addOptions(
        {
          label: 'Finished',
          value: 'finished',
          description: 'Mark the order as complete',
          emoji: ORDER_STATUSES.finished.emoji,
        },
        {
          label: 'Paid',
          value: 'paid',
          description: 'Payment has been received',
          emoji: ORDER_STATUSES.paid.emoji,
        },
        {
          label: 'Awaiting Payment',
          value: 'awaiting_payment',
          description: 'Waiting for the customer to pay',
          emoji: ORDER_STATUSES.awaiting_payment.emoji,
        },
        {
          label: 'Awaiting Staff',
          value: 'awaiting_staff',
          description: 'Waiting for a staff member to continue',
          emoji: ORDER_STATUSES.awaiting_staff.emoji,
        }
      )
  );
}

async function sendFinishedOrderLog(interaction, openingMessage) {
  const logChannel = await interaction.client.channels
    .fetch(FINISHED_ORDER_LOG_CHANNEL_ID)
    .catch(() => null);

  if (!logChannel || !logChannel.isTextBased()) {
    return;
  }

  const metadata = extractOrderMetadataFromTopic(interaction.channel.topic);
  const resolvedOpeningMessage =
    openingMessage || (await fetchOrderOpeningMessage(interaction.channel));
  const orderSummaryField = resolvedOpeningMessage?.embeds?.[0]?.fields?.find(
    (field) => field.name === 'Order Summary'
  );
  const totalsField = resolvedOpeningMessage?.embeds?.[0]?.fields?.find(
    (field) => field.name === 'Totals'
  );

  await logChannel.send({
    embeds: [
      {
        color: 0x2b8cff,
        title: 'Purchase Order Finished',
        fields: [
          {
            name: 'User ID',
            value: metadata.userId || interaction.user.id,
            inline: true,
          },
          {
            name: 'Order ID',
            value: metadata.orderId || 'Unknown',
            inline: true,
          },
          {
            name: 'Products Purchased',
            value: orderSummaryField?.value || 'Unknown',
          },
          {
            name: 'Total Amount',
            value: totalsField?.value || 'Unknown',
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  });
}
