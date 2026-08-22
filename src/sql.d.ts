/**
 * SQL files imported for their text.
 *
 * Vite inlines `?raw` imports at build time, which is how a test running inside
 * workerd reads a migration: the runtime has no filesystem, and a test that
 * wrote its own schema instead would keep passing after the real migration
 * drifted from it.
 *
 * Declared narrowly rather than by adding `vite/client` to tsconfig's `types`.
 * That would bring the DOM-shaped globals with it, and this project keeps that
 * list minimal on purpose — so a dependency that quietly needs a browser or
 * Node API fails the build instead of shipping.
 */
declare module "*.sql?raw" {
  const content: string;
  export default content;
}
