import * as v from "valibot";
import type { RawOptions } from "./config.js";

/**
 * Reading options out of a slash-command interaction.
 *
 * Discord nests them: `/quiz start level:N5` arrives as an option named `start`
 * whose own `options` hold `level`. Everything here is data the bot did not
 * construct, so it is parsed rather than cast — a payload that has drifted
 * would otherwise read as `undefined` and run the command with defaults.
 */

export interface InteractionOption {
  name: string;
  value?: string | number | boolean;
  options?: InteractionOption[];
}

/** Only the fields read here; Discord sends more, and additions are not errors. */
export const interactionOptionSchema: v.GenericSchema<InteractionOption> =
  v.object({
    name: v.string(),
    value: v.optional(v.union([v.string(), v.number(), v.boolean()])),
    options: v.optional(v.array(v.lazy(() => interactionOptionSchema)))
  });

export interface Invocation {
  /** Absent when the command takes no subcommand, like `/hint`. */
  subcommand?: string;
  options: RawOptions;
}

/** Discord sends a subcommand as an option with children rather than a value. */
const isSubcommand = (option: InteractionOption): boolean =>
  option.value === undefined;

/**
 * The subcommand and the options belonging to it.
 *
 * A failed parse reads as a command with no options — the same as typing
 * `/quiz start` bare, rather than a crash mid-interaction.
 */
const invocationOf = (
  options: unknown
): { subcommand?: string; own: InteractionOption[] } => {
  const parsed = v.safeParse(v.array(interactionOptionSchema), options ?? []);
  const list = parsed.success ? parsed.output : [];
  const sub = list.find(isSubcommand);
  return {
    ...(sub === undefined ? {} : { subcommand: sub.name }),
    own: sub === undefined ? list : (sub.options ?? [])
  };
};

/** The options `parseSettings` understands. An unregistered name cannot reach here. */
const SETTINGS = [
  `level`,
  `type`,
  `class`,
  `forms`,
  `length`,
  `timeout`,
  `guesses`
] as const satisfies ReadonlyArray<keyof RawOptions>;

const isSetting = (name: string): name is keyof RawOptions =>
  (SETTINGS as readonly string[]).includes(name);

/**
 * Flatten an interaction's options into strings.
 *
 * Everything becomes a string so `parseSettings` is the only parser — Discord's
 * own types would let `length` arrive as a number, and two paths into one
 * validation is how they drift apart.
 */
export const readOptions = (options: unknown): Invocation => {
  const { subcommand, own } = invocationOf(options);
  const raw: RawOptions = {};
  for (const option of own) {
    if (option.value !== undefined && isSetting(option.name)) {
      raw[option.name] = String(option.value);
    }
  }
  return { ...(subcommand === undefined ? {} : { subcommand }), options: raw };
};

/** The `user` option on `/quiz scores`. A Discord USER option is a snowflake string. */
export const readUserOption = (options: unknown): string | null => {
  const user = invocationOf(options).own.find(
    (option) => option.name === `user`
  );
  return user?.value === undefined ? null : String(user.value);
};

/**
 * Who invoked an interaction.
 *
 * Discord puts this in `member.user` inside a guild and `user` in a DM.
 * Reading only one works everywhere it was tested and nowhere else.
 */
export const readInvoker = (interaction: unknown): string | null => {
  const parsed = v.safeParse(
    v.object({
      member: v.optional(
        v.object({ user: v.optional(v.object({ id: v.string() })) })
      ),
      user: v.optional(v.object({ id: v.string() }))
    }),
    interaction
  );
  if (!parsed.success) return null;
  return parsed.output.member?.user?.id ?? parsed.output.user?.id ?? null;
};

/**
 * The custom id a component interaction carries.
 *
 * `interaction.data` is a union — an application command has `name`, a
 * component has `customId` — so reading one arm unchecked is how a drifted
 * payload becomes a button that routes nowhere.
 */
export const readCustomId = (data: unknown): string | null => {
  const parsed = v.safeParse(v.object({ customId: v.string() }), data);
  return parsed.success ? parsed.output.customId : null;
};
