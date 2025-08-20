// index.js — Economy + Tax Bot with Seller Tax List
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
} from "discord.js";
import cron from "node-cron";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

/* ================== CONFIG ================== */
const DATA_DIR = path.resolve("data");
const ECON_PATH = path.join(DATA_DIR, "economy.json");

const TAX_RATE = 0.25; // 25% hardcoded
const SELLER_ROLE_ID = "1396594120499400807"; // your seller role

/* ================ STORAGE ================ */
function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ECON_PATH)) {
    fs.writeFileSync(
      ECON_PATH,
      JSON.stringify({ users: {}, taxes: {} }, null, 2)
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

/* ================ COMMANDS ================ */
const commands = [
  new SlashCommandBuilder()
    .setName("earn")
    .setDescription("Log seller earnings and apply 25% tax")
    .addUserOption((o) =>
      o.setName("seller").setDescription("Seller").setRequired(true)
    )
    .addIntegerOption((o) =>
      o.setName("amount").setDescription("Earnings amount").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("checkspend")
    .setDescription("Check your spend/earn log"),

  new SlashCommandBuilder()
    .setName("taxlist")
    .setDescription("See how much tax each seller owes"),
];

/* ================ REGISTER ================= */
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
    body: commands.map((c) => c.toJSON()),
  });
  console.log("✅ Commands registered.");
}

/* ================ COMMAND HANDLER ================= */
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const data = loadData();

  if (interaction.commandName === "earn") {
    const seller = interaction.options.getUser("seller");
    const amount = interaction.options.getInteger("amount");

    if (!data.users[seller.id]) data.users[seller.id] = { earned: 0, taxed: 0 };

    const tax = Math.floor(amount * TAX_RATE);
    const net = amount - tax;

    data.users[seller.id].earned += net;
    data.users[seller.id].taxed += tax;

    saveData(data);

    await interaction.reply(
      `💰 ${seller.username} earned **${net}** after 25% tax (**${tax}** taken).`
    );
  }

  if (interaction.commandName === "checkspend") {
    const user = interaction.user;
    const record = data.users[user.id] || { earned: 0, taxed: 0 };
    await interaction.reply(
      `📊 ${user.username} — Earned: **${record.earned}**, Tax Paid: **${record.taxed}**`
    );
  }

  if (interaction.commandName === "taxlist") {
    let desc = "";
    for (const [id, rec] of Object.entries(data.users)) {
      desc += `<@${id}> — Tax Owed: **${rec.taxed}**\n`;
    }
    if (!desc) desc = "No sellers with taxes logged.";
    const embed = new EmbedBuilder()
      .setTitle("📜 Seller Tax List")
      .setDescription(desc)
      .setColor(0x5865f2);

    await interaction.reply({ embeds: [embed] });
  }
});

/* ================ CRON DM ================= */
client.on("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Every Sunday at 11:00 AM CST
  cron.schedule("0 11 * * 0", async () => {
    const guild = client.guilds.cache.first();
    const data = loadData();

    const sellers = guild.roles.cache.get(SELLER_ROLE_ID)?.members;
    if (!sellers) return;

    sellers.forEach(async (member) => {
      const rec = data.users[member.id] || { earned: 0, taxed: 0 };
      try {
        await member.send(
          `📢 Weekly Seller Report:\nEarned: **${rec.earned}**\nTax Paid: **${rec.taxed}**`
        );
      } catch (err) {
        console.log(`❌ Could not DM ${member.user.tag}`);
      }
    });
  }, { timezone: "America/Chicago" });
});

client.login(process.env.TOKEN);
