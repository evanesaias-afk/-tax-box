// index.js — Tax + Earnings Bot
import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  Routes,
  REST,
  EmbedBuilder,
  PermissionsBitField
} from 'discord.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel]
});

/* =========================== CONFIG =========================== */
const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const DATA_PATH = path.resolve('./economy.json');
const SELLER_ROLE_ID = '1396594120499400807'; // seller role
const ADMIN_ROLE_ID = '1396593504603607153';  // admin role
const PAYPAL_USERNAME = 'Videogameenjoyer';
const TAX_RATE = 0.25;
const TAX_GIF = 'https://i.imgur.com/yourgif.gif'; // replace with your real GIF URL

/* =========================== STORAGE =========================== */
function ensureData() {
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify({ users: {} }, null, 2));
  }
}
function loadData() {
  ensureData();
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}
function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

/* =========================== COMMANDS =========================== */
const commands = [
  new SlashCommandBuilder()
    .setName('earn')
    .setDescription('Log an earning as a seller')
    .addUserOption(opt => opt.setName('customer').setDescription('Customer who paid').setRequired(true))
    .addIntegerOption(opt => opt.setName('amount').setDescription('Amount earned').setRequired(true)),

  new SlashCommandBuilder()
    .setName('checkpend')
    .setDescription('Check your pending tax balance'),

  new SlashCommandBuilder()
    .setName('tax')
    .setDescription('Send tax reminders (Admin only)')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error(err);
  }
})();

/* =========================== HANDLERS =========================== */
client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const data = loadData();

  // /earn
  if (interaction.commandName === 'earn') {
    const seller = interaction.member;
    if (!seller.roles.cache.has(SELLER_ROLE_ID)) {
      return interaction.reply({ content: '❌ Only sellers can use this command.', ephemeral: true });
    }

    const customer = interaction.options.getUser('customer');
    const amount = interaction.options.getInteger('amount');
    const tax = Math.ceil(amount * TAX_RATE);

    if (!data.users[seller.id]) {
      data.users[seller.id] = { earned: 0, taxPending: 0, spent: 0 };
    }

    data.users[seller.id].earned += amount;
    data.users[seller.id].taxPending += tax;
    saveData(data);

    const embed = new EmbedBuilder()
      .setColor(0x00AE86)
      .setTitle('💰 Earnings Logged')
      .setDescription(`**Customer:** ${customer}\n**Seller:** ${seller}\n**Amount:** \`${amount}\`\n**Tax Added:** \`${tax}\`\n**Total Earned:** \`${data.users[seller.id].earned}\``);

    return interaction.reply({ embeds: [embed] });
  }

  // /checkpend
  if (interaction.commandName === 'checkpend') {
    const seller = interaction.member;
    if (!seller.roles.cache.has(SELLER_ROLE_ID)) {
      return interaction.reply({ content: '❌ Only sellers can use this command.', ephemeral: true });
    }

    const record = data.users[seller.id];
    const pending = record ? record.taxPending : 0;

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('📊 Tax Balance')
          .setDescription(`You currently owe **${pending} 🪙** in taxes to Forgotten Traders.`)
      ],
      ephemeral: true
    });
  }

  // /tax
  if (interaction.commandName === 'tax') {
    if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
      return interaction.reply({ content: '❌ Only admins can use this command.', ephemeral: true });
    }

    for (const [userId, record] of Object.entries(data.users)) {
      if (record.taxPending > 0) {
        const guildMember = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!guildMember) continue;

        try {
          await guildMember.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('💸 Tax Reminder')
                .setDescription(`You currently owe **${record.taxPending} 🪙** in taxes to Forgotten Traders.\n\n**How to pay**\n• PayPal: \`${PAYPAL_USERNAME}\`\n• After paying, reply with a screenshot for verification.\n• Once verified, your Seller role will be restored.`)
                .setImage(TAX_GIF)
            ]
          });

          await guildMember.roles.remove(SELLER_ROLE_ID).catch(() => null);
        } catch (err) {
          console.error(`Failed to DM ${userId}:`, err);
        }
      }
    }

    return interaction.reply({ content: '✅ Tax reminders sent.', ephemeral: true });
  }
});

client.login(TOKEN);
