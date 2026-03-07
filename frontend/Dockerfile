FROM node:20-bullseye

WORKDIR /app
COPY . .

RUN npm install
RUN npm install @cloudflare/next-on-pages --force
RUN npx @cloudflare/next-on-pages
RUN npm install -g wrangler

CMD ["wrangler", "deploy"]
