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
 */

/** The nested option shape Discord sends, narrowed to what is read here. */
export interface InteractionOption {
  name: string;
  value?: string | number | boolean;
  options?: InteractionOption[];
}

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
export const readOptions = (
  options: readonly InteractionOption[] | undefined
): Invocation => {
  const list = options ?? [];
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
  }

  return {
    ...(sub === undefined ? {} : { subcommand: sub.name }),
    options: raw
  };
};
