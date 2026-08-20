#!/usr/bin/env node
/* oxlint-disable no-console */
/**
 * Register the bot's slash commands with Discord.
 *
 * Commands are registered over REST, not the Gateway, and they persist on
 * Discord's side — so this runs on demand rather than at boot. Re-running it
 * replaces the whole set, which is what makes a removed command disappear.
 *
 * Set `DISCORD_GUILD_ID` while developing: guild commands appear immediately,
 * while global ones can take up to an hour to propagate.
 *
 *   varlock run -- node scripts/register-commands.mjs
 */
import {
  bulkOverwriteGlobalApplicationCommands,
  bulkOverwriteGuildApplicationCommands,
  discord
} from "@discordkit/client";

const token = process.env.DISCORD_BOT_TOKEN;
const application = process.env.DISCORD_APPLICATION_ID;
const guild = process.env.DISCORD_GUILD_ID;

if (!token || !application) {
  throw new Error(
    `DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID must both be set to register commands. Add them to .env and run through \`varlock run --\`.`
  );
}

discord.setToken(`Bot ${token}`);

/** The command set. This list is the source of truth; Discord mirrors it. */
const commands = [
  {
    name: `ping`,
    description: `Check that the bot is awake.`
  }
];

const registered = guild
  ? await bulkOverwriteGuildApplicationCommands({
      application,
      guild,
      body: commands
    })
  : await bulkOverwriteGlobalApplicationCommands({
      application,
      body: commands
    });

console.log(
  `Registered ${registered.length} command(s) ${guild ? `to guild ${guild}` : `globally`}:`
);
for (const command of registered) console.log(`  /${command.name}`);
