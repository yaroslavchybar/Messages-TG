FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY python/requirements.txt ./python/requirements.txt
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir -r ./python/requirements.txt

COPY tsconfig.json ./
COPY src ./src
COPY python ./python
COPY convex ./convex

ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1
ENV PATH="/opt/venv/bin:${PATH}"

CMD ["npm", "run", "dev"]
