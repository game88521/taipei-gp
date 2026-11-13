FROM node:24-alpine
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server/index.mjs server/room-service.mjs server/physics.mjs ./
COPY shared/multiplayer-protocol.ts shared/multiplayer-catalog.json /app/shared/
COPY src/data/track.json /app/src/data/
COPY public/data/circuits/ /app/public/data/circuits/
ENV HOST=0.0.0.0 PORT=4320
EXPOSE 4320
USER node
CMD ["node", "index.mjs"]
