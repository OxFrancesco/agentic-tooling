FROM node:20-slim

SHELL ["/bin/bash", "-euo", "pipefail", "-c"]

# Base deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    unzip \
    python3 \
    python3-pip \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Install bun
RUN curl -fsSL --retry 3 --retry-delay 2 https://bun.sh/install | bash \
  && /root/.bun/bin/bun --version
ENV PATH="/root/.bun/bin:$PATH"

# Install uv
RUN curl -fsSL --retry 3 --retry-delay 2 https://astral.sh/uv/install.sh | sh \
  && /root/.local/bin/uv --version
ENV PATH="/root/.local/bin:$PATH"

# Install opencode and preconfigure permissions
RUN npm install -g opencode-ai \
  && opencode --help >/dev/null \
  && mkdir -p /root/.config/opencode \
  && echo '{"permission":{"edit":"allow","bash":"allow","mcp":"allow","webfetch":"allow"}}' > /root/.config/opencode/opencode.json

WORKDIR /workspace
