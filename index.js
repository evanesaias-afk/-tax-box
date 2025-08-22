// index.js — Forgotten Traders Bot (Patched)
import fs from "fs";
import path from "path";
import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  PermissionsBitField,
} from "discord.js";
import cron from "node-cron";

/* ================= CONFIG ================= */
const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// Role IDs
const SELLER_ROLE_ID   = "1396594120499400807";
const CLASSIC_ROLE_ID  = "1404316149486714991";
const VIP_ROLE_ID      = "1404317193667219611";
const DELUXE_ROLE_ID   = "1404316641805734021";
const PRESTIGE_ROLE_ID = "1404316734998970378";
const ADMIN_ROLE_ID    = "1396593504603607153";

// Files
const DATA_DIR = "data";
const ECON_PATH = path.join(DATA_DIR, "economy.json");

// Tax settings
const TAX_PERCENT = 0.25;
const TAX_GIF = "https://i.imgur.com/yourTaxGif.gif"; // replace with real gif
const PAYPAL_NAME = "Videogameenjoyer";

/* ================= ECONOMY HELPERS ================= */
function ensureEconomy() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ECON_PATH)) {
    fs.writeFileSync(ECON_PATH, JSON.stringify({ users: {}, taxes: {} }, null, 2));
  }
}
function loadEconomy() {
  ensureEconomy();
  return JSON.parse(fs.readFileSync(ECON_PATH, "utf8"));
}
function saveEconomy(d) {
  fs.writeFileSync(ECON_PATH, JSON.stringify(d, null, 2));
}

/* ================= ADMIN CHECK ================= */
function isAdmin(member) {
  return (
    member.roles.cache.has(ADMIN_ROLE_ID) ||
    member.permissions.has(PermissionsBitField.Administrator)
  );
}

/* ================= COMMANDS ================= */
const commands = [
  new SlashCommandBuilder()
    .setName("earn")
    .setDescription("Log a customer’s purchase/earnings.")
    .addUserOption(opt =>
      opt.setName("customer").setDescription("Customer to reward").setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName("amount").setDescription("Amount earned").setRequired(true)
    )
    .addUserOption(opt =>
      opt.setName("seller").setDescription("Seller who made the trade").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("checkpend")
    .setDescription("View all pending taxes (Admins only)."),

  new SlashCommandBuilder()
    .setName("tax")
    .setDescription("Log a tax entry (Admins only).")
    .addUserOption(opt =>
      opt.setName("seller").setDescription("Seller to tax").setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName("amount").setDescription("Amount owed").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("paytax")
    .setDescription("Mark a seller’s tax as paid (Admins only).")
    .addUserOption(opt =>
      opt.setName("seller").setDescription("Seller to clear tax for").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("cleartax")
    .setDescription("Clear ALL pending taxes (Admins only)."),
].map(c => c.toJSON());

/* ================= CLIENT ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

/* ================= REGISTER ================= */
const rest = new REST({ version: "10" }).setToken(TOKEN);
async function registerCommands() {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Slash commands registered");
  } catch (err) {
    console.error("❌ Command registration failed:", err);
  }
}

/* ================= HANDLER ================= */
client.on("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

/* -------- /earn -------- */
async function handleEarn(interaction) {
  await interaction.deferReply();

  if (!interaction.member.roles.cache.has(SELLER_ROLE_ID)) {
    return interaction.editReply("❌ Only sellers can use this command.");
  }

  const customer = interaction.options.getUser("customer");
  const amount   = interaction.options.getInteger("amount");
  const seller   = interaction.options.getUser("seller");

  if (!customer || !seller) {
    return interaction.editReply("❌ Invalid customer or seller.");
  }

  let db = loadEconomy();
  if (!db.users[customer.id]) db.users[customer.id] = { earned: 0 };
  db.users[customer.id].earned += amount;

  // calculate tax
  const taxAmount = Math.ceil(amount * TAX_PERCENT);
  if (!db.taxes[seller.id]) db.taxes[seller.id] = 0;
  db.taxes[seller.id] += taxAmount;

  // remove seller role until tax is paid
  const sellerMember = await interaction.guild.members.fetch(seller.id).catch(()=>null);
  if (sellerMember) {
    await sellerMember.roles.remove(SELLER_ROLE_ID).catch(()=>{});
  }

  saveEconomy(db);

  // Auto role customers
  const total = db.users[customer.id].earned;
  const member = await interaction.guild.members.fetch(customer.id).catch(()=>null);
  if (member) {
    if (total >= 1000) await member.roles.add(PRESTIGE_ROLE_ID).catch(()=>{});
    else if (total >= 500) await member.roles.add(DELUXE_ROLE_ID).catch(()=>{});
    else if (total >= 250) await member.roles.add(VIP_ROLE_ID).catch(()=>{});
    else if (total >= 100) await member.roles.add(CLASSIC_ROLE_ID).catch(()=>{});
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle("💰 Earnings Logged")
    .setDescription(
      `**Customer:** ${customer}\n` +
      `**Seller:** ${seller}\n` +
      `**Amount:** \`${amount}\`\n` +
      `**Tax Added:** \`${taxAmount}\`\n` +
      `**Customer Total Earned:** \`${total}\``
    )
    .setFooter({ text: "Forgotten Traders - /earn" });

  return interaction.editReply({ embeds: [embed] });
}

/* -------- /checkpend -------- */
async function handleCheckpend(interaction) {
  await interaction.deferReply({ ephemeral: true });

  if (!isAdmin(interaction.member)) {
    return interaction.editReply("❌ Only admins can use this command.");
  }

  const db = loadEconomy();
  const taxes = db.taxes || {};

  if (Object.keys(taxes).length === 0) {
    return interaction.editReply("✅ No pending taxes.");
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle("📊 Pending Taxes")
    .setDescription(
      Object.entries(taxes)
        .map(([uid, amt]) => `<@${uid}> owes \`${amt}\``)
        .join("\n")
    )
    .setFooter({ text: "Forgotten Traders - /checkpend" });

  return interaction.editReply({ embeds: [embed] });
}

/* -------- /tax -------- */
async function handleTax(interaction) {
  await interaction.deferReply();

  if (!isAdmin(interaction.member)) {
    return interaction.editReply("❌ Only admins can use this command.");
  }

  const seller = interaction.options.getUser("seller");
  const amount = interaction.options.getInteger("amount");

  if (!seller) {
    return interaction.editReply("❌ Invalid seller.");
  }

  let db = loadEconomy();
  if (!db.taxes[seller.id]) db.taxes[seller.id] = 0;
  db.taxes[seller.id] += amount;
  saveEconomy(db);

  // remove seller role
  const sellerMember = await interaction.guild.members.fetch(seller.id).catch(()=>null);
  if (sellerMember) {
    await sellerMember.roles.remove(SELLER_ROLE_ID).catch(()=>{});
  }

  return interaction.editReply(`✅ Added \`${amount}\` tax for ${seller}.`);
}

/* -------- /paytax -------- */
async function handlePaytax(interaction) {
  await interaction.deferReply();

  if (!isAdmin(interaction.member)) {
    return interaction.editReply("❌ Only admins can use this command.");
  }

  const seller = interaction.options.getUser("seller");
  if (!seller) return interaction.editReply("❌ Invalid seller.");

  let db = loadEconomy();
  db.taxes[seller.id] = 0;
  saveEconomy(db);

  // restore seller role
  const sellerMember = await interaction.guild.members.fetch(seller.id).catch(()=>null);
  if (sellerMember) {
    await sellerMember.roles.add(SELLER_ROLE_ID).catch(()=>{});
  }

  return interaction.editReply(`✅ Cleared tax for ${seller} and restored Seller role.`);
}

/* -------- /cleartax -------- */
async function handleCleartax(interaction) {
  await interaction.deferReply();

  if (!isAdmin(interaction.member)) {
    return interaction.editReply("❌ Only admins can use this command.");
  }

  let db = loadEconomy();
  db.taxes = {};
  saveEconomy(db);

  return interaction.editReply("✅ All taxes cleared.");
}

/* -------- Interaction Routing -------- */
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "earn") return handleEarn(interaction);
  if (interaction.commandName === "checkpend") return handleCheckpend(interaction);
  if (interaction.commandName === "tax") return handleTax(interaction);
  if (interaction.commandName === "paytax") return handlePaytax(interaction);
  if (interaction.commandName === "cleartax") return handleCleartax(interaction);
});

/* ================= SUNDAY DM REMINDER ================= */
cron.schedule("0 11 * * 0", async () => {
  const guild = await client.guilds.fetch(GUILD_ID).catch(()=>null);
  if (!guild) return;

  const db = loadEconomy();
  const taxes = db.taxes || {};

  const members = await guild.members.fetch();
  for (const [id, member] of members) {
    if (!member.roles.cache.has(SELLER_ROLE_ID)) continue;
    const owed = taxes[id] || 0;
    if (owed <= 0) continue;

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle("💸 Tax Reminder")
      .setDescription(
        `You currently owe **${owed} 🪙** in taxes to **Forgotten Traders**\n\n` +
        `**How to pay**\n` +
        `• PayPal: **${PAYPAL_NAME}**\n` +
        `• After paying, reply to this DM with a **Rep screenshot**\n` +
        `• Once verified, your **Seller role** will be restored if pending.`
      )
      .setImage(TAX_GIF)
      .setFooter({ text: "Taxes are due!" });

    await member.send({ embeds: [embed] }).catch(()=>{});
  }
}, { timezone: "America/Chicago" });

/* ================= START ================= */
registerCommands();
client.login(TOKEN);
