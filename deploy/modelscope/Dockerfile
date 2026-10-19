FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=7860 ANNA_ROOT=/app ANNA_PUBLIC_DIR=/app/dist/web ANNA_WEB_DATA=/tmp/anna-web-sessions
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git ripgrep fd-find && ln -s /usr/bin/fdfind /usr/local/bin/fd && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY dist ./dist
COPY LICENSE NOTICE.md COMMERCIAL.md ./
USER node
EXPOSE 7860
CMD ["node", "dist/web-server.js"]
