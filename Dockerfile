# ============================================================================
#  LakStay — Docker image (production-ready)
#  Dùng node bookworm-slim (glibc) để better-sqlite3 có prebuilt binary,
#  không cần trình biên dịch trong image.
# ============================================================================
FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# Cài dependency trước để tận dụng cache layer
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# Copy mã nguồn + tài nguyên (font cho PDF, ảnh, frontend)
COPY src ./src
COPY db ./db
COPY public ./public
COPY README.md ./

# Chạy user không root
RUN mkdir -p /app/src/data && chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
