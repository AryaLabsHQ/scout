# Contributing to Scout

Thanks for helping out. This page covers what you need to send a change; the engineering detail
lives in the `AGENTS.md` files and `docs/`.

## Setup

Install Bun at the version in `package.json`'s `packageManager`, then:

```bash
bun install
```

The README's [Typical Local Flow](./README.md#typical-local-flow) runs the hub and dashboard
locally. The [E2E lab](./e2e/README.md) adds disposable Docker nodes when you need real agents.

## Checks

CI runs these on every pull request. Run them before you push:

```bash
bun run format:check   # `bun run format` fixes it
bun run lint
bun run typecheck
bun run test
bun run --cwd apps/web build
```

Add or update tests with behavior changes. The E2E lab is not part of CI; mention in the pull
request if you exercised a change there.

## Pull requests

- Keep each pull request to one coherent change, split into reviewable commits.
- Write commit messages and pull request titles as
  [Conventional Commits](https://www.conventionalcommits.org/), for example
  `feat(plugin-systemd): ...` or `fix(hub): ...`.
- Say what changed, why, and how you verified it.
- Update the nearest `AGENTS.md` or doc when you change a convention, contract, or command it
  describes.

## Where things live

- [`AGENTS.md`](./AGENTS.md) maps the repo; each app and package has its own `AGENTS.md`.
- [`docs/architecture.md`](./docs/architecture.md) covers the whole system.
- [`docs/plugins/`](./docs/plugins/README.md) covers writing a plugin.
- Cross-runtime contracts belong in `packages/shared` or a plugin's `contracts.ts`, not in apps.

## Deployment config

Scout stays deployment-agnostic. [`deploy/`](./deploy/README.md) holds a generic self-hosting kit
with placeholder names. Keep host names, domains, tokens, and other site-specific configuration in
your own infrastructure repository, not in Scout.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).
