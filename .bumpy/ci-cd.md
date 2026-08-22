---
inbou: minor
---

Release automation and Cloudflare deployment.

Merging a PR with a bump file opens a version PR; merging that tags a release
and deploys. Deployment builds with Vite (not wrangler's own bundler, which
would apply neither the `?raw` SQL import nor the `__BUILD__` define), applies
D1 migrations, deploys the handlers Worker before the bot Worker as the service
binding requires, and registers slash commands last so Discord never offers a
command the running code cannot answer.
