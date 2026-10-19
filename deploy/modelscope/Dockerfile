FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=7860 ANNA_ROOT=/app ANNA_PUBLIC_DIR=/app/dist/web ANNA_WEB_DATA=/tmp/anna-web-sessions
WORKDIR /app
# bubblewrap + socat: Anna's command sandbox on Linux; procps: ending a visitor's leftover processes.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git ripgrep fd-find bubblewrap socat procps python3 \
  && ln -s /usr/bin/fdfind /usr/local/bin/fd && rm -rf /var/lib/apt/lists/*
# The agents Anna delegates to. Each visitor gets a fresh HOME, so they start without any login.
RUN npm install -g @openai/codex@0.160.0 @anthropic-ai/claude-code@2.1.302 && npm cache clean --force
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY dist ./dist
COPY LICENSE NOTICE.md COMMERCIAL.md ./
EXPOSE 7860
# Runs as root only to start each visitor's Anna under its own Unix user (uid 20001+); the ModelScope key stays here.
CMD ["node", "dist/web-server.js"]
