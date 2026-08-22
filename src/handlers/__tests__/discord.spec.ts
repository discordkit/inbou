import { discord as client } from "@discordkit/client";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { discordEffects } from "../discord.js";
import type { Embed } from "../quiz/render.js";
import { questionButtons } from "../quiz/render.js";

/**
 * The one layer that really talks to Discord.
 *
 * Everything else depends on the `DiscordEffects` interface and is tested with
 * a recording stub. This module is the implementation behind that interface, so
 * the only way to test it honestly is to let it make its requests and intercept
 * them — which is what MSW is for. Stubbing `fetch` by hand would test the stub;
 * intercepting at the network layer tests the request the client actually
 * builds, including the route and the body.
 *
 * The failure paths matter more than the happy ones here. A 403 on a reaction
 * must not abandon the round, and that is a property no amount of type checking
 * can establish.
 */

const API = `https://discord.com/api/v10`;

/** Requests the server saw, so a test can assert on what was sent. */
const seen: { method: string; url: string; body?: unknown }[] = [];

const server = setupServer(
  http.post(
    `${API}/channels/:channel/messages`,
    async ({ request, params }) => {
      seen.push({
        method: `POST`,
        url: `/channels/${String(params.channel)}/messages`,
        body: await request.json()
      });
      return HttpResponse.json({ id: `posted-1` });
    }
  ),
  http.post(
    `${API}/interactions/:interaction/:token/callback`,
    async ({ request, params }) => {
      seen.push({
        method: `POST`,
        url: `/interactions/${String(params.interaction)}/callback`,
        body: await request.json()
      });
      return new HttpResponse(null, { status: 204 });
    }
  ),
  http.put(
    `${API}/channels/:channel/messages/:message/reactions/:emoji/@me`,
    ({ request, params }) => {
      seen.push({
        method: `PUT`,
        // The raw URL, not the decoded param: what goes over the wire is the
        // point, and MSW decodes `params` for convenience.
        url: new URL(request.url).pathname,
        body: String(params.emoji)
      });
      return new HttpResponse(null, { status: 204 });
    }
  )
);

const embed: Embed = { title: `Question 1`, description: `## うります` };

describe(`the Discord effects layer`, () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: `error` });
    client.setToken(`Bot test-token`);
  });
  afterEach(() => {
    server.resetHandlers();
    seen.length = 0;
  });
  afterAll(() => {
    server.close();
  });

  describe(`posting`, () => {
    it(`sends the embed to the channel and returns the message id`, async () => {
      // WHY: the returned id is what a reaction is later attached to. Losing it
      // would mean guesses could never be marked.
      const id = await discordEffects.post(`chan-1`, embed);

      expect(id).toBe(`posted-1`);
      expect(seen[0]?.url).toBe(`/channels/chan-1/messages`);
      expect(seen[0]?.body).toMatchObject({
        embeds: [{ title: `Question 1` }]
      });
    });

    it(`sends components alongside the embed`, async () => {
      // WHY: the buttons are only useful if they reach Discord in the shape it
      // accepts. This asserts on the request body rather than the object we
      // built, which is the part a schema mismatch would break.
      await discordEffects.post(`chan-1`, embed, questionButtons());

      expect(seen[0]?.body).toMatchObject({
        components: [{ type: 1, components: [{ type: 2 }, { type: 2 }] }]
      });
    });

    it(`omits components when there are none`, async () => {
      // WHY: an empty `components` array replaces whatever was there, so sending
      // one on a reveal would strip the buttons off nothing and add noise.
      await discordEffects.post(`chan-1`, embed);
      expect(seen[0]?.body).not.toHaveProperty(`components`);
    });

    it(`returns null rather than throwing when Discord refuses`, async () => {
      // WHY: a failed post must not abandon the session. The caller checks for
      // null; an exception would unwind the whole round.
      server.use(
        http.post(`${API}/channels/:channel/messages`, () =>
          HttpResponse.json({ message: `Missing Permissions` }, { status: 403 })
        )
      );

      await expect(discordEffects.post(`chan-1`, embed)).resolves.toBeNull();
    });
  });

  describe(`reacting`, () => {
    it(`url-encodes the emoji into the route`, async () => {
      // WHY: Discord takes the emoji in the URL, and ❌ is not URL-safe. An
      // unencoded character produces a 404 and every wrong guess goes unmarked —
      // silently, since a failed reaction is only logged.
      await discordEffects.react(`chan-1`, `msg-1`, `❌`);

      expect(seen[0]?.method).toBe(`PUT`);
      // Percent-encoded on the wire...
      expect(seen[0]?.url).toContain(encodeURIComponent(`❌`));
      // ...and decoding it server-side gives the emoji back, which is what
      // Discord matches on. Both halves matter: an unencoded character 404s, and
      // a double-encoded one reaches Discord as literal percent escapes.
      expect(seen[0]?.body).toBe(`❌`);
    });

    it(`does not throw when the reaction is refused`, async () => {
      // WHY: the round matters more than the emoji. A bot that threw here would
      // lose the question it was in the middle of running because it could not
      // add a decoration.
      server.use(
        http.put(
          `${API}/channels/:channel/messages/:message/reactions/:emoji/@me`,
          () =>
            HttpResponse.json(
              { message: `Missing Permissions` },
              { status: 403 }
            )
        )
      );

      await expect(
        discordEffects.react(`chan-1`, `msg-1`, `❌`)
      ).resolves.toBeUndefined();
    });
  });

  describe(`plain text`, () => {
    it(`posts content without an embed`, async () => {
      // WHY: `say` is what reports a filter that matched nothing, so a player
      // who mistyped their level learns why nothing happened. Sending it as an
      // embed would be heavier than the message deserves.
      const id = await discordEffects.say(`chan-1`, `No words match that.`);

      expect(id).toBe(`posted-1`);
      expect(seen[0]?.body).toEqual({ content: `No words match that.` });
    });

    it(`returns null rather than throwing when refused`, async () => {
      // WHY: same contract as `post`. A failed notice must not abandon the
      // round it was reporting on.
      server.use(
        http.post(`${API}/channels/:channel/messages`, () =>
          HttpResponse.json({ message: `Missing Access` }, { status: 403 })
        )
      );

      await expect(discordEffects.say(`chan-1`, `hello`)).resolves.toBeNull();
    });
  });

  describe(`replying to an interaction`, () => {
    const interaction = {
      id: `interaction-1`,
      token: `tok`
    } as unknown as Parameters<typeof discordEffects.reply>[0];

    it(`marks a reply ephemeral, which is what makes /hint private`, async () => {
      // WHY: the ephemeral flag is the only reason `/hint` and `/review` work
      // at all — Discord offers no other way to answer one person in a busy
      // channel. Losing the flag would broadcast the answer to everyone
      // racing, and nothing else in the system would notice.
      await discordEffects.reply(interaction, {
        content: `A hint`,
        ephemeral: true
      });

      const body = seen[0]?.body as { data?: { flags?: number } };
      expect(body.data?.flags).toBe(64);
    });

    it(`omits the flag when the reply is public`, async () => {
      // WHY: the counterpart. Always setting it would make every reply
      // invisible to the channel, including ones meant to be seen.
      await discordEffects.reply(interaction, { content: `Session ended.` });

      const body = seen[0]?.body as { data?: { flags?: number } };
      expect(body.data?.flags).toBeUndefined();
    });

    it(`sends an embed when given one`, async () => {
      // WHY: `/review` and `/hint` reply with an embed rather than text, so a
      // reply that dropped it would answer with an empty message.
      await discordEffects.reply(interaction, { embed, ephemeral: true });

      const body = seen[0]?.body as { data?: { embeds?: unknown[] } };
      expect(body.data?.embeds).toHaveLength(1);
    });

    it(`does not throw when the interaction has already expired`, async () => {
      // WHY: an interaction token is valid for three seconds. A slow session
      // read can miss that window, and the round must continue regardless.
      server.use(
        http.post(`${API}/interactions/:interaction/:token/callback`, () =>
          HttpResponse.json({ message: `Unknown interaction` }, { status: 404 })
        )
      );

      await expect(
        discordEffects.reply(interaction, { content: `late` })
      ).resolves.toBeUndefined();
    });
  });
});
