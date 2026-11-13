const PIN_KEY = "memeDeskPin";
const $ = (id) => document.getElementById(id);

function prettyWhen(stamp) {
  if (!stamp) return "unknown";
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}(?::\d{2})?) (CET|CEST)$/.exec(stamp);
  if (!match) return `${stamp} (Europe/Prague)`;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}, ${match[4]} ${match[5]} (Europe/Prague)`;
}

function clockOf(stamp) {
  if (!stamp) return "—";
  const match = /(\d{2}:\d{2})/.exec(stamp);
  return match ? match[1] : stamp;
}

function eur(value, signed = false) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  const body = "€" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n < 0) return "−" + body;
  if (signed && n > 0) return "+" + body;
  return body;
}

function pct(value, signed = false) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  const body = Math.abs(n).toFixed(2) + "%";
  if (n < 0) return "−" + body;
  if (signed && n > 0) return "+" + body;
  return body;
}

function usdPx(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  if (n >= 1) return "$" + n.toFixed(4);
  return "$" + n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

function clsFor(n) {
  if (n == null) return "";
  if (n > 0) return "up";
  if (n < 0) return "down";
  return "";
}

function toneClass(tone) {
  if (tone === "green" || tone === "red" || tone === "orange" || tone === "purple") return "tone-" + tone;
  return "tone-neutral";
}

function prettyReason(reason) {
  return (reason || "").replace(/_/g, " ");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function iconSvg(id) {
  const paths = {
    scout: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-3.5-3.5"/>',
    filter: '<path d="M4 5h16l-6 7v5l-4 2v-7z"/>',
    analyst: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    executor: '<path d="M13 3L5 14h7l-1 7 8-11h-7z"/>',
    risk: '<path d="M12 3l8 4v6c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V7z"/>',
    logger: '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M5 6h.01M5 12h.01M5 18h.01"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="#3dff8a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[id] || paths.logger}</svg>`;
}

function spark(values) {
  if (!values || values.length < 2) return "";
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.18, 0.25);
  const min = lo - pad;
  const max = hi + pad;
  const w = 100;
  const h = 36;
  const pts = values.map((value, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((value - min) / (max - min)) * h;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="44" preserveAspectRatio="none" aria-label="Equity curve"><polyline fill="none" stroke="#3dff8a" stroke-width="1.5" points="${pts}"/></svg>`;
}

function isLive(payload) {
  const snap = payload.snapshot || {};
  if (payload.ingested_at) {
    const t = Date.parse(payload.ingested_at);
    if (!Number.isNaN(t) && Date.now() - t <= 20000) return true;
  }
  return Boolean(snap.live);
}

function render(payload) {
  const snap = payload.snapshot;
  const control = payload.control || { desired: "run" };
  const live = isLive(payload);
  const liveEl = $("live");
  liveEl.className = "live " + (live ? "on" : "idle");
  liveEl.querySelector(".live-label").textContent = live ? "Live" : "Idle";

  const btn = $("control-btn");
  const stopped = control.desired === "stop";
  btn.textContent = stopped ? "Stopped" : "Running";
  btn.className = "ctrl " + (stopped ? "stop" : "run");

  if (!snap) {
    $("footer").textContent = "Paper money · waiting for the first snapshot from the desk";
    return;
  }

  const start = snap.starting_cash_eur ?? 150;
  const equity = snap.equity_eur;
  const pnl = snap.pnl_eur;
  const maxPct = snap.max_trade_pct ?? 8;
  $("equity-kicker").textContent = `Equity · ${eur(start)} start · ${Number(maxPct).toFixed(0)}% max size`;

  if (equity != null) {
    const [euros, cents] = Math.abs(Number(equity)).toFixed(2).split(".");
    const sign = Number(equity) < 0 ? "−" : "";
    $("equity-big").innerHTML = `<span class="euros">${sign}€${Number(euros).toLocaleString("en-US")}</span><span class="cents">.${cents}</span>`;
  }
  const pnlEl = $("pnl");
  pnlEl.textContent = `${eur(pnl, true)} (${pct(snap.pnl_pct, true)})`;
  pnlEl.className = "pnl " + clsFor(pnl);
  $("mult").textContent = start && equity != null ? (Number(equity) / Number(start)).toFixed(2) + "×" : "—";

  const curve = (snap.equity_curve || []).map((p) => p.equity_eur).filter((v) => typeof v === "number");
  $("spark").innerHTML = spark(curve);

  const ticker = snap.ticker || [];
  $("ticker").innerHTML = ticker.map((coin) => {
    const ch = coin.change_1h_pct;
    return `<div class="tick"><div class="sym">${escapeHtml(coin.symbol)}</div><div class="px">${usdPx(coin.price_usd)}</div><div class="ch ${clsFor(ch)}">${pct(ch, true)}</div></div>`;
  }).join("");

  const scanned = snap.scanned_total;
  const traded = snap.traded_total;
  $("desk-meta").textContent =
    scanned == null ? "waiting for data" : `${Number(scanned).toLocaleString("en-US")} scanned · ${traded ?? 0} traded`;

  const agents = snap.agents || [];
  $("agents").innerHTML = agents.map((agent) => `
    <div class="agent">
      <div class="tile">${iconSvg(agent.id)}</div>
      <div class="agent-body">
        <div class="agent-name">${escapeHtml(agent.name)}</div>
        <div class="agent-sub">${escapeHtml(agent.subtitle)}</div>
        <div class="agent-latest">${escapeHtml(agent.latest)}</div>
      </div>
      <div class="agent-pill">${escapeHtml(agent.pill)}</div>
    </div>
  `).join("");

  const feed = snap.feed || [];
  $("feed").innerHTML = feed.length
    ? feed.map((ev) => `
        <div class="feed-row">
          <span class="feed-t">${escapeHtml(ev.t_seconds || ev.t_cet || "")}</span>
          <span class="feed-a ${toneClass(ev.tone)}">${escapeHtml(ev.agent)}</span>
          <span class="feed-x ${toneClass(ev.tone)}">${escapeHtml(ev.text)}</span>
        </div>`).join("")
    : `<div class="muted">No events yet.</div>`;

  const kills = snap.kills_by_reason || [];
  const maxKill = Math.max(1, ...kills.map((row) => row.count || 0));
  $("kills").innerHTML = kills.length
    ? kills.map((row) => `
        <div>
          <div class="kill-top"><span>${escapeHtml(row.label)}</span><span class="kill-n">${row.count}</span></div>
          <div class="bar"><span style="width:${((row.count || 0) / maxKill) * 100}%"></span></div>
        </div>`).join("")
    : `<div class="muted">No kills recorded.</div>`;

  const opens = snap.open_positions || [];
  $("opens").innerHTML = opens.length
    ? opens.map((pos) => {
        const u = pos.unrealized_pnl_eur;
        return `<div class="trade">
          <div class="trade-top">
            <div>${escapeHtml(pos.symbol)}</div>
            <div class="${clsFor(u)}">${eur(u, true)}${pos.last_vs_entry_pct == null ? "" : " (" + pct(pos.last_vs_entry_pct, true) + ")"}</div>
          </div>
          <div class="trade-d">Entered ${prettyWhen(pos.entry_cet)} · last ${usdPx(pos.last_mid_usd)} · stop ${usdPx(pos.effective_stop_usd || pos.stop_usd)}</div>
          <div class="trade-d">${escapeHtml(pos.trail_state || (pos.trail_active ? "trailing" : ""))} · cost ${eur(pos.cost_eur)}</div>
          <div class="trade-m">${escapeHtml(pos.mint_short || "")}</div>
        </div>`;
      }).join("")
    : `<div class="muted">No open paper positions.</div>`;

  const trades = snap.closed_trades || [];
  $("trades").innerHTML = trades.length
    ? trades.map((trade) => `
        <div class="trade">
          <div class="trade-top">
            <div>${escapeHtml(trade.symbol)}</div>
            <div class="${clsFor(trade.pnl_eur)}">${eur(trade.pnl_eur, true)} (${pct(trade.pnl_pct, true)})</div>
          </div>
          <div class="trade-d">${clockOf(trade.entry_cet)} → ${clockOf(trade.exit_cet)} CET · ${usdPx(trade.entry_price_usd)} → ${usdPx(trade.exit_price_usd)}</div>
          <div class="trade-d">Cost ${eur(trade.cost_eur)} · proceeds ${eur(trade.proceeds_eur)} · ${escapeHtml(prettyReason(trade.exit_reason))}</div>
          <div class="trade-m">${escapeHtml(trade.mint_short || "")}</div>
        </div>`).join("")
    : `<div class="muted">No paper trades yet.</div>`;

  const when = snap.generated_at_cet || payload.ingested_at_cet;
  const pause = stopped ? " · new entries paused" : "";
  $("footer").textContent = `Paper money · data as of ${prettyWhen(when)}${pause}`;
}

async function loadState() {
  const resp = await fetch("/api/state", { cache: "no-store" });
  if (!resp.ok) throw new Error("state " + resp.status);
  render(await resp.json());
}

function listenStream() {
  const src = new EventSource("/api/stream");
  src.addEventListener("state", (ev) => {
    try { render(JSON.parse(ev.data)); } catch (err) { console.warn(err); }
  });
  src.onerror = () => {
    src.close();
    setTimeout(listenStream, 2000);
  };
}

function showPin(show) {
  $("pin-card").classList.toggle("hidden", !show);
  if (show) {
    $("pin-error").textContent = "";
    $("pin-input").value = localStorage.getItem(PIN_KEY) || "";
    $("pin-input").focus();
  }
}

async function sendControl(desired, pin) {
  const resp = await fetch("/api/control", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-App-Pin": pin },
    body: JSON.stringify({ desired, pin }),
  });
  if (resp.status === 401) throw new Error("That PIN was not accepted.");
  if (!resp.ok) throw new Error("Control request failed (" + resp.status + ")");
  return resp.json();
}

function currentDesired() {
  return $("control-btn").classList.contains("stop") ? "stop" : "run";
}

$("control-btn").addEventListener("click", async () => {
  const pin = localStorage.getItem(PIN_KEY);
  if (!pin) {
    $("control-btn").dataset.pending = currentDesired() === "stop" ? "run" : "stop";
    showPin(true);
    return;
  }
  const next = currentDesired() === "stop" ? "run" : "stop";
  $("control-btn").disabled = true;
  try {
    await sendControl(next, pin);
    await loadState();
  } catch (err) {
    if (String(err.message).includes("PIN")) {
      localStorage.removeItem(PIN_KEY);
      $("control-btn").dataset.pending = next;
      showPin(true);
      $("pin-error").textContent = err.message;
    } else {
      alert(err.message);
    }
  } finally {
    $("control-btn").disabled = false;
  }
});

$("pin-cancel").addEventListener("click", () => showPin(false));
$("pin-save").addEventListener("click", async () => {
  const pin = $("pin-input").value.trim();
  if (!pin) {
    $("pin-error").textContent = "Enter the PIN first.";
    return;
  }
  const pending = $("control-btn").dataset.pending || (currentDesired() === "stop" ? "run" : "stop");
  try {
    await sendControl(pending, pin);
    localStorage.setItem(PIN_KEY, pin);
    showPin(false);
    await loadState();
  } catch (err) {
    $("pin-error").textContent = err.message;
  }
});

const _render = render;
render = function (payload) {
  window.__last = payload;
  _render(payload);
};

loadState().catch((err) => {
  $("footer").textContent = "Paper money · could not load desk state";
  console.warn(err);
});
listenStream();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
