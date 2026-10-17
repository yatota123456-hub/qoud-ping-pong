FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock* pnpm-lock.yaml* pnpm-workspace.yaml* .npmrc* ./
RUN bun install
COPY . .
RUN bun run build
EXPOSE 2567
ENV NODE_ENV=production
ENV PORT=2567
CMD ["bun", "run", "start"]