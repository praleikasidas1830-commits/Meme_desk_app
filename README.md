# Meme Desk

A paper-only web app for the Solana pump.fun desk: live balance, the six agents, logger feed, kills, open positions and closed trades. No wallets, keys or real orders.

The **box cannot be reached from the internet**, so the desk **pushes** a snapshot to this app every few seconds. You open the website (or add it to your phone’s home screen). Run / Stop on the site only pauses **new paper entries**; exits still run.

## What’s in this repo

- `app.py` — FastAPI server
- `static/` — the single-page app (HTML, CSS, JS), PWA manifest and icons
- `render.yaml` — Render free-tier web service
- `requirements.txt`

The pusher that lives on the desk box is **not** deployed here. It is `/workspace/solana-meme-desk/engine/app_pusher.py`.

## Deploy on Render

1. Create a GitHub repository and push this project (the folder that contains `app.py` and `render.yaml`) as the repo root.
2. In [Render](https://dashboard.render.com), click **New → Web Service** and connect that repository.
3. Use these settings (also described in `render.yaml`):
   - **Runtime:** Python
   - **Plan:** Free
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `uvicorn app:app --host 0.0.0.0 --port $PORT`
4. Add environment variables (do not put them in the repo):
   - `DESK_TOKEN` — a long random secret, the same value you put in the box file `/workspace/meme-desk-app/.env.local`
   - `APP_PIN` — a short PIN you will type once in the website to use Run / Stop
5. Deploy. When it is live, copy the `https://….onrender.com` URL.

Render’s free tier will spin the service down when idle. The first visit after that can take a short while to wake it. The phone app reconnects the live stream on its own.

## Point the desk box at the site

On the box, `/workspace/meme-desk-app/.env.local` should contain (already chmod 600):

```
APP_URL=https://YOUR-SERVICE.onrender.com
DESK_TOKEN=the-same-token-as-Render
APP_PIN=your-pin
```

`APP_PIN` is only needed by the local server; the pusher uses `APP_URL` and `DESK_TOKEN`.

Start the pusher (leave this running on the box after you are ready — not during a one-off test):

```
python3 /workspace/solana-meme-desk/engine/app_pusher.py
```

Every 5 seconds it builds a snapshot from the paper desk and POSTs it to `/api/ingest`. It also reads `/api/control`. If the site is set to **Stop**, the pusher creates the desk’s existing `run/HALT` file so new entries are blocked. If you press **Run**, it removes that file **only when the pusher created it**. It never writes `run/WATCHER_STOP` and never changes desk rules.

## Run / Stop on your phone

The first time you tap **Running / Stopped**, enter the `APP_PIN`. It is stored in that browser’s localStorage. Stop means “no new paper buys”; open positions can still be exited.

## Local development

```
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# .env.local must define APP_URL, DESK_TOKEN and APP_PIN
uvicorn app:app --host 127.0.0.1 --port 8765
# in another terminal:
python3 /workspace/solana-meme-desk/engine/app_pusher.py
```

Open http://127.0.0.1:8765

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/` | none | The app |
| GET | `/api/state` | none | Latest snapshot + control |
| GET | `/api/stream` | none | SSE of the same payload |
| POST | `/api/ingest` | header `X-Desk-Token` | Box pushes a snapshot |
| GET | `/api/control` | header `X-Desk-Token` | Box reads desired run/stop |
| POST | `/api/control` | header `X-App-Pin` or JSON `pin` | Browser sets `{"desired":"run"\|"stop"}` |

All figures are paper-money results only.
