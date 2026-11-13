FROM node:24-alpine
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server/index.mjs server/room-service.mjs server/physics.mjs ./
COPY shared/multiplayer-protocol.ts shared/taipei-track.json /app/shared/
ENV HOST=0.0.0.0 PORT=4320
EXPOSE 4320
USER node
CMD ["node", "index.mjs"]
