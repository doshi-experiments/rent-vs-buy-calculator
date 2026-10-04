# Optional: self-hosting instead of a static host.
# Plain http:// will NOT give you offline install on a phone — put it behind
# Tailscale Serve or a reverse proxy with TLS if you need that.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json doshi-experiments-design-system-0.4.2.tgz ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN chmod +x build.sh && ./build.sh

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
