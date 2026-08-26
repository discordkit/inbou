#!/usr/bin/env node
/* oxlint-disable no-console */
/**
 * Register the bot's slash commands with Discord.
 *
 * Commands are registered over REST, not the Gateway, and they persist on
 * Discord's side — so this runs on demand rather than at boot. Re-running it
 * replaces the whole set, which is what makes a removed command disappear.
 *
 * Two scopes, for two different jobs:
 *
 * **Global** is the real one. Commands belong to the application, so a global
 * registration covers every guild that installs the bot, including ones that
 * install it later — there is no per-server step, ever. A user who runs a
 * command Discord has not caught up on gets it read-repaired on the spot.
 *
 * **Guild** is a development shortcut: a private copy scoped to one server that
 * updates instantly. It also *shadows* the global command of the same name in
 * that server until cleared, so the place you test is the one place the
 * published command list is not what runs.
 *
 *   vp run commands:register      # honours DISCORD_GUILD_ID — the dev loop
 *   vp run commands:publish       # always global, whatever the environment holds
 *   vp run commands:clear-guild   # remove the guild copy so global takes over
 */
import {
  bulkOverwriteGlobalApplicationCommands,
  bulkOverwriteGuildApplicationCommands,
  discord
} from "@discordkit/client";

const token = process.env.DISCORD_BOT_TOKEN;
const application = process.env.DISCORD_APPLICATION_ID;
const guild = process.env.DISCORD_GUILD_ID;

/**
 * Publishing must not depend on a variable being absent.
 *
 * Without this the scope came from whether `DISCORD_GUILD_ID` happened to be
 * set wherever the deploy ran, so a release from a machine holding a dev `.env`
 * published to one server and reported success — leaving every real user with
 * no commands at all. The safe path is now the one you have to name.
 */
const forceGlobal = process.argv.includes(`--global`);
const clearGuild = process.argv.includes(`--clear-guild`);

if (!token || !application) {
  throw new Error(
    `DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID must both be set to register commands. Add them to .env and run through \`varlock run --\`.`
  );
}

if (clearGuild && !guild) {
  throw new Error(
    `--clear-guild needs DISCORD_GUILD_ID set, so it knows which server to clear.`
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
    description: `Forms to ask: "basics", "all", "compounds", or a name.`
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
    name: `feedback`,
    description: `Report a problem or suggest an idea.`,
    options: [
      {
        type: SUB_COMMAND,
        name: `bug`,
        description: `Something the bot did wrong.`,
        options: [
          {
            type: STRING,
            name: `summary`,
            description: `What happened, in a sentence.`
          }
        ]
      },
      {
        type: SUB_COMMAND,
        name: `idea`,
        description: `Something the bot could do.`,
        options: [
          {
            type: STRING,
            name: `summary`,
            description: `What you would like, in a sentence.`
          }
        ]
      }
    ]
  },
  {
    name: `review`,
    description: `Privately show the last question you got wrong.`
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

const list = (registered) => {
  for (const command of registered) console.log(`  /${command.name}`);
};

if (clearGuild) {
  // Bulk-overwriting with an empty list is the documented way to delete a
  // whole set, and nothing else removes a guild registration.
  await bulkOverwriteGuildApplicationCommands({
    application,
    guild,
    body: []
  });
  console.log(`Cleared the guild registration for ${guild}.`);
  console.log(``);
  console.log(
    `That server now sees the global commands, the same as everyone else.`
  );
} else if (guild && !forceGlobal) {
  const registered = await bulkOverwriteGuildApplicationCommands({
    application,
    guild,
    body: commands
  });
  console.log(`Registered ${registered.length} command(s) to guild ${guild}:`);
  list(registered);
  console.log(``);
  console.log(`This is the development shortcut: it appears immediately, and`);
  console.log(`it SHADOWS the global commands in that one server. Users`);
  console.log(`elsewhere see nothing new until you:`);
  console.log(`  vp run commands:publish       # register globally`);
  console.log(`  vp run commands:clear-guild   # drop this dev copy`);
} else {
  const registered = await bulkOverwriteGlobalApplicationCommands({
    application,
    body: commands
  });
  console.log(`Registered ${registered.length} command(s) globally:`);
  list(registered);
  console.log(``);
  console.log(
    `Every guild that has installed the bot, and every one that installs it later.`
  );
}
