/* =========================== index.js =========================== */

import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionsBitField
} from 'discord.js';

/* ---------------- CONFIG ---------------- */
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID;
const TOKEN     = process.env.TOKEN;

const SELLER_ROLE_ID = '1396594120499400807';

const TIER_ROLES = [
  { min: 1,    roleId: '1404316149486714991', name: 'Classic Customer' },
  { min: 100,  roleId: '1404377665766555689', name: 'VIP Customer' },
  { min: 250,  roleId: '1404316539057995878', name: 'Deluxe Customer' },
  { min: 500,  roleId: '1404316641805734021', name: 'Prestige Customer' },
  { min: 1000, roleId: '1404316734998970378', name: 'Titan Customer' }
];

const DATA_DIR = path.resolve('data');
const ECON_PATH = path.join(DATA_DIR, 'economy.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(ECON_PATH)) fs.writeFileSync(ECON_PATH, JSON.stringify({ users: {}, taxes: {} }, null, 2));

function loadData() {
  return JSON.parse(fs.readFileSync(ECON_PATH, 'utf8'));
}
function saveData(d) {
  fs.writeFileSync(ECON_PATH, JSON.stringify(d, null, 2));
}

/* ---------------- CLIENT ---------------- */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

/* ---------------- COMMANDS ---------------- */
const commands = [
  new SlashCommandBuilder()
    .setName('earn')
    .setDescription('Log a customer purchase and track seller tax')
    .addUserOption(opt => opt.setName('customer').setDescription('Customer').setRequired(true))
    .addUserOption(opt => opt.setName('seller').setDescription('Seller').setRequired(true))
    .addIntegerOption(opt => opt.setName('amount').setDescription('Coins spent').setRequired(true)),

  new SlashCommandBuilder()
    .setName('checkspend')
    .setDescription('Check how much a customer has spent')
    .addUserOption(opt => opt.setName('customer').setDescription('Customer').setRequired(true)),

  new SlashCommandBuilder()
    .setName('checktax')
    .setDescription('Check pending tax owed for a seller')
    .addUserOption(opt => opt.setName('seller').setDescription('Seller').setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Commands registered');
  } catch (err) {
    console.error(err);
  }
})();

/* ---------------- HANDLERS ---------------- */
client.on('ready', () => console.log(`Logged in as ${client.user.tag}`));

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const data = loadData();

  if (interaction.commandName === 'earn') {
    const customer = interaction.options.getUser('customer');
    const seller   = interaction.options.getUser('seller');
    const amount   = interaction.options.getInteger('amount');

    // Update customer spend
    if (!data.users[customer.id]) data.users[customer.id] = { spent: 0 };
    data.users[customer.id].spent += amount;

    // Auto role based on spend
    const member = await interaction.guild.members.fetch(customer.id);
    for (let tier of TIER_ROLES) {
      if (data.users[customer.id].spent >= tier.min) {
        if (!member.roles.cache.has(tier.roleId)) {
          await member.roles.add(tier.roleId);
        }
      }
    }

    // Update seller tax
    if (!data.taxes[seller.id]) data.taxes[seller.id] = { owed: 0 };
    const tax = Math.floor(amount * 0.25);
    data.taxes[seller.id].owed += tax;

    saveData(data);

    const embed = new EmbedBuilder()
      .setTitle('Transaction Logged')
      .setDescription(`${customer} spent **${amount}** coins. Seller ${seller} taxed **${tax}** coins.`)
      .setColor(0x5865F2);

    await interaction.reply({ embeds: [embed], ephemeral: false });
  }

  if (interaction.commandName === 'checkspend') {
    const customer = interaction.options.getUser('customer');
    const spent = data.users[customer.id]?.spent || 0;
    await interaction.reply(`${customer} has spent **${spent}** coins.`);
  }

  if (interaction.commandName === 'checktax') {
    const seller = interaction.options.getUser('seller');
    const owed = data.taxes[seller.id]?.owed || 0;
    await interaction.reply(`${seller} currently owes **${owed}** coins in taxes.`);
  }
});

client.login(TOKEN);

/* =========================== package.json =========================== */
{
  "name": "earn-tax-bot",
  "version": "1.0.0",
  "description": "Bot for tracking spending and taxes",
  "main": "index.js",
  "type": "module",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "discord.js": "^14.15.3",
    "dotenv": "^16.4.5"
  }
}

/* =========================== config.json =========================== */
{
  "clientId": "YOUR_CLIENT_ID",
  "guildId": "YOUR_GUILD_ID",
  "token": "YOUR_BOT_TOKEN"
}

/* =========================== economy.json (initial) =========================== */
{
  "users": {},
  "taxes": {}
}
