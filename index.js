// index.js — Tax + Earn Bot with Sunday Tax Reminder
import fs from "fs";
import path from "path";
import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  Routes,
  REST,
  EmbedBuilder,
  PermissionsBitField,
} from "discord.js";
import schedule from "node-schedule";

/* ---------------- CONFIG ---------------- */
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SELLER_ROLE_ID = process.env.SELLER_ROLE_ID; // seller role
const TAX_CHANNEL_ID = process.env.TAX_CHANNEL_ID; // optional logging channel
const DATA_DIR = path.resolve("data");
const ECON_PATH = path.join(DATA_DIR, "economy.json");

// Hardcoded tax message
const TAX_GIF =
  "https://cdn.discordapp.com/attachments/1404360337079271504/1406132875551703113/tax-reminder.gif";
const PAYPAL = "Videogameenjoyer";

/* ---------------- DATA HELPERS ---------------- */
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
  const d = JSON.parse(fs.readFileSync(ECON_PATH, "utf8"));
  if (!d.users) d.users = {};
  if (!d.pendingTaxes) d.pendingTaxes = {}; // ✅ fix
  return d;
}
function saveData(d) {
  fs.writeFileSync(ECON_PATH, JSON.stringify(d, null, 2));
}

/* ---------------- DISCORD CLIENT ---------------- */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const rest = new REST({ version: "10" }).setToken(TOKEN);

/* ---------------- COMMANDS ---------------- */
const commands = [
  new SlashCommandBuilder()
    .setName("earn")
    .setDescription("Log earnings for a customer")
    .addUserOption((opt) =>
      opt.setName("customer").setDescription("Customer").setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt.setName("amount").setDescription("Earnings amount").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("forcetax")
    .setDescription("Force send tax DM to all sellers (admin only)"),
  new SlashCommandBuilder()
    .setName("verifytax")
    .setDescription("Mark seller tax as verified and restore role")
    .addUserOption((opt) =>
      opt.setName("seller").setDescription("Seller").setRequired(true)
    ),
].map((c) => c.toJSON());

async function registerCommands() {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands,
  });
  console.log("✅ Slash commands registered.");
}

/* ---------------- TAX HELPERS ---------------- */
async function sendTaxDM(member) {
  const data = loadData();
  data.pendingTaxes[member.id] = true; // ✅ safe now
  saveData(data);

  const embed = new EmbedBuilder()
    .setColor("Red")
    .setTitle("⏰ Tax Reminder")
    .setDescription(
      `You currently owe **1 :coin:** in taxes to Forgotten Traders.\n\n` +
        `**How to pay**\n` +
        `• PayPal: \`${PAYPAL}\`\n` +
        `• After paying, reply to this DM with a Rep screenshot (payment proof).\n` +
        `• Once verified, your Seller role will be restored if pending.`
    )
    .setImage(TAX_GIF);

  try {
    await member.send({ embeds: [embed] });
    console.log(`📩 Tax DM sent to ${member.user.tag}`);
  } catch {
    console.log(`⚠️ Could not DM ${member.user.tag}`);
  }
}

/* ---------------- COMMAND HANDLERS ---------------- */
async function handleEarn(interaction) {
  const customer = interaction.options.getUser("customer");
  const amount = interaction.options.getInteger("amount");
  const data = loadData();

  if (!data.users[customer.id]) data.users[customer.id] = { spent: 0 };
  data.users[customer.id].spent += amount;
  saveData(data);

  await interaction.reply({
    content: `✅ Logged **${amount}** coins earned from ${customer}. Total: ${data.users[customer.id].spent}`,
    ephemeral: true,
  });
}

async function handleForceTax(interaction) {
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return interaction.reply({ content: "❌ Admin only.", ephemeral: true });
  }

  const guild = interaction.guild;
  const role = guild.roles.cache.get(SELLER_ROLE_ID);
  if (!role) return interaction.reply({ content: "❌ Seller role not found.", ephemeral: true });

  role.members.forEach((member) => sendTaxDM(member));
  await interaction.reply({ content: "📩 Force tax DMs sent.", ephemeral: true });
}

async function handleVerifyTax(interaction) {
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return interaction.reply({ content: "❌ Admin only.", ephemeral: true });
  }

  const seller = interaction.options.getUser("seller");
  const guildMember = await interaction.guild.members.fetch(seller.id);
  const data = loadData();

  delete data.pendingTaxes[seller.id];
  saveData(data);

  await guildMember.roles.add(SELLER_ROLE_ID).catch(() => {});
  await interaction.reply({ content: `✅ Verified tax for ${seller.tag}. Role restored.`, ephemeral: true });
}

/* ---------------- EVENTS ---------------- */
client.on("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Schedule Sunday 11AM CST tax DM
  schedule.scheduleJob("0 11 * * 0", async () => {
    const guild = await client.guilds.fetch(GUILD_ID);
    const role = guild.roles.cache.get(SELLER_ROLE_ID);
    if (!role) return;

    role.members.forEach(async (member) => {
      await member.roles.remove(SELLER_ROLE_ID).catch(() => {});
      sendTaxDM(member);
    });
    console.log("⏰ Sunday tax cycle executed.");
  });
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === "earn") return handleEarn(interaction);
  if (interaction.commandName === "forcetax") return handleForceTax(interaction);
  if (interaction.commandName === "verifytax") return handleVerifyTax(interaction);
});

/* ---------------- START ---------------- */
(async () => {
  await registerCommands();
  client.login(TOKEN);
})();
