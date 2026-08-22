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

// Discord's option types. 1 is a subcommand, 3 a string.
const SUB_COMMAND = 1;
const STRING = 3;
const USER = 6;

/**
 * The settings every `/quiz` subcommand that configures a session accepts.
 *
 * These descriptions duplicate `OPTION_HELP` in `src/handlers/quiz/config.ts`,
 * and that is deliberate rather than an oversight. Importing it would pull in
 * `config.ts` -> `forms.js`, and plain Node cannot resolve the `.js` specifiers
 * the app uses for its bundler — the script would fail at run time while
 * typechecking cleanly. `commands.spec.ts` asserts the two stay in step
 * instead, which catches drift at the same moment a change is made.
 */
const settingOptions = [
  {
    type: STRING,
    name: `level`,
    description: `JLPT levels, comma separated. Use N5 to N1, or \`any\`.`
  },
  {
    type: STRING,
    name: `type`,
    description: `Word types: verb, adj-i, adj-na, noun.`
  },
  {
    type: STRING,
    name: `class`,
    description: `Verb classes: ichidan, godan, suru, kuru.`
  },
  {
    type: STRING,
    name: `forms`,
    description: `Forms to ask: "basics", "all", or specific names.`
  },
  {
    type: STRING,
    name: `length`,
    description: `Questions per session, 1-50, or "endless".`
  },
  {
    type: STRING,
    name: `timeout`,
    description: `How long each question stays open, 30s to 10m.`
  },
  {
    type: STRING,
    name: `guesses`,
    description: `Attempts per player per question, 1-10.`
  }
];

/** The command set. This list is the source of truth; Discord mirrors it. */
const commands = [
  {
    name: `ping`,
    description: `Check that the bot is awake.`
  },
  {
    name: `hint`,
    description: `A private nudge on the current question.`
  },
  {
    name: `quiz`,
    description: `Japanese conjugation practice.`,
    options: [
      {
        type: SUB_COMMAND,
        name: `start`,
        description: `Start a conjugation session in this channel.`,
        options: settingOptions
      },
      {
        type: SUB_COMMAND,
        name: `config`,
        description: `Change the running session, from the next question.`,
        options: settingOptions
      },
      {
        type: SUB_COMMAND,
        name: `end`,
        description: `End the session and show the standings.`
      },
      {
        type: SUB_COMMAND,
        name: `scores`,
        description: `Show this server's leaderboard.`,
        options: [
          {
            type: USER,
            name: `user`,
            description: `Show one player's standing instead of the leaderboard.`
          }
        ]
      }
    ]
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
