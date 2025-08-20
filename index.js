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

/* =========================== CONFIG =========================== */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data storage
const DATA_DIR = path.resolve("data");
const ECON_PATH = path.join(DATA_DIR, "economy.json");

// Colors
const FT_BLUE = 0x5865f2;

// Role IDs
const CLASSIC_ROLE = "1404316149486714991"; // classic customer

/* =========================== UTILS =========================== */
function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ECON_PATH)) {
    fs.writeFileSync(
      ECON_PATH,
      JSON.stringify({ users: {}, taxes: {}, taxPending: {} }, null, 2)
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

/* =========================== CLIENT =========================== */
if (!process.env.TOKEN) {
  console.error("❌ Missing Discord bot TOKEN environment variable!");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

/* =========================== COMMANDS =========================== */

const commands = [
  new SlashCommandBuilder()
    .setName("earn")
    .setDescription("Log a trade earning")
    .addUserOption((opt) =>
      opt.setName("customer").setDescription("Customer").setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt.setName("amount").setDescription("Earnings amount").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("tax")
    .setDescription("Send tax reminder DM")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Who to DM").setRequired(true)
    ),
].map((c) => c.toJSON());

async function registerCommands() {
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: commands,
    });
    console.log("✅ Slash commands registered.");
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
  }
}

/* =========================== HANDLERS =========================== */

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  registerCommands();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const data = loadData();

  if (interaction.commandName === "earn") {
    const customer = interaction.options.getUser("customer");
    const amount = interaction.options.getInteger("amount");

    if (!data.users[customer.id]) data.users[customer.id] = { earned: 0 };
    data.users[customer.id].earned += amount;
    saveData(data);

    // Role auto assign
    const member = await interaction.guild.members.fetch(customer.id);
    if (!member.roles.cache.has(CLASSIC_ROLE)) {
      await member.roles.add(CLASSIC_ROLE);
    }

    await interaction.reply({
      content: `✅ Logged **${amount}** earnings for ${customer}.`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === "tax") {
    const target = interaction.options.getUser("user");
    const embed = new EmbedBuilder()
      .setColor(FT_BLUE)
      .setTitle("📌 Tax Reminder")
      .setDescription("Please remember to submit your weekly tax screenshot!")
      .setImage(
        "https://cdn.discordapp.com/attachments/1404360337079271504/1406132875551703113/tax-reminder.gif"
      )
      .setFooter({ text: "Forgotten Traders" });

    try {
      await target.send({ embeds: [embed] });
      await interaction.reply({
        content: `✅ Tax reminder sent to ${target.tag}.`,
        ephemeral: true,
      });
    } catch (err) {
      await interaction.reply({
        content: `❌ Could not DM ${target.tag}.`,
        ephemeral: true,
      });
    }
  }
});

/* =========================== LOGIN =========================== */
client.login(process.env.TOKEN);
