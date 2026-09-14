# Use Node.js as base image
FROM node:20-slim AS base
WORKDIR /app
RUN npm install -g pnpm

# Install dependencies
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
RUN pnpm install

# Copy all source files
COPY . .

# Build the project
RUN pnpm run build

# Expose the port
EXPOSE 2567

# تحديث المسار ليشير للمكان الذي سيتم بناء الملف فيه
# غالباً يكون في dist/index.js أو server/dist/index.js
CMD ["node", "dist/index.js"] 
