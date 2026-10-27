FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    HELIX_RELAY_HOST=0.0.0.0 \
    HELIX_RELAY_PORT=8787

WORKDIR /app
COPY services/relay /app/services/relay

RUN pip install --no-cache-dir "websockets>=12,<16"

EXPOSE 8787
CMD ["python", "-m", "services.relay.server"]
