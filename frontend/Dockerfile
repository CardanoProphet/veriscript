# build stage
FROM node:18-alpine AS build
WORKDIR /app

# install deps
COPY package*.json ./
RUN npm ci || npm install

# copy app sources
COPY ./src/ ./src/
COPY ./public/ ./public/
COPY eslint.config.js index.html tsconfig.app.json tsconfig.json tsconfig.node.json vite.config.ts ./

# build for production
ARG BUILD_COMMAND="npm run build"
ARG VITE_API_URL
ARG VITE_BLOCKFROST_API_KEY
ARG VITE_CARDANO_NETWORK=preprod
ARG VITE_PROTOCOL_PARAMS_TX_HASH
ARG VITE_PROTOCOL_PARAMS_TX_IX=0
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_BLOCKFROST_API_KEY=$VITE_BLOCKFROST_API_KEY
ENV VITE_CARDANO_NETWORK=$VITE_CARDANO_NETWORK
ENV VITE_PROTOCOL_PARAMS_TX_HASH=$VITE_PROTOCOL_PARAMS_TX_HASH
ENV VITE_PROTOCOL_PARAMS_TX_IX=$VITE_PROTOCOL_PARAMS_TX_IX
RUN $BUILD_COMMAND &&     if [ -d "dist" ]; then mv dist build; fi

# runtime stage
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s   CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
