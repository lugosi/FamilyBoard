FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV APP_PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# castv2 in bundled Next runtime can try to read an absolute /ROOT path for cast_channel.proto.
# Provide that compatibility path in the container filesystem.
RUN mkdir -p /ROOT/node_modules/castv2/lib
COPY --from=builder /app/node_modules/castv2/lib/cast_channel.proto /ROOT/node_modules/castv2/lib/cast_channel.proto
RUN chown -R nextjs:nodejs /ROOT

USER nextjs
EXPOSE 3000
CMD ["sh", "-c", "PORT=${APP_PORT:-${PORT:-3000}} HOSTNAME=${HOSTNAME:-0.0.0.0} node server.js"]
