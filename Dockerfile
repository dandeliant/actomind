# ActoMind – PWA + Google Cloud TTS backend (no npm dependencies)
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY index.html manifest.webmanifest sw.js ./
COPY css ./css
COPY js ./js
COPY vendor ./vendor
COPY icons ./icons
COPY server ./server
COPY tools ./tools
RUN node tools/gen-sw-manifest.mjs && mkdir -p server/.cache && chown -R node:node /app
USER node
ENV PORT=8080 HOST=0.0.0.0
EXPOSE 8080
CMD ["node", "server/server.js"]
