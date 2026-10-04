# Media Render — the Cloudflare Container behind MediaRenderContainerDO.
# A small Node HTTP server (server.mjs) that the DO proxies POST /render to: it
# downloads each clip of a canvas video timeline, composites them with ffmpeg
# (visual track, captions, every audio track mixed) and answers with the MP4.
# Self-contained, no build step, no npm dependencies — mirrors api/stage-sandbox.
FROM node:24-bookworm-slim

# ffmpeg for the render; DejaVu so `drawtext` captions have a font.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json server.mjs ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.mjs"]
