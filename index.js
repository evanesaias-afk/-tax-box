// index.js — Forgotten Traders Tax + Earnings Bot
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
  REST,
} from 'discord.js';
import cron from 'node-cron';

/* =========================== CONFIG =========================== */
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TOKEN = process.env.TOKEN;

const SELLER_ROLE_ID = '1396594120499400807'; // Seller
const CUSTOMER_ROLES = [
  { amount: 100, roleId: '1404377665766555689' }, // Classic
  { amount: 250, roleId: '1404316539057995878' }, // VIP
  { amount: 500, roleId: '1404316641805734021' }, // Deluxe
  { amount: 1000, roleId: '1404316734998970378' } // Prestige
];

const DATA_DIR = path.resolve('./data');
const ECON_PATH = path.join(DATA_DIR, 'economy.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ECON_PATH)) fs.writeFileSync(ECON_PATH, JSON.stringify({}, null, 2));

/* =========================== BOT SETUP =========================== */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel]
});

function loadEconomy() {
  return JSON.parse(fs.readFileSync(ECON_PATH, 'utf8'));
}
function saveEconomy(data) {
  fs.writeFileSync(ECON_PATH, JSON.stringify(data, null, 2));
}

/* =========================== TAX DM =========================== */
async function sendTaxDM(user, tax) {
  const embed = new EmbedBuilder()
    .setTitle('⏰ Tax Reminder')
    .setDescription(`You currently owe **${tax} :coin:** in taxes to **Forgotten Traders**.`)
    .addFields({
      name: 'How to pay',
      value:
        '• PayPal: **Videogameenjoyer**\n' +
        '• After paying, reply to this DM with a **Rep screenshot** (payment proof).\n' +
        '• Once verified, your **Seller** role will be restored if pending.'
    })
    .setImage('https://cdn.discordapp.com/attachments/1404360337079271504/1406132875551703113/tax-reminder.gif')
    .setColor(0x5865F2);

  try {
    await user.send({ embeds: [embed] });
    console.log(`✅ Tax DM sent to ${user.tag}`);
  } catch (err) {
    console.error(`❌ Failed DM to ${user.tag}:`, err.message);
  }
}

/* =========================== COMMANDS =========================== */
const commands = [
  new SlashCommandBuilder()
    .setName('earn')
    .setDescription('Log customer earnings')
    .addUserOption(opt => opt.setName('customer').setDescription('Customer').setRequired(true))
    .addIntegerOption(opt => opt.setName('amount').setDescription('Earnings amount').setRequired(true)),

  new SlashCommandBuilder()
    .setName('forcetax')
    .setDescription('Force send tax DM to a seller')
    .addUserOption(opt => opt.setName('seller').setDescription('Seller to DM').setRequired(true))
    .addIntegerOption(opt => opt.setName('tax').setDescription('Tax amount').setRequired(true)),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('✅ Commands registered');
}

/* =========================== EVENTS =========================== */
client.once('ready', () => {
  console.log(`🚀 Logged in as ${client.user.tag}`);

  // Weekly Sunday 11AM CST tax reminder
  cron.schedule('0 11 * * 0', async () => {
    const guild = await client.guilds.fetch(GUILD_ID);
    const members = await guild.members.fetch();

    members.forEach(member => {
      if (member.roles.cache.has(SELLER_ROLE_ID)) {
        sendTaxDM(member.user, 25); // hardcoded 25 tax
      }
    });
  }, { timezone: 'America/Chicago' });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const data = loadEconomy();

  if (interaction.commandName === 'earn') {
    const customer = interaction.options.getUser('customer');
    const amount = interaction.options.getInteger('amount');

    if (!data[customer.id]) data[customer.id] = { earnings: 0 };
    data[customer.id].earnings += amount;
    saveEconomy(data);

    const member = await interaction.guild.members.fetch(customer.id);

    for (const tier of CUSTOMER_ROLES) {
      if (data[customer.id].earnings >= tier.amount) {
        if (!member.roles.cache.has(tier.roleId)) {
          await member.roles.add(tier.roleId);
        }
      }
    }

    await interaction.reply({ content: `✅ Logged ${amount} :coin: for ${customer.username}. Total: ${data[customer.id].earnings} :coin:`, ephemeral: true });
  }

  if (interaction.commandName === 'forcetax') {
    const seller = interaction.options.getUser('seller');
    const tax = interaction.options.getInteger('tax');
    await sendTaxDM(seller, tax);
    await interaction.reply({ content: `✅ Tax DM sent to ${seller.username}`, ephemeral: true });
  }
});

/* =========================== START =========================== */
registerCommands().then(() => client.login(TOKEN));
