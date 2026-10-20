# Cloudzer — full-stack consent-first prototype

This project contains a Node.js + Socket.IO signaling server and a responsive browser UI with WebRTC camera streaming.

## Flow
1. Requester creates a short-lived invitation link.
2. Receiver opens it and sees the requester's self-declared display name.
3. Receiver explicitly accepts or declines.
4. Only after acceptance, the receiver presses **Start Sharing** and grants browser camera permission.
5. WebRTC attempts to connect the live stream. Receiver can stop at any time.
6. Sessions expire after 10 minutes; there is no silent reconnect.

## Important limitations / before public use
- This is a prototype, not a security-audited production service.
- Display names are self-declared and are **not verified identities**. A link is a bearer invitation; only send it to a trusted person.
- Server memory is ephemeral. Restarting the server ends sessions.
- STUN-only connectivity may fail on some networks; a properly secured TURN service may be needed.
- Add authentication, abuse prevention, rate limits, origin restrictions, monitoring, and a security review before public launch.
- Do not use this for covert monitoring or to access anyone's camera without informed consent.
- Browser camera access requires HTTPS (or localhost). Deploy on a Node.js host that supports WebSockets; GitHub Pages alone cannot host this backend.

## Run locally
1. Install Node.js 20 or newer.
2. In this folder run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000` for local UI testing. For two physical phones, deploy to an HTTPS Node host.
5. Requester creates a link and sends it to the receiver. Receiver accepts, presses Start Sharing, and grants camera permission.

## Environment
- `PORT` is optional; hosting platforms usually set it automatically.
