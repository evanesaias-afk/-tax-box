// index.js — ES Module (Node 18+)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  Routes,
  REST,
  EmbedBuilder
} from "discord.js";
import cron from "node-cron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================== CONFIG =========================== */
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID;
const TOKEN     = process.env.TOKEN;

const REVIEW_CHANNEL_ID = "YOUR_REVIEW_CHANNEL_ID";
const SELLER_ROLE_ID    = "YOUR_SELLER_ROLE_ID";

// Earnings → tier roles
const TIER_ROLES = [
  { min: 100,  roleId: "CLASSIC_ROLE_ID" },
  { min: 250,  roleId: "VIP_ROLE_ID" },
  { min: 500,  roleId: "DELUXE_ROLE_ID" },
  { min: 1000, roleId: "PRESTIGE_ROLE_ID" }
];

const TAX_RATE = 25; // 25% hard-coded
const ECON_PATH = path.join(__dirname, "economy.json");

/* =========================== STORAGE =========================== */
function ensureEconomy() {
  if (!fs.existsSync(ECON_PATH)) {
    fs.writeFileSync(ECON_PATH, JSON.stringify({ users: {} }, null, 2));
  }
}
function loadEconomy() {
  ensureEconomy();
  return JSON.parse(fs.readFileSync(ECON_PATH, "utf8"));
}
function saveEconomy(d) {
  fs.writeFileSync(ECON_PATH, JSON.stringify(d, null, 2));
}

/* =========================== DISCORD CLIENT =========================== */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

const commands = [
  new SlashCommandBuilder()
    .setName("earn")
    .setDescription("Log earnings (also records customer spending)")
    .addUserOption(o => o.setName("customer").setDescription("Customer").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Amount earned").setRequired(true)),

  new SlashCommandBuilder()
    .setName("checkspend")
    .setDescription("Check your total spending"),

  new SlashCommandBuilder()
    .setName("review")
    .setDescription("Submit a review")
    .addStringOption(o => o.setName("text").setDescription("Your review").setRequired(true))
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✅ Slash commands registered.");
}

/* =========================== COMMAND HANDLING =========================== */
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const eco = loadEconomy();
  const userId = interaction.user.id;

  if (interaction.commandName === "earn") {
    const amount = interaction.options.getInteger("amount");
    const customer = interaction.options.getUser("customer");

    // seller tracking
    if (!eco.users[userId]) eco.users[userId] = { earned: 0, spent: 0 };
    eco.users[userId].earned += amount;

    // customer spending tracking
    if (!eco.users[customer.id]) eco.users[customer.id] = { earned: 0, spent: 0 };
    eco.users[customer.id].spent += amount;

    saveEconomy(eco);

    // assign tier roles to seller
    const member = await interaction.guild.members.fetch(userId);
    for (const tier of TIER_ROLES) {
      if (eco.users[userId].earned >= tier.min) {
        await member.roles.add(tier.roleId).catch(() => {});
      }
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("💰 Earnings Logged")
          .setDescription(`${interaction.user} earned **${amount}** coins from ${customer}. Tax is **${TAX_RATE}%**.\n\n📊 ${customer.username} has now spent **${eco.users[customer.id].spent}** total.`)
          .setColor(0x00ff99)
      ]
    });

  } else if (interaction.commandName === "checkspend") {
    const spent = eco.users[userId]?.spent || 0;
    await interaction.reply(`🧾 You have spent **${spent}** coins total.`);

  } else if (interaction.commandName === "review") {
    const text = interaction.options.getString("text");
    const channel = await client.channels.fetch(REVIEW_CHANNEL_ID);
    channel.send({ embeds: [new EmbedBuilder().setTitle("📢 New Review").setDescription(text).setFooter({ text: interaction.user.username })] });
    await interaction.reply("✅ Review submitted!");
  }
});

/* =========================== SUNDAY DM =========================== */
// Every Sunday at 11 AM CST
cron.schedule("0 11 * * 0", async () => {
  const eco = loadEconomy();
  for (const id of Object.keys(eco.users)) {
    const member = await client.users.fetch(id).catch(() => null);
    if (member) {
      member.send(`📊 Weekly reminder: All seller trades have a **${TAX_RATE}%** tax.`).catch(() => {});
    }
  }
}, { timezone: "America/Chicago" });

/* =========================== LOGIN =========================== */
client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});
await registerCommands();
client.login(TOKEN);
