FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# patch-baileys.js runs as the postinstall hook, so it must exist before `npm ci`.
COPY package*.json patch-baileys.js ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 5001

# Required at runtime:
#   DATABASE_URL            same PostgreSQL database the API uses
#   WHATSAPP_BRIDGE_TOKEN   shared secret (or SECRET_KEY, identical to the API's)
#   FASTAPI_BASE_URL        base URL of the API (for realtime wake-ups)
CMD ["node", "server.js"]
