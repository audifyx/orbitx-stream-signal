# orbitx-stream-signal

Personal WebRTC signaling server. One broadcaster (the phone screen share),
any number of viewers. Only SDP offers/answers and ICE candidates are relayed
here — media itself is peer-to-peer between the broadcaster's phone and each
viewer's browser.

## Run locally

```bash
npm ci
node server.js        # listens on $PORT (default 3000)
```

## Deploy (Render free web service)

- Build command: `npm ci`
- Start command: `node server.js`
- Health check path: `/health`
- Plan: free (sleeps after 15 min idle, wakes in ~30–60 s on next request)

## Protocol (JSON over WebSocket)

Client → server:

- `{type:"join", role:"broadcaster"|"viewer", room:"live"}`
- `{type:"offer"|"answer"|"ice", to:"broadcaster"|<viewerId>, sdp|candidate}`
- `{type:"ping"}` → server replies `{type:"pong"}`

Server → client:

- `{type:"joined", peerId, room, role}`
- `{type:"broadcaster-ready"}` / `{type:"broadcaster-absent"}` / `{type:"broadcaster-left"}` (to viewers)
- `{type:"viewer-joined", viewerId}` / `{type:"viewer-left", viewerId}` (to broadcaster)
- Relayed `offer` / `answer` / `ice` messages, with `from` set to the sender's peer id.

Flow: a viewer creates the offer and sends it `to:"broadcaster"`. The
broadcaster creates one RTCPeerConnection per viewer, adds its screen-share
tracks, and answers. ICE candidates flow both ways through the same relay.
