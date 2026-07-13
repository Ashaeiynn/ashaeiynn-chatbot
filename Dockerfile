# Chatbot backend — self-contained image. Node 24 has stable node:sqlite (no flags).
FROM node:24-slim

WORKDIR /app

# Install dependencies first (better layer caching).
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-fund --no-audit

# App code + the prebuilt knowledge base + the embedding model (ships in-repo,
# split into <100MB parts; reassembled here — NO network downloads at build).
COPY server ./server
COPY widget ./widget
COPY pipeline ./pipeline
COPY models ./models
COPY data/knowledge.db ./data/knowledge.db
COPY data/corrections.json* ./data/
COPY data/transcripts ./data/transcripts

RUN cat models/Xenova/multilingual-e5-small/onnx/model_quantized.onnx.part-* \
      > models/Xenova/multilingual-e5-small/onnx/model_quantized.onnx \
  && rm models/Xenova/multilingual-e5-small/onnx/model_quantized.onnx.part-* \
  && node -e "import('./server/embed.mjs').then(m => m.warmup()).then(() => console.log('model OK (offline)'))"

# Secrets (GEMINI_API_KEY / ADMIN_KEY / LIBRARY_KEY / CHAT_PROVIDER …) are
# provided at runtime as environment variables, never baked into the image.
ENV PORT=3111
# Keep the JS heap modest so the whole process stays inside a 512MB instance.
ENV NODE_OPTIONS="--max-old-space-size=384"
EXPOSE 3111

# Simple container healthcheck against the /health route.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3111)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.mjs"]
