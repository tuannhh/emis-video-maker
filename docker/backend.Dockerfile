# Image dùng chung cho api và worker (worker cần Chromium của Remotion để render)
FROM node:24-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Thư viện hệ thống cho Chromium headless (Remotion) + font emoji
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
      libpango-1.0-0 libcairo2 fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/video/package.json packages/video/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter "@edu/api..."

COPY packages/shared packages/shared
COPY packages/video packages/video
COPY apps/api apps/api
RUN pnpm --filter @edu/shared build && pnpm --filter @edu/api build

ENV NODE_ENV=production
WORKDIR /app/apps/api

# Tải sẵn Chromium headless shell để lần render đầu không phải chờ. Remotion tìm trình duyệt theo thư mục
# đang chạy (node_modules/.remotion), nên phải tải ở đúng WORKDIR của api/worker.
RUN node -e "require('@remotion/renderer').ensureBrowser().then(() => console.log('Chromium OK'))"
EXPOSE 4100
