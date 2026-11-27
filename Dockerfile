# Inferxe Unified Backend Image (Node 24 + Python 3 FastAPI)
FROM node:24-bookworm-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    PORT=10000

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 \
      python3-venv \
      python3-pip \
      ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create isolated Python virtual environment and install backend dependencies
COPY backend/requirements.txt ./backend/requirements.txt
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --upgrade pip && \
    /opt/venv/bin/pip install --no-cache-dir -r backend/requirements.txt

ENV PATH="/opt/venv/bin:$PATH" \
    INFERXE_PYTHON="/opt/venv/bin/python"

# Install backend Node.js dependencies
COPY backend/package.json ./backend/package.json
RUN npm --prefix /app/backend install --omit=dev

# Copy backend services and knowledge base datasets
COPY backend ./backend
COPY database ./database

EXPOSE 10000

CMD ["node", "backend/scripts/render-gateway.mjs"]
