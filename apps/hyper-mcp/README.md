# my-hyper-app

A Hyper app. The framework source lives under `src/hyper/<component>/` —
managed by the `hyper` CLI.

## Develop

```bash
bun install
bun run dev
```

## Manage components

The `hyper` CLI is a devDependency. Run it via `bunx` or `bun run`:

```bash
bunx hyper list            # browse the registry
bunx hyper add cors        # add a component
bunx hyper diff log        # inspect drift on an installed component
bunx hyper update          # pull the latest registry versions
```
