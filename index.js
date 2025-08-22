// index.js — Payday Bot with Auto-Tax
import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import cron from 'node-cron';
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  SlashCommandBuilder,
  Routes,
  REST,
  ChannelType,
  PermissionsBitField
} from 'discord.js';

/* ---------------- CONFIG ---------------- */
const CLIENT_ID = process.env.CLIENT_ID;
const TOKEN = process.env.TOKEN;

const ADMIN_ROLE_ID = '1396593504603607153';
const SELLER_ROLE_ID = '1396594120499400807';

const PAYPAL_USERNAME = 'YourPayPalHere';
const TAX_GIF = 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/example.gif'; // replace

/* ---------------- DATA ---------------- */
const DATA_DIR = path.resolve('data');
const ECON_PATH = path.join(DATA_DIR, 'economy.json');

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ECON_PATH)) {
    fs.writeFileSync(ECON_PATH, JSON.stringify({ users: {} }, null, 2));
  }
}
function loadData() {
  ensureData();
  return JSON.parse(fs.readFileSync(ECON_PATH, 'utf8'));
}
function saveData(d) {
  fs.writeFileSync(ECON_PATH, JSON.stringify(d, null, 2));
}

let data = loadData();

/* ---------------- CLIENT ---------------- */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

/* ---------------- COMMANDS ---------------- */
const commands = [
  new SlashCommandBuilder()
    .setName('earn')
    .setDescription('Log customer payment to seller')
    .addUserOption(o => o.setName('customer').setDescription('Customer').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount paid').setRequired(true)),

  new SlashCommandBuilder()
    .setName('checkpend')
    .setDescription('Check your pending tax'),

  new SlashCommandBuilder()
    .setName('checkspend')
    .setDescription('Check how much a customer has spent')
    .addUserOption(o => o.setName('customer').setDescription('Customer').setRequired(true)),

  new SlashCommandBuilder()
    .setName('tax')
    .setDescription('Send tax reminders (Admins only)')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('⏳ Registering commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('❌ Command registration failed:', err);
  }
})();

/* ---------------- TAX LOGIC (reused for /tax + auto) ---------------- */
async function runTaxCheck(guild) {
  data = loadData();
  let sent = 0;

  for (const [userId, record] of Object.entries(data.users)) {
    if (record.taxPending > 0) {
      try {
        const member = await guild.members.fetch(userId).catch(() => null);
        const user = await client.users.fetch(userId);

        await user.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xff0000)
              .setTitle('⚠ Tax Payment Due')
              .setDescription(
                `You owe **${record.taxPending}** in taxes.\n\n` +
                `Pay via PayPal: \`${PAYPAL_USERNAME}\`\n` +
                `Send screenshot proof in this DM to restore your Seller role.`
              )
              .setImage(TAX_GIF)
          ]
        });

        if (member && member.roles.cache.has(SELLER_ROLE_ID)) {
          await member.roles.remove(SELLER_ROLE_ID);
          console.log(`🚫 Removed Seller role from ${user.tag}`);
        }

        console.log(`✅ Sent tax DM to ${user.tag}`);
        sent++;
      } catch (err) {
        console.error(`❌ Could not process ${userId}:`, err);
      }
    }
  }

  return sent;
}

/* ---------------- INTERACTIONS ---------------- */
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply({ ephemeral: true }).catch(() => {});
  data = loadData();

  /* /earn */
  if (interaction.commandName === 'earn') {
    if (!interaction.member.roles.cache.has(SELLER_ROLE_ID)) {
      return interaction.editReply('❌ Only sellers can use this command.');
    }

    const customer = interaction.options.getUser('customer');
    const amount = interaction.options.getInteger('amount');
    const sellerId = interaction.user.id;

    if (!data.users[sellerId]) data.users[sellerId] = { earned: 0, spent: 0, taxPending: 0 };
    if (!data.users[customer.id]) data.users[customer.id] = { earned: 0, spent: 0, taxPending: 0 };

    const tax = Math.ceil(amount * 0.25);

    data.users[sellerId].earned += amount;
    data.users[sellerId].taxPending += tax;
    data.users[customer.id].spent += amount;

    saveData(data);

    const embed = new EmbedBuilder()
      .setColor(0x55ff55)
      .setTitle('💰 Earnings Logged')
      .setDescription(
        `**Customer:** ${customer}\n` +
        `**Seller:** ${interaction.user}\n` +
        `**Amount:** \`${amount}\`\n` +
        `**Tax Added:** \`${tax}\`\n` +
        `**Customer Total Spent:** \`${data.users[customer.id].spent}\``
      )
      .setFooter({ text: 'Forgotten Traders - Payday Bot' });

    return interaction.editReply({ embeds: [embed] });
  }

  /* /checkpend */
  if (interaction.commandName === 'checkpend') {
    const u = data.users[interaction.user.id];
    const pending = u ? u.taxPending : 0;
    return interaction.editReply(`💸 You currently owe **${pending}** in taxes.`);
  }

  /* /checkspend */
  if (interaction.commandName === 'checkspend') {
    const customer = interaction.options.getUser('customer');
    const u = data.users[customer.id];
    const spent = u ? u.spent : 0;
    return interaction.editReply(`🛒 ${customer} has spent a total of **${spent}**.`);
  }

  /* /tax */
  if (interaction.commandName === 'tax') {
    if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
      return interaction.editReply('❌ Only admins can run this command.');
    }
    const sent = await runTaxCheck(interaction.guild);
    return interaction.editReply(sent === 0 ? 'ℹ No sellers currently owe tax.' : `✅ Tax reminders sent to ${sent} seller(s).`);
  }
});

/* ---------------- DM PROOF HANDLER ---------------- */
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.type !== ChannelType.DM) return;

  const userId = message.author.id;
  if (!data.users[userId] || data.users[userId].taxPending <= 0) return;

  if (message.attachments.size > 0) {
    try {
      data.users[userId].taxPending = 0;
      saveData(data);

      const guild = client.guilds.cache.first();
      const member = await guild.members.fetch(userId).catch(() => null);

      if (member && !member.roles.cache.has(SELLER_ROLE_ID)) {
        await member.roles.add(SELLER_ROLE_ID);
        await message.author.send(`✅ Your tax has been confirmed and your Seller role has been restored.`);
        console.log(`✅ Restored Seller role for ${message.author.tag}`);
      }
    } catch (err) {
      console.error(`❌ Failed to restore seller role for ${userId}:`, err);
    }
  } else {
    await message.author.send(`⚠ Please send a screenshot of your payment as an image attachment to restore your Seller role.`);
  }
});

/* ---------------- AUTO TAX (Sunday 11AM CST) ---------------- */
client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  cron.schedule('0 11 * * 0', async () => {
    try {
      const guild = client.guilds.cache.first();
      const sent = await runTaxCheck(guild);
      console.log(`📅 Weekly tax run finished — ${sent} reminder(s) sent.`);
    } catch (err) {
      console.error('❌ Weekly tax run failed:', err);
    }
  }, { timezone: 'America/Chicago' }); // CST/CDT
});

/* ---------------- LOGIN ---------------- */
client.login(TOKEN);
