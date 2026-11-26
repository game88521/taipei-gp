FROM node:24-alpine
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server/index.mjs server/room-service.mjs server/physics.mjs server/series-checkpoint.mjs server/horizon-service.mjs server/nexus-coop-service.mjs server/nexus-replay-service.mjs server/nexus-arena-service.mjs ./
COPY server/summit-racing-service.mjs server/summit-events-service.mjs ./
COPY server/atlas-runtime.mjs server/atlas-racing-service.mjs server/voyager-racing-service.mjs server/odyssey-racing-service.mjs server/odyssey-diagnostics.mjs ./
COPY server/expedition-racing-service.mjs server/expedition-social-service.mjs server/expedition-duty-service.mjs ./
COPY server/frontier-city-replay-service.mjs ./
COPY server/frontier-convoy-service.mjs ./
COPY server/frontier-rally-service.mjs ./
COPY shared/multiplayer-protocol.ts shared/multiplayer-series.ts shared/multiplayer-room-rules.ts shared/multiplayer-evolution.ts shared/multiplayer-horizon.ts shared/multiplayer-tracks.ts shared/circuit-catalog.ts shared/multiplayer-track-fingerprint.ts shared/multiplayer-catalog.json /app/shared/
COPY shared/nexus-coop.ts shared/nexus-coop-city.json shared/nexus-replay.ts shared/multiplayer-arena.ts /app/shared/
COPY shared/summit-racing.ts /app/shared/
COPY shared/atlas-racing.ts shared/voyager-racing.ts shared/odyssey-racing.ts shared/odyssey-coop.ts /app/shared/
COPY shared/expedition-racing.ts shared/expedition-social.ts shared/expedition-duty.ts /app/shared/
COPY shared/frontier-city-replay.ts /app/shared/
COPY shared/frontier-city-resume.ts /app/shared/
COPY shared/frontier-convoy.ts /app/shared/
COPY shared/frontier-rally.ts shared/frontier-duty-missions.ts /app/shared/
COPY server/aurora-social-service.mjs server/aurora-duty-service.mjs ./
COPY shared/aurora-social.ts shared/aurora-duty.ts /app/shared/
COPY src/data/track.json /app/src/data/
COPY public/data/circuits/*.json /app/public/data/circuits/
COPY server/summit-city-race-service.mjs server/summit-city-physics.mjs ./
COPY shared/summit-city-race.ts /app/shared/
COPY public/data/city.json /app/public/data/
COPY public/data/tiles/ /app/public/data/tiles/
ENV HOST=0.0.0.0 PORT=4320
EXPOSE 4320
USER node
CMD ["node", "index.mjs"]

COPY server/frontier-crown-service.mjs ./
COPY shared/frontier-crown.ts /app/shared/
COPY server/frontier-cup-service.mjs ./
COPY shared/frontier-cup.ts /app/shared/

COPY server/meridian-*.mjs ./
COPY shared/meridian-*.ts /app/shared/
COPY server/harbor-network-pause-service.mjs ./
COPY shared/harbor-network-pause.ts /app/shared/
COPY server/lantern-ctf-service.mjs ./
COPY shared/lantern-ctf.ts /app/shared/
