// index.js — Tax Box Bot (Node 18+ / ES Module)

import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';
import cron from 'node-cron';

// ---------------- CONFIG ----------------
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const TAX_PERCENT = 25; // hard-coded
const SELLER_ROLE_ID = process.env.SELLER_ROLE_ID; // role ID for sellers

// ----------------------------------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// Register slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Log a payment with tax applied')
    .addUserOption(opt =>
      opt.setName('seller').setDescription('Seller').setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('amount').setDescription('Amount paid').setRequired(true)
    ),
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });
    console.log('✅ Commands registered');
  } catch (err) {
    console.error(err);
  }
}

// Handle interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'pay') {
    const seller = interaction.options.getUser('seller');
    const amount = interaction.options.getInteger('amount');
    const tax = Math.floor(amount * (TAX_PERCENT / 100));
    const net = amount - tax;

    const embed = new EmbedBuilder()
      .setTitle('💰 Transaction Logged')
      .setDescription(
        `<@${interaction.user.id}> paid **${amount}** coins.\n` +
        `Seller <@${seller.id}> taxed **${tax}** coins (25%).\n` +
        `Seller receives **${net}** coins.`
      )
      .setColor(0x00AE86);

    try {
      await interaction.reply({ embeds: [embed], ephemeral: false });
    } catch (err) {
      console.error(err);
    }
  }
});

// ---------------- WEEKLY TAX DMS ----------------
async function sendWeeklyTaxDMs() {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.fetch(); // load all members

    const sellers = guild.members.cache.filter(m =>
      m.roles.cache.has(SELLER_ROLE_ID)
    );

    for (const [, member] of sellers) {
      try {
        await member.send(
          `📢 Reminder: A **${TAX_PERCENT}% tax** applies to all OOG trades.\n` +
          `This is your weekly notice — please log your trades honestly.`
        );
        console.log(`✅ Sent tax DM to ${member.user.tag}`);
      } catch {
        console.warn(`⚠️ Could not DM ${member.user.tag}`);
      }
    }
  } catch (err) {
    console.error('Error sending weekly tax DMs:', err);
  }
}

// Runs every Sunday at 11 AM CST
cron.schedule('0 11 * * 0', () => {
  console.log('⏰ Weekly tax DM job triggered');
  sendWeeklyTaxDMs();
}, {
  timezone: process.env.TIMEZONE || 'America/Chicago',
});

// ---------------- LOGIN ----------------
client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

registerCommands();
client.login(TOKEN);
