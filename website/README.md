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
