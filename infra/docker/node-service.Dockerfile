# infra/docker/node-service.Dockerfile
FROM node:22-bookworm
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages ./packages
COPY services ./services
COPY apps ./apps
RUN npm install
CMD ["npm", "run", "build"]
