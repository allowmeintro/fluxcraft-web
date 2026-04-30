# ==================== BUILD STAGE ====================
FROM mirror.gcr.io/library/node:20-alpine AS base

RUN apk add --no-cache python3 make g++ sqlite sqlite-dev

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install --no-audit --no-fund --legacy-peer-deps

COPY . .

RUN npx prisma generate
RUN npm run build

# ==================== PRODUCTION STAGE ====================
FROM mirror.gcr.io/library/node:20-alpine AS runner

RUN apk add --no-cache sqlite

WORKDIR /app

ENV NODE_ENV=production

COPY --from=base /app/.next ./.next
COPY --from=base /app/public ./public
COPY --from=base /app/package*.json ./
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/node_modules ./node_modules

EXPOSE 3000

CMD ["npm", "start"]