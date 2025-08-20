// index.js — ES Module
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  SlashCommandBuilder,
  Routes,
  REST,
  PermissionsBitField,
} from "discord.js";

/* -------------------- paths -------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");
const ECON_PATH = path.join(DATA_DIR, "economy.json");

/* -------------------- data helpers -------------------- */
function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ECON_PATH)) {
    fs.writeFileSync(
      ECON_PATH,
      JSON.stringify({ users: {}, pendingTaxes: {} }, null, 2)
    );
  }
}
function loadData() {
  ensureData();
  return JSON.parse(fs.readFileSync(ECON_PATH, "utf8"));
}
function saveData(d) {
  fs.writeFileSync(ECON_PATH, JSON.stringify(d, null, 2));
}

/* -------------------- config -------------------- */
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TOKEN = process.env.TOKEN;

const SELLER_ROLE_ID = "1396594120499400807"; // seller
const CUSTOMER_ROLES = [
  { min: 100, roleId: "1404377665766555689" }, // Classic
  { min: 250, roleId: "1404316539057995878" }, // VIP
  { min: 500, roleId: "1404316641805734021" }, // Deluxe
  { min: 1000, roleId: "1404316734998970378" }, // Prestige
];

const TAX_GIF =
  "https://cdn.discordapp.com/attachments/1404360337079271504/1406132875551703113/tax-reminder.gif";
const PAYPAL = "Videogameenjoyer";

/* -------------------- client -------------------- */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.User],
});

/* -------------------- commands -------------------- */
const commands = [
  new SlashCommandBuilder()
    .setName("earn")
    .setDescription("Log an earning for a customer.")
    .addUserOption((opt) =>
      opt.setName("customer").setDescription("Customer").setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt.setName("amount").setDescription("Coins earned").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("verifytax")
    .setDescription("Verify seller's tax payment and restore role.")
    .addUserOption((opt) =>
      opt.setName("seller").setDescription("Seller user").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("forcetax")
    .setDescription("Force a tax reminder DM to a seller right now.")
    .addUserOption((opt) =>
      opt.setName("seller").setDescription("Seller user").setRequired(true)
    ),
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands,
  });
  console.log("✅ Slash commands registered.");
}

/* -------------------- earn -------------------- */
async function handleEarn(interaction) {
  const customer = interaction.options.getUser("customer");
  const amount = interaction.options.getInteger("amount");

  const data = loadData();
  if (!data.users[customer.id]) data.users[customer.id] = { earnings: 0 };
  data.users[customer.id].earnings += amount;
  saveData(data);

  // role check
  const member = await interaction.guild.members.fetch(customer.id);
  for (const tier of CUSTOMER_ROLES) {
    if (data.users[customer.id].earnings >= tier.min) {
      if (!member.roles.cache.has(tier.roleId)) {
        await member.roles.add(tier.roleId).catch(() => {});
      }
    }
  }

  await interaction.reply({
    content: `💰 Logged **${amount} coins** for ${customer.username}. Total: ${data.users[customer.id].earnings}`,
    ephemeral: true,
  });
}

/* -------------------- verifytax -------------------- */
async function handleVerifyTax(interaction) {
  const seller = interaction.options.getUser("seller");
  const data = loadData();

  if (!data.pendingTaxes[seller.id]) {
    return interaction.reply({
      content: `${seller.username} is not pending taxes.`,
      ephemeral: true,
    });
  }

  delete data.pendingTaxes[seller.id];
  saveData(data);

  const member = await interaction.guild.members.fetch(seller.id);
  await member.roles.add(SELLER_ROLE_ID).catch(() => {});

  await interaction.reply({
    content: `✅ Verified tax payment for ${seller.username}. Seller role restored.`,
    ephemeral: true,
  });
}

/* -------------------- sendTaxDM -------------------- */
async function sendTaxDM(member) {
  const data = loadData();
  data.pendingTaxes[member.id] = true;
  saveData(data);

  await member.roles.remove(SELLER_ROLE_ID).catch(() => {});

  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle("⏰ Tax Reminder")
    .setDescription(
      `You currently owe **1 :coin:** in taxes to Forgotten Traders.\n\n**How to pay**\n• PayPal: **${PAYPAL}**\n• After paying, reply to this DM with a **Rep screenshot** (payment proof).\n• Once verified, your Seller role will be restored.`
    )
    .setImage(TAX_GIF);

  await member.send({ embeds: [embed] }).catch(() => {});
}

/* -------------------- forcetax -------------------- */
async function handleForceTax(interaction) {
  const seller = interaction.options.getUser("seller");
  const member = await interaction.guild.members.fetch(seller.id);

  await sendTaxDM(member);

  await interaction.reply({
    content: `⏰ Forced tax DM sent to ${seller.username}.`,
    ephemeral: true,
  });
}

/* -------------------- sunday tax job -------------------- */
async function runSundayTax() {
  const guild = await client.guilds.fetch(GUILD_ID);
  const members = await guild.members.fetch();

  for (const member of members.values()) {
    if (member.roles.cache.has(SELLER_ROLE_ID)) {
      await sendTaxDM(member);
    }
  }
}

/* -------------------- schedule (Sunday 11 AM CST) -------------------- */
function scheduleSunday() {
  setInterval(async () => {
    const now = new Date();
    if (now.getUTCDay() === 0 && now.getUTCHours() === 16 && now.getUTCMinutes() === 0) {
      await runSundayTax();
    }
  }, 60 * 1000);
}

/* -------------------- ready -------------------- */
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
  scheduleSunday();
});

/* -------------------- interaction -------------------- */
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "earn") return handleEarn(interaction);
  if (interaction.commandName === "verifytax") return handleVerifyTax(interaction);
  if (interaction.commandName === "forcetax") return handleForceTax(interaction);
});

/* -------------------- login -------------------- */
client.login(TOKEN);
