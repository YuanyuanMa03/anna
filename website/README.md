# Anna website

The landing page at https://anna.mayuanyuan.top: a product introduction, the install commands and the live demo.
It's a small Vue page built with Vite. The sponsor module and its payment QR images were removed on purpose; do not
bring them back without the owner asking.

## Develop

```bash
pnpm dev:website       # local preview
pnpm build:website     # build into website/dist
```

## Media

`anna-live.mp4` (with `anna-live-poster.webp`) and the panel stills (`voice-answer`, `provider-tiles`,
`install-guide`, `memory-together`) are recorded from the real app by `node scripts/website-media.mjs`: a scripted
brain and fake speech endpoints drive a real desktop session, so no real model or key is involved. Re-run it when
the panels or the voice flow change. `ffmpeg` and `cwebp` must be on PATH.

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
