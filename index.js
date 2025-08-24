// index.js — Economy + Tax Bot with Weekly Tax DMs
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

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SELLER_ROLE_ID = "1396594120499400807";
const TAX_PERCENT = 25;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
});

// =========================== DATA =========================== //
const dataFile = path.resolve('./spendData.json');
let spendData = { customers: {}, sellers: {} };

if (fs.existsSync(dataFile)) {
  try {
    spendData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch {
    spendData = { customers: {}, sellers: {} };
  }
}

function saveData() {
  fs.writeFileSync(dataFile, JSON.stringify(spendData, null, 2));
}

// =========================== COMMANDS =========================== //
const commands = [
  new SlashCommandBuilder()
    .setName('earn')
    .setDescription('Log a customer purchase (sellers only)')
    .addUserOption(o => o.setName('customer').setDescription('The customer').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount spent').setRequired(true))
    .addUserOption(o => o.setName('seller').setDescription('The seller').setRequired(true)),

  new SlashCommandBuilder()
    .setName('checkspend')
    .setDescription('Check how much a customer has spent (sellers only)')
    .addUserOption(o => o.setName('customer').setDescription('Customer to check').setRequired(true)),

  new SlashCommandBuilder()
    .setName('taxreport')
    .setDescription('Admin only — check total tax collected')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    console.log('⏳ Registering commands...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Commands registered.');
  } catch (err) {
    console.error('❌ Command registration failed:', err);
  }
})();

// =========================== HANDLERS =========================== //
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  scheduleWeeklyTaxDM();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // ----- SELLER ONLY -----
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

    // Save customer spend
    if (!spendData.customers[customer.id]) spendData.customers[customer.id] = 0;
    spendData.customers[customer.id] += amount;

    // Save seller tax/net
    if (!spendData.sellers[seller.id]) spendData.sellers[seller.id] = { owed: 0, net: 0 };
    spendData.sellers[seller.id].owed += tax;
    spendData.sellers[seller.id].net += afterTax;

    saveData();

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('💰 Earn Logged')
          .setDescription(`${seller} earned from ${customer}\nAmount: **${amount}**\nTax: **${tax}**\nNet: **${afterTax}**`)
          .setColor('Blue')
      ],
    });
  }

  // ----- /checkspend -----
  if (interaction.commandName === 'checkspend') {
    const customer = interaction.options.getUser('customer');
    const total = spendData.customers[customer.id] || 0;
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('📊 Customer Spend')
          .setDescription(`${customer} has spent a total of **${total}** coins.`)
          .setColor('Green')
      ],
      ephemeral: true,
    });
  }

  // ----- /taxreport (Admins only) -----
  if (interaction.commandName === 'taxreport') {
    let totalTax = 0;
    for (const sellerId in spendData.sellers) {
      totalTax += spendData.sellers[sellerId].owed;
    }
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🏦 Tax Report')
          .setDescription(`Total tax collected so far: **${totalTax}** coins.`)
          .setColor('Purple')
      ],
      ephemeral: true,
    });
  }
});

// =========================== WEEKLY TAX DM =========================== //
function scheduleWeeklyTaxDM() {
  setInterval(async () => {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcDay = now.getUTCDay();

    // CST = UTC-5 during daylight saving
    const CST_HOUR = (utcHour - 5 + 24) % 24;

    if (utcDay === 0 && CST_HOUR === 11 && now.getMinutes() === 0) {
      console.log("📤 Sending weekly tax DMs...");
      for (const sellerId in spendData.sellers) {
        const sellerData = spendData.sellers[sellerId];
        if (sellerData.owed > 0 || sellerData.net > 0) {
          try {
            const user = await client.users.fetch(sellerId);
            await user.send({
              embeds: [
                new EmbedBuilder()
                  .setTitle('📅 Weekly Tax Report')
                  .setDescription(`This week:\nTax owed: **${sellerData.owed}**\nNet after tax: **${sellerData.net}**`)
                  .setColor('Orange')
              ]
            });
            console.log(`✅ Sent weekly tax DM to ${user.tag}`);
          } catch (e) {
            console.error(`❌ Could not DM seller ${sellerId}`, e.message);
          }
          // reset after sending
          spendData.sellers[sellerId].owed = 0;
          spendData.sellers[sellerId].net = 0;
        }
      }
      saveData();
    }
  }, 60 * 1000); // check every minute
}

// =========================== LOGIN =========================== //
client.login(TOKEN);
