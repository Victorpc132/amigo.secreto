# Receita para empacotar o site. Funciona em Render, Railway, Fly.io ou qualquer servidor com Docker.
FROM oven/bun:1-alpine

WORKDIR /app

# Instala o driver PostgreSQL usado quando DATABASE_URL está configurada.
COPY package.json ./
COPY bun.lock ./
RUN bun install --production --frozen-lockfile
COPY src ./src
COPY public ./public

# DATA_DIR é usado pelo SQLite local; com DATABASE_URL, os dados ficam no PostgreSQL externo.
# TRUST_PROXY=true porque as hospedagens colocam um "porteiro" (proxy) na frente do site.
ENV PORT=3000 \
    DATA_DIR=/data \
    TRUST_PROXY=true

# (Roda como root de propósito: discos persistentes de hospedagem costumam
# vir montados como root e o usuário comum não conseguiria gravar neles.)
RUN mkdir -p /data
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["bun", "src/server.ts"]
