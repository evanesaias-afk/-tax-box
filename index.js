// index.js — ES Module (Node 18+)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  EmbedBuilder,
  SlashCommandBuilder,
  Routes,
  REST,
  PermissionsBitField,
} from "discord.js";
import cron from "node-cron";

/* ================= CONFIG ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const ECON_PATH = path.join(DATA_DIR, "economy.json");

const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TOKEN = process.env.TOKEN;

const SELLER_ROLE_ID = process.env.SELLER_ROLE_ID;
const TAX_PERCENT = parseInt(process.env.TAX_PERCENT || "25");
const TIMEZONE = process.env.TIMEZONE || "America/Chicago";

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(ECON_PATH))
  fs.writeFileSync(ECON_PATH, JSON.stringify({ users: {}, sellers: {} }, null, 2));

const loadEconomy = () => JSON.parse(fs.readFileSync(ECON_PATH));
const saveEconomy = (data) => fs.writeFileSync(ECON_PATH, JSON.stringify(data, null, 2));

/* ================= CLIENT ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel],
});

const rest = new REST({ version: "10" }).setToken(TOKEN);

/* ================= COMMANDS ================= */
const commands = [
  new SlashCommandBuilder()
    .setName("earn")
    .setDescription("Log a customer's purchase & seller's earnings (auto-taxed).")
    .addUserOption((opt) =>
      opt.setName("customer").setDescription("The customer").setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt.setName("amount").setDescription("Amount earned before tax").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("forcetax")
    .setDescription("Force send the weekly tax reminder DM (admin only).")
];

/* ================= REGISTER ================= */
async function registerCommands() {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands,
  });
  console.log("✅ Slash commands registered.");
}

/* ================= /EARN ================= */
async function handleEarn(interaction) {
  const member = interaction.member;
  if (!member.roles.cache.has(SELLER_ROLE_ID)) {
    await interaction.reply({ content: "❌ You must be a Seller to use this command.", ephemeral: true });
    return;
  }

  const customer = interaction.options.getUser("customer");
  const amount = interaction.options.getInteger("amount");

  const tax = Math.floor((amount * TAX_PERCENT) / 100);
  const sellerTake = amount - tax;

  const data = loadEconomy();
  // track customer spend
  if (!data.users[customer.id]) data.users[customer.id] = { spent: 0 };
  data.users[customer.id].spent += amount;

  // track seller earnings
  if (!data.sellers[member.id]) data.sellers[member.id] = { owed: 0, earned: 0 };
  data.sellers[member.id].earned += sellerTake;
  data.sellers[member.id].owed += tax;

  saveEconomy(data);

  const embed = new EmbedBuilder()
    .setTitle("💰 Earnings Logged")
    .setDescription(
      `**Customer:** ${customer}\n**Amount:** ${amount} 🪙\n**Tax (${TAX_PERCENT}%):** ${tax} 🪙\n**You keep:** ${sellerTake} 🪙`
    )
    .setColor(0x00ae86);

  await interaction.reply({ embeds: [embed] });
}

/* ================= TAX DM ================= */
async function sendTaxDM(userId, owed) {
  try {
    const user = await client.users.fetch(userId);

    const embed = new EmbedBuilder()
      .setTitle("📢 Tax Reminder")
      .setDescription(
        `You currently owe **${owed} 🪙** in taxes to **Forgotten Traders**.\n\n` +
        `**How to pay**\n• PayPal: Videogameenjoyer\n• After paying, reply to this DM with a **Rep screenshot** (payment proof).\n• Once verified, your **Seller** role will be restored if pending.`
      )
      .setColor(0xff0000)
      .setImage("https://cdn.discordapp.com/attachments/1404360337079271504/1406132875551703113/tax-reminder.gif");

    await user.send({ embeds: [embed] });
    console.log(`📩 Sent tax DM to ${user.tag}`);
  } catch (err) {
    console.error(`❌ Failed to DM ${userId}:`, err.message);
  }
}

/* ================= FORCE TAX ================= */
async function handleForceTax(interaction) {
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({ content: "❌ Admin only.", ephemeral: true });
    return;
  }

  const data = loadEconomy();
  for (const [userId, info] of Object.entries(data.sellers)) {
    if (info.owed > 0) {
      await sendTaxDM(userId, info.owed);
    }
  }

  await interaction.reply("📢 Forced tax reminders sent.");
}

/* ================= CRON JOB (Sunday 11am CST) ================= */
cron.schedule("0 11 * * 0", async () => {
  console.log("📢 Running weekly tax reminders...");
  const data = loadEconomy();
  for (const [userId, info] of Object.entries(data.sellers)) {
    if (info.owed > 0) {
      await sendTaxDM(userId, info.owed);
    }
  }
}, { timezone: TIMEZONE });

/* ================= HANDLERS ================= */
client.on("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  registerCommands();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "earn") await handleEarn(interaction);
  if (interaction.commandName === "forcetax") await handleForceTax(interaction);
});

/* ================= LOGIN ================= */
client.login(TOKEN);
