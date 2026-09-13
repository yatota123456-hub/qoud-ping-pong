# Use Node.js as base image
FROM node:20-slim AS base
WORKDIR /app
RUN npm install -g pnpm

# Install dependencies based on root files
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
RUN pnpm install

# Copy source files
COPY . .

# Build the project
RUN pnpm run build

# Start the server
EXPOSE 2567
CMD ["node", "server/dist/index.js"]
