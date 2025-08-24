// index.js — Economy + Tax Bot with Permissions
// package.json: { "type": "module", "scripts": { "start": "node index.js" } }

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} from 'discord.js';

// =========================== CONFIG =========================== //
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SELLER_ROLE_ID = "1396594120499400807"; // hard-coded seller role
const TAX_PERCENT = 25; // adjust if you want a different rate

console.log("Token from env:", TOKEN ? `Loaded (${TOKEN.length} chars)` : "❌ Not loaded");

// =========================== CLIENT =========================== //
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

// =========================== DATA STORAGE =========================== //
const dataFile = path.resolve('./spendData.json');
let spendData = {};

if (fs.existsSync(dataFile)) {
  spendData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
}

function saveData() {
  fs.writeFileSync(dataFile, JSON.stringify(spendData, null, 2));
}

// =========================== COMMANDS =========================== //
const commands = [
  new SlashCommandBuilder()
    .setName('earn')
    .setDescription('Log a customer purchase (sellers only)')
    .addUserOption(option =>
      option.setName('customer').setDescription('The customer').setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('amount').setDescription('Amount spent').setRequired(true)
    )
    .addUserOption(option =>
      option.setName('seller').setDescription('The seller').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('checkspend')
    .setDescription('Check how much a customer has spent (sellers only)')
    .addUserOption(option =>
      option.setName('customer').setDescription('Customer to check').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('taxreport')
    .setDescription('Admin only — check total tax collected')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map(cmd => cmd.toJSON());

// =========================== REGISTER =========================== //
const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('⏳ Registering commands...');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log('✅ Commands registered.');
  } catch (err) {
    console.error('❌ Command registration failed:', err);
  }
})();

// =========================== HANDLERS =========================== //
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // ----- SELLER ONLY CHECK -----
  if (['earn', 'checkspend'].includes(interaction.commandName)) {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.roles.cache.has(SELLER_ROLE_ID)) {
      return interaction.reply({ content: "❌ Only sellers can use this command.", ephemeral: true });
    }
  }

  // ----- /earn -----
  if (interaction.commandName === 'earn') {
    const customer = interaction.options.getUser('customer');
    const amount = interaction.options.getInteger('amount');
    const seller = interaction.options.getUser('seller');

    const tax = Math.floor(amount * (TAX_PERCENT / 100));
    const afterTax = amount - tax;

    // Save spend data
    if (!spendData[customer.id]) spendData[customer.id] = 0;
    spendData[customer.id] += amount;
    saveData();

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('💰 Earn Logged')
          .setDescription(`${seller} earned from ${customer}\nAmount: **${amount}**\nTax: **${tax}**\nNet: **${afterTax}**`)
          .setColor('Blue')
      ],
    });

    // DM seller about tax
    try {
      await seller.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('⚠️ Tax Notice')
            .setDescription(`You earned **${amount}**, tax applied: **${tax}**\nNet: **${afterTax}**.`)
            .setColor('Red')
        ]
      });
    } catch (e) {
      console.error(`❌ Could not DM seller ${seller.tag}`, e.message);
    }
  }

  // ----- /checkspend -----
  if (interaction.commandName === 'checkspend') {
    const customer = interaction.options.getUser('customer');
    const total = spendData[customer.id] || 0;
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('📊 Customer Spend')
          .setDescription(`${customer} has spent a total of **${total}** coins.`)
          .setColor('Green')
      ],
      ephemeral: true, // only seller sees result
    });
  }

  // ----- /taxreport (Admins only) -----
  if (interaction.commandName === 'taxreport') {
    let totalTax = 0;
    for (const customerId in spendData) {
      const totalSpent = spendData[customerId];
      totalTax += Math.floor(totalSpent * (TAX_PERCENT / 100));
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🏦 Tax Report')
          .setDescription(`Total tax collected so far: **${totalTax}** coins.`)
          .setColor('Purple')
      ],
      ephemeral: true, // only admin sees
    });
  }
});

// =========================== LOGIN =========================== //
client.login(TOKEN);
