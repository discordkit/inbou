/**
 * Wallaby watches the pure half of the test suite.
 *
 * It cannot watch the other half, and that is structural rather than a
 * misconfiguration. Wallaby instruments each file with a `$_$wp` coverage probe
 * and expects it in the same runtime scope; the Cloudflare Vitest pool ships
 * modules across a process boundary into workerd, where that global does not
 * exist. Pointed at the whole suite it fails every file at line 1 with
 * "$_$wp is not defined".
 *
 * The two Durable Object specs are excluded here. They run under `vp test`,
 * which executes both Vitest projects.
 */

/** The specs that need workerd, mirroring `WORKERD_TESTS` in vite.config.ts. */
const WORKERD_TESTS = [
  `!src/handlers/__tests__/session.spec.ts`,
  `!src/__tests__/worker.spec.ts`
];

export default function wallaby() {
  return {
    autoDetect: [`vitest`],
    tests: {
      override: (patterns) => [...patterns, ...WORKERD_TESTS]
    },
    files: {
      override: (patterns) => [
        ...patterns,
        // The corpus is 1.8 MB of generated JSON that never changes between
        // runs. Instrumenting it wastes time on every keystroke elsewhere.
        { pattern: `src/handlers/quiz/corpus.json`, instrument: false }
      ]
    }
  };
}
