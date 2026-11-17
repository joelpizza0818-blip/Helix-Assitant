FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        dbus-x11 \
        ffmpeg \
        python3 \
        python3-websockets \
        x11-utils \
        x11-xserver-utils \
        xdotool \
        xfce4 \
        xfce4-terminal \
        xvfb \
    && useradd --create-home --uid 1000 --shell /bin/bash helix \
    && rm -rf /var/lib/apt/lists/*

COPY guest_agent.py /opt/helix/guest_agent.py
COPY start-desktop.sh /usr/local/bin/start-desktop
RUN chmod 0755 /usr/local/bin/start-desktop \
    && chown -R helix:helix /opt/helix /home/helix

USER helix
WORKDIR /home/helix
EXPOSE 8765
ENTRYPOINT ["/usr/local/bin/start-desktop"]
