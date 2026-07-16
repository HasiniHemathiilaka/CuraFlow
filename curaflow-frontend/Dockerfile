# Stage 1: Build React/Vite assets
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Serve production assets via Nginx
FROM nginx:stable-alpine

# Copy compiled assets from Vite's output directory (dist)
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]