# Tohyee TV in Docker (experimental)

Docker packages the tuner server, Node runtime and FFmpeg together. This image is for **Linux amd64**. It includes channel streams, reusable-tab allocation and XMLTV guide caching. It does not include the Windows desktop app, Chrome, a remote desktop, or a video subscription.

**Live capture needs Google Chrome with the extension on the same native Linux host**, in a signed-in graphical desktop session. Host networking lets the extension reach the container at `127.0.0.1:34500` and preserves the tuner's loopback-only capture restriction. A Windows browser cannot feed a separate NAS with this image. A headless NAS can run the test picture, but cannot supply browser video by itself. Linux website capture remains experimental and needs testing with your source.

For the existing Windows setup, continue using the Windows installer. Docker Desktop on Windows/macOS is not a supported live-capture configuration.

## Start on Linux

Clone this repository and run from its directory:

```sh
docker compose up -d --build
```

Or, once the image workflow has published the package:

```sh
docker compose pull
docker compose up -d --no-build
```

Open `http://localhost:34500`. In Plex, manually enter `http://YOUR-LINUX-PC-IP:34500`; use `http://YOUR-LINUX-PC-IP:34500/guide.xml` for the XMLTV guide. The host port must be free. Host networking exposes the tuner on the host's configured interfaces, so restrict access to your trusted LAN with the host firewall. There is no internet-facing authentication.

A named Docker volume stores settings, the tuner identity Plex remembers, and cached listings. `docker compose down` retains it; **do not use `down -v` unless you want to erase that data**. The process runs as UID 1000 without root privileges.

## Configure channels

The container uses `/data/tohyee-tv/tuner.json`, created on first start. Copy it out, edit it, and copy it back while the service is stopped:

```sh
docker compose cp tohyee-tv:/data/tohyee-tv/tuner.json ./tuner.json
docker compose stop
# Edit tuner.json, preserving the generated deviceId.
docker compose cp ./tuner.json tohyee-tv:/data/tohyee-tv/tuner.json
docker compose start
```

Use the existing generated settings and add, for example:

```json
{
  "captureMode": "pool",
  "tabCount": 3,
  "guideEnabled": true,
  "channels": [
    {
      "channelNumber": "1",
      "channelName": "My channel",
      "programmeTitle": "Live",
      "url": "https://example.com/live",
      "guideId": ""
    }
  ]
}
```

This is a fragment to merge into your settings, not a working video URL. Use your real direct video-page links and guide IDs. Restart after edits. With `guideEnabled` true, NZXMLTV Sky listings download at startup and every six hours; failed downloads retain the cached guide. Blank or unmatched guide IDs use placeholder programmes.

Load this checkout's `extension/` folder using Chrome → `chrome://extensions` → Developer mode → Load unpacked. On your video website, sign in and arm a different reusable slot in each tab. Keep Chrome open. Plex then selects the configured channel for an available slot. Capture does not bypass DRM or service limits.

## Test without a browser

Set `"source": "test"` in the settings and restart. This sends a moving test picture and tone to Plex. Change back to `"source": "chrome"` for actual capture. A healthy container means the tuner responds; it does not mean a browser is armed or a channel plays.

```sh
docker compose logs --tail=100 -f
docker compose ps
```

## Updates and image publishing

The Docker workflow builds and smoke-tests the actual image before publishing to `ghcr.io/willy-nz/tohyee-tv`. Main publishes `latest` and a full commit-SHA tag. Use a commit tag to pin an exact build. The first package publication may require its GitHub Packages visibility to be set to Public before anonymous pulls work.

The smoke test checks HTTP discovery, a decodable H.264/AAC test stream, health, and persistent device identity across a restart. It does not test real Chrome or protected video. There is no automatic browser startup or desktop settings UI in this image.
