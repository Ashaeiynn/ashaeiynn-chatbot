# Chatbot backend — self-contained image. Node 24 has stable node:sqlite (no flags).
FROM node:24-slim

WORKDIR /app

# Install dependencies first (better layer caching).
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-fund --no-audit

# App code + the prebuilt knowledge base.
COPY server ./server
COPY widget ./widget
COPY data/knowledge.db ./data/knowledge.db

# Bake the embedding model into the image so it doesn't download on first request.
RUN node -e "import('./server/embed.mjs').then(m => m.warmup()).then(() => console.log('model cached'))"

# ANTHROPIC_API_KEY / CHAT_MODEL / ALLOWED_ORIGIN are provided at runtime, never baked in.
ENV PORT=3111
EXPOSE 3111

# Simple container healthcheck against the /health route.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3111)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.mjs"]
