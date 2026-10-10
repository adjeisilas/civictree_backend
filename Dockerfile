# Dockerfile to build the express backend
#
# Notes:
# - The database schema is NOT changed during the build. Applying schema changes at build
#   time (previously `prisma db push --accept-data-loss`) can destroy production data.
#   Run `npm run db:backup` then `npm run db:deploy` as deliberate release steps.
# - Runs as the unprivileged `node` user.

# ---- Build stage: install everything and generate the Prisma client ----------
FROM node:22.12-alpine AS build

RUN npm install -g pnpm@9

WORKDIR /civictree_backend

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

# Generate the Prisma client and the Swagger document (no database connection needed)
RUN npx prisma generate --schema=prisma/schema.prisma \
 && node swagger.js

# ---- Runtime stage: production dependencies only -----------------------------
FROM node:22.12-alpine AS runtime

RUN npm install -g pnpm@9

ENV NODE_ENV=production

WORKDIR /civictree_backend

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts \
 && pnpm store prune

# Application code, plus the artefacts generated in the build stage
COPY --chown=node:node . .
COPY --from=build --chown=node:node /civictree_backend/generated ./generated
COPY --from=build --chown=node:node /civictree_backend/swagger-output.json ./swagger-output.json

USER node

EXPOSE 5000

CMD ["node", "server.js"]
