FROM node:20

RUN apt-get update && apt-get install -y curl unzip python3 python3-pip ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Install uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

# Install opencode
RUN npm install -g opencode-ai

# Pre-configure opencode permissions
RUN mkdir -p /root/.config/opencode && \
    echo '{"permission":{"edit":"allow","bash":"allow","mcp":"allow","webfetch":"allow"}}' > /root/.config/opencode/opencode.json

WORKDIR /workspace
