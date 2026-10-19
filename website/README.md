# Anna website

The landing page at https://anna.mayuanyuan.top: a product introduction, the install commands and optional coffee support.
It's a small Vue page built with Vite. The payment QR images come from the project owner and are unchanged.

## Develop

```bash
pnpm dev:website       # local preview
pnpm build:website     # build into website/dist
```

## Deploy

Run `pnpm deploy:website`. It builds the site and deploys it with Wrangler; the first run opens a browser to log in to Cloudflare.

`website/public/install.sh` and `install.ps1` are served from the site root. They read `latest.json`, which the release
workflow generates from the GitHub release of this repository; copy it to the site before deploying a new version.

The in-app updater installs only a `latest.json` signed with the release key. The release workflow writes it unsigned;
once its assets are final (the local mac zip's sha256 included), sign it on the release machine before deploying:

```sh
node scripts/sign-manifest.mjs website/public/latest.json   # key: ~/.config/anna/release-signing.pem
```

The key was created once with `node scripts/release-keygen.mjs`; its public half is `releasePublicKey` in
`packages/shared/update.ts`. Keep a backup of the private key: without it no update can be published.
