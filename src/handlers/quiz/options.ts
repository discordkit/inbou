import * as v from "valibot";
import type { RawOptions } from "./config.js";

/**
 * Reading options out of a slash-command interaction.
 *
 * Discord nests them: a subcommand is itself an option carrying the real ones
 * underneath, so `/quiz start level:N5` arrives as an option named `start`
 * whose own `options` hold `level`. Flattening that here keeps the shape out of
 * the command handler and, more usefully, makes it testable — an interaction
 * payload is tedious to construct, and the nesting is exactly where a mistake
 * silently drops every option a player typed.
 *
 * This is the one place the bot reads data it did not construct, so the shape
 * is checked rather than asserted. A cast would compile against a payload that
 * had drifted and then read `undefined` from it, which surfaces as a command
 * that quietly runs with defaults.
 */

/** The nested option shape Discord sends, narrowed to what is read here. */
export interface InteractionOption {
  name: string;
  value?: string | number | boolean;
  options?: InteractionOption[];
}

/**
 * The same shape, as a schema.
 *
 * Recursive via `v.lazy`, because a subcommand's options are options. Only the
 * fields this module reads are described — Discord sends more, and demanding a
 * complete model would fail on additions that do not concern the quiz.
 */
export const interactionOptionSchema: v.GenericSchema<InteractionOption> =
  v.object({
    name: v.string(),
    value: v.optional(v.union([v.string(), v.number(), v.boolean()])),
    options: v.optional(v.array(v.lazy(() => interactionOptionSchema)))
  });

/** The subcommand invoked, and the options belonging to it. */
export interface Invocation {
  /** Absent when the command takes no subcommand, like `/hint`. */
  subcommand?: string;
  options: RawOptions;
}

/**
 * A subcommand carries its options in a nested list rather than a value.
 *
 * Discord marks these with type 1 (SUB_COMMAND) and 2 (SUB_COMMAND_GROUP), but
 * the shape is enough to tell them apart: a real option has a value, a
 * subcommand has children. Reading the shape rather than the enum keeps this
 * independent of how the client models the type.
 */
const isSubcommand = (option: InteractionOption): boolean =>
  option.value === undefined;

/**
 * Flatten an interaction's options into strings.
 *
 * Everything becomes a string because {@link parseSettings} does the real
 * parsing — Discord's own types would let `length` arrive as a number, and
 * having two paths into the same validation is how they drift apart.
 */
export const readOptions = (options: unknown): Invocation => {
  // Validated rather than cast: this is data Discord sent, not data the bot
  // built. A payload that failed the shape reads as a command with no options,
  // which is the same as someone typing `/quiz start` — a safe default rather
  // than a crash mid-interaction.
  const parsed = v.safeParse(v.array(interactionOptionSchema), options ?? []);
  const list = parsed.success ? parsed.output : [];
  const sub = list.find(isSubcommand);
  const own = sub === undefined ? list : (sub.options ?? []);

  const raw: RawOptions = {};
  for (const option of own) {
    if (option.value === undefined) continue;
    const value = String(option.value);
    // Only the options the quiz understands. An unknown one is ignored rather
    // than rejected: Discord validates names against what was registered, so an
    // unexpected name means the registered set and this code have drifted, and
    // failing the command over it would be worse than running with defaults.
    if (option.name === `level`) raw.level = value;
    else if (option.name === `type`) raw.type = value;
    else if (option.name === `class`) raw.class = value;
    else if (option.name === `forms`) raw.forms = value;
    else if (option.name === `length`) raw.length = value;
    else if (option.name === `timeout`) raw.timeout = value;
    else if (option.name === `guesses`) raw.guesses = value;
  }

  return {
    ...(sub === undefined ? {} : { subcommand: sub.name }),
    options: raw
  };
};

/**
 * The `user` option on `/quiz scores`, if one was given.
 *
 * Read separately rather than added to {@link readOptions}, which maps only the
 * options that configure a session — widening it would mean every settings
 * parse had to ignore a field that is not a setting. A Discord USER option
 * arrives as a snowflake string, and the id is all the leaderboard needs, so
 * the `resolved` map alongside it can stay unread.
 */
export const readUserOption = (options: unknown): string | null => {
  const parsed = v.safeParse(v.array(interactionOptionSchema), options ?? []);
  if (!parsed.success) return null;
  const sub = parsed.output.find(isSubcommand);
  const own = sub === undefined ? parsed.output : (sub.options ?? []);
  const user = own.find((option) => option.name === `user`);
  return user?.value === undefined ? null : String(user.value);
};

/**
 * The custom id a component interaction carries.
 *
 * `interaction.data` is a union — an application command has `name` and
 * `options`, a component has `customId` — so reading one arm without checking
 * is how a drifted payload becomes a button that silently routes nowhere.
 * Returns null when the shape is not a component's, which the caller reports.
 */
export const readCustomId = (data: unknown): string | null => {
  const parsed = v.safeParse(v.object({ customId: v.string() }), data);
  return parsed.success ? parsed.output.customId : null;
};
