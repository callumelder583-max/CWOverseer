const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const {
  completePurchase,
  getBasket,
  getBasketTotal,
} = require('./shopDatabase');

const DEFAULT_PURCHASE_CATEGORY_ID = '1499542332368879724';
const DEFAULT_STATUS_KEY = 'awaiting_staff';

const ORDER_STATUSES = {
  finished: {
    emoji: '✔',
    label: 'Finished',
  },
  paid: {
    emoji: '🟢',
    label: 'Paid',
  },
  awaiting_payment: {
    emoji: '🟡',
    label: 'Awaiting Payment',
  },
  awaiting_staff: {
    emoji: '🔴',
    label: 'Awaiting Staff',
  },
};

async function createPurchaseTicket(interaction) {
  const basket = await getBasket(interaction.user.id);

  if (!basket || basket.length === 0) {
    return {
      ok: false,
      message: 'Your basket is empty, so there is nothing to purchase.',
    };
  }

  const total = await getBasketTotal(interaction.user.id);
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

  const summaryLines = Object.entries(grouped).map(([name, data]) => {
    const itemTotal = data.price * data.quantity;
    const robuxTotal = data.robuxPrice * data.quantity;
    const robuxLine = robuxTotal > 0 ? ` | Robux ${robuxTotal}` : '';

    return `**${name}** x${data.quantity} - GBP ${itemTotal.toFixed(2)}${robuxLine}`;
  });

  const guild = interaction.guild;
  const safeName =
    interaction.user.username
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'customer';
  const orderId = generateOrderId();
  const status = ORDER_STATUSES[DEFAULT_STATUS_KEY];

  const ticketChannel = await guild.channels.create({
    name: buildPurchaseChannelName(safeName, status.emoji),
    type: ChannelType.GuildText,
    parent: process.env.PURCHASE_CATEGORY_ID || DEFAULT_PURCHASE_CATEGORY_ID,
    topic:
      `Purchase ticket for ${interaction.user.tag} (${interaction.user.id}) | ` +
      `Order ID: ${orderId} | ` +
      `Status: ${status.label}`,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: interaction.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ],
  });

  const purchasedItems = await completePurchase(interaction.user.id);
  const itemLines = purchasedItems.map((item) => {
    const name = item.product_name || item.productName;

    return [
      `**${name}**`,
      `Price: GBP ${Number(item.price || 0).toFixed(2)}`,
      item.robux_price ? `Robux: ${item.robux_price}` : null,
      `Code: \`${item.code}\``,
      `Image: ${item.image_url || item.imageUrl || 'None'}`,
    ]
      .filter(Boolean)
      .join('\n');
  });

  const orderEmbed = new EmbedBuilder()
    .setColor('#2B8CFF')
    .setTitle('Purchase Ticket Opened')
    .setDescription(`Your order has been created and the codes have been delivered in this ticket.`)
    .addFields(
      {
        name: 'Customer',
        value: `<@${interaction.user.id}>`,
        inline: true,
      },
      {
        name: 'Order ID',
        value: orderId,
        inline: true,
      },
      {
        name: 'Status',
        value: `${status.emoji} ${status.label}`,
        inline: true,
      },
      {
        name: 'Order Summary',
        value: summaryLines.join('\n'),
      },
      {
        name: 'Totals',
        value:
          `GBP ${Number(total.gbp || 0).toFixed(2)}\n` +
          `Robux ${Number(total.robux || 0)}`,
      }
    )
    .setFooter({ text: 'Use the buttons below to cancel or update this order.' })
    .setTimestamp();

  const orderControls = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('purchase:cancel')
      .setLabel('Cancel Order')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('purchase:status')
      .setLabel('Update Status')
      .setStyle(ButtonStyle.Secondary)
  );

  const staffControls = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`purchase:claim:${interaction.user.id}`)
      .setLabel('Claim Ticket')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`purchase:close:${interaction.user.id}`)
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Danger)
  );

  await ticketChannel.send({
    embeds: [orderEmbed],
    components: [orderControls],
  });

  await ticketChannel.send({
    content: 'Staff controls for this ticket:',
    components: [staffControls],
  });

  for (const chunk of chunkLines(itemLines, 1800)) {
    await ticketChannel.send(chunk);
  }

  return {
    ok: true,
    ticketChannel,
  };
}

function generateOrderId() {
  const numericId = Math.floor(10000000 + Math.random() * 90000000);
  return `CWO-${numericId}`;
}

function buildPurchaseChannelName(safeName, emoji) {
  return `${emoji}-purchase-${safeName}`.slice(0, 100);
}

function updateTicketTopicStatus(topic, nextStatusLabel) {
  if (!topic) {
    return `Status: ${nextStatusLabel}`;
  }

  if (topic.includes('Status: ')) {
    return topic.replace(/Status: [^|]+/u, `Status: ${nextStatusLabel}`);
  }

  return `${topic} | Status: ${nextStatusLabel}`;
}

function applyStatusEmojiToChannelName(channelName, emoji) {
  let nextName = channelName;
  let claimedPrefix = '';

  if (nextName.startsWith('claimed-')) {
    claimedPrefix = 'claimed-';
    nextName = nextName.slice('claimed-'.length);
  }

  nextName = nextName.replace(/^(✔|🟢|🟡|🔴)-/u, '');
  return `${claimedPrefix}${emoji}-${nextName}`.slice(0, 100);
}

function resolveStatusInput(input) {
  const normalized = input.trim().toLowerCase();

  const aliases = new Map([
    ['✔', 'finished'],
    ['finished', 'finished'],
    ['done', 'finished'],
    ['complete', 'finished'],
    ['completed', 'finished'],
    ['🟢', 'paid'],
    ['paid', 'paid'],
    ['payment received', 'paid'],
    ['🟡', 'awaiting_payment'],
    ['awaiting payment', 'awaiting_payment'],
    ['pending payment', 'awaiting_payment'],
    ['payment pending', 'awaiting_payment'],
    ['🔴', 'awaiting_staff'],
    ['awaiting staff', 'awaiting_staff'],
    ['waiting staff', 'awaiting_staff'],
    ['staff', 'awaiting_staff'],
  ]);

  return aliases.get(normalized) || null;
}

function chunkLines(lines, maxLength) {
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n\n${line}` : line;

    if (next.length > maxLength) {
      if (current) {
        chunks.push(current);
      }

      current = line;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

module.exports = {
  createPurchaseTicket,
  ORDER_STATUSES,
  applyStatusEmojiToChannelName,
  resolveStatusInput,
  updateTicketTopicStatus,
};
