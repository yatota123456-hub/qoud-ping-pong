FROM oven/bun:1
WORKDIR /app

# انسخ ملفات الحزم فقط أولاً للكاش
COPY package.json bun.lock* pnpm-lock.yaml* pnpm-workspace.yaml* .npmrc* ./

# ثبت - يشتغل مع bun أو pnpm
RUN bun install

# انسخ باقي المشروع
COPY . .

# ابنِ الواجهة - يخرج إلى dist/public حسب vite.config.ts
RUN bun run build

EXPOSE 2567
ENV NODE_ENV=production
ENV PORT=2567

CMD ["bun", "run", "start"]
