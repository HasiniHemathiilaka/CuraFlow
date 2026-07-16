
FROM node:20-alpine

WORKDIR /app

# Copy package management files first for better caching
COPY package*.json ./

RUN npm ci --only=production

# Copy application source code
COPY . .

EXPOSE 5000

CMD ["node", "server.js"]