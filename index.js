// index.js
import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  Routes,
  SlashCommandBuilder,
  REST
} from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const DATA_FILE = path.resolve('./data.json');
const ADMIN_ROLE_ID = '1396593504603607153';
const SELLER_ROLE_ID = '1396594120499400807';
const PAYPAL_USERNAME = 'yourpaypal@here';
const TAX_GIF = 'https://media.tenor.com/AbCdEf12345.gif'; // replace with your gif
const TAX_RATE = 0.25;

/* ------------------ Helpers ------------------ */
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE));
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/* ------------------ Commands ------------------ */
const commands = [
  new SlashCommandBuilder()
    .setName('earn')
    .setDescription('Log a customer purchase')
    .addUserOption(opt => opt.setName('customer').setDescription('The customer').setRequired(true))
    .addIntegerOption(opt => opt.setName('amount').setDescription('Amount earned').setRequired(true)),

  new SlashCommandBuilder()
    .setName('checkpend')
    .setDescription('Check how much tax you owe'),

  new SlashCommandBuilder()
    .setName('checkspend')
    .setDescription('Check how much a customer has spent')
    .addUserOption(opt => opt.setName('customer').setDescription('The customer').setRequired(true)),

  new SlashCommandBuilder()
    .setName('tax')
    .setDescription('Send tax DMs (Admins only)')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

/* ------------------ Slash Register ------------------ */
(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error(err);
  }
})();

/* ------------------ Events ------------------ */
client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const data = loadData();

  /* /earn */
  if (interaction.commandName === 'earn') {
    if (!interaction.member.roles.cache.has(SELLER_ROLE_ID)) {
      return interaction.reply({ content: '❌ Only sellers can use this command.', ephemeral: true });
    }

    const customer = interaction.options.getUser('customer');
    const amount = interaction.options.getInteger('amount');
    const seller = interaction.user;

    if (!data.users[seller.id]) {
      data.users[seller.id] = { earned: 0, spent: 0, taxPending: 0 };
    }
    if (!data.users[customer.id]) {
      data.users[customer.id] = { earned: 0, spent: 0, taxPending: 0 };
    }

    data.users[seller.id].earned += amount;
    data.users[seller.id].taxPending += Math.floor(amount * TAX_RATE);
    data.users[customer.id].spent += amount;

    saveData(data);

    const embed = new EmbedBuilder()
      .setColor(0x00AE86)
      .setTitle('💰 Earnings Logged')
      .setDescription(
        `**Customer:** ${customer}\n` +
        `**Seller:** ${seller}\n` +
        `**Amount:** \`${amount}\`\n` +
        `**Tax Added:** \`${Math.floor(amount * TAX_RATE)}\`\n` +
        `**Customer Total Earned:** \`${data.users[seller.id].earned}\``
      )
      .setFooter({ text: 'Forgotten Traders - Payday Bot' });

    return interaction.reply({ embeds: [embed] });
  }

  /* /checkpend */
  if (interaction.commandName === 'checkpend') {
    const user = data.users[interaction.user.id];
    const taxOwed = user?.taxPending || 0;
    return interaction.reply({ content: `📊 You currently owe **${taxOwed}** in taxes.` });
  }

  /* /checkspend */
  if (interaction.commandName === 'checkspend') {
    const customer = interaction.options.getUser('customer');
    const user = data.users[customer.id];
    const spent = user?.spent || 0;
    return interaction.reply({ content: `🛒 ${customer} has spent **${spent}**.` });
  }

  /* /tax */
  if (interaction.commandName === 'tax') {
    if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
      return interaction.reply({ content: '❌ Only admins can run this command.', ephemeral: true });
    }

    for (const [userId, record] of Object.entries(data.users)) {
      if (record.taxPending > 0) {
        try {
          const user = await client.users.fetch(userId);
          await user.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('⚠ Tax Payment Due')
                .setDescription(
                  `You owe **${record.taxPending}** in taxes.\n\n` +
                  `Pay via PayPal: \`${PAYPAL_USERNAME}\`\n` +
                  `Send proof to an Admin to get your Seller role back.`
                )
                .setImage(TAX_GIF)
                .setFooter({ text: 'Forgotten Traders - Payday Bot' })
            ]
          });
        } catch (e) {
          console.error(`Could not DM ${userId}:`, e);
        }
      }
    }

    return interaction.reply({ content: '✅ Tax reminders sent to sellers.' });
  }
});

client.login(process.env.BOT_TOKEN);
