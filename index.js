// index.js — Economy Bot
import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits
} from 'discord.js';
import fs from 'fs';
import path from 'path';

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// ==== HARDCODED ROLES ====
const SELLER_ROLE = "1396594120499400807";
const CLASSIC = "1404316149486714991";
const VIP = "1404317193667219611";
const DELUXE = "1404316641805734021";
const PRESTIGE = "1404316734998970378";

const DATA_FILE = path.resolve('economy.json');
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({}));

function loadData() { return JSON.parse(fs.readFileSync(DATA_FILE)); }
function saveData(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

const commands = [
  new SlashCommandBuilder()
    .setName('earn')
    .setDescription('Log a customer earning')
    .addUserOption(opt => opt.setName('customer').setDescription('Customer').setRequired(true))
    .addIntegerOption(opt => opt.setName('amount').setDescription('Amount spent').setRequired(true))
    .addUserOption(opt => opt.setName('seller').setDescription('Seller').setRequired(true)),

  new SlashCommandBuilder()
    .setName('tax')
    .setDescription('Log a tax payment')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
async function registerCommands() {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("Economy bot commands registered ✅");
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === 'earn') {
    const sellerMember = await interaction.guild.members.fetch(interaction.user.id);
    if (!sellerMember.roles.cache.has(SELLER_ROLE)) {
      return interaction.reply({ content: "❌ Only sellers can use this.", ephemeral: true });
    }

    const customer = interaction.options.getUser('customer');
    const amount = interaction.options.getInteger('amount');
    const seller = interaction.options.getUser('seller');

    const data = loadData();
    if (!data[customer.id]) data[customer.id] = 0;
    data[customer.id] += amount;
    saveData(data);

    // Role assignment
    const member = await interaction.guild.members.fetch(customer.id);
    if (data[customer.id] >= 1000) await member.roles.add(PRESTIGE);
    else if (data[customer.id] >= 500) await member.roles.add(DELUXE);
    else if (data[customer.id] >= 250) await member.roles.add(VIP);
    else if (data[customer.id] >= 1) await member.roles.add(CLASSIC);

    await interaction.reply(`💰 Logged **${amount}** spent by ${customer.tag} (Seller: ${seller.tag})`);
  }

  if (interaction.commandName === 'tax') {
    await interaction.reply("✅ Tax logged (Admin only).");
  }
});

client.once('ready', () => console.log(`Economy Bot logged in as ${client.user.tag}`));
registerCommands();
client.login(TOKEN);
