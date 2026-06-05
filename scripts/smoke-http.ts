// HTTP smoke test against the running dev server. Polls until ready, then
// exercises the pages, the webhook (with a real Photon-shaped inbound), and the
// session/status APIs. Run the dev server first (npm run dev), then:
//   npx tsx scripts/smoke-http.ts
const BASE = process.env.SMOKE_BASE ?? "http://localhost:4317";
const HANDLER = process.env.PHOTON_HANDLER_LINE ?? "+16282647656";
const PHONE = "+1555" + Date.now().toString().slice(-7);

async function get(path: string) {
  const r = await fetch(BASE + path);
  return { status: r.status, body: (await r.text()).slice(0, 220) };
}
async function postJSON(path: string, obj: unknown) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  });
  let body: unknown;
  try {
    body = await r.json();
  } catch {
    body = "(non-json)";
  }
  return { status: r.status, body };
}
async function waitReady(): Promise<boolean> {
  for (let i = 0; i < 45; i++) {
    try {
      const r = await fetch(BASE + "/");
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  return false;
}

async function main() {
  console.log("waiting for", BASE, "…");
  if (!(await waitReady())) {
    console.error("❌ dev server not reachable");
    process.exit(1);
  }
  console.log("server UP\n");

  for (const p of ["/", "/dashboard", "/capture", "/api/photon/webhook"]) {
    const { status } = await get(p);
    console.log(`GET  ${p}  -> ${status}`);
  }

  const s = await postJSON("/api/session/start", { phone: PHONE, handle: "SMOKE" });
  console.log("\nPOST /api/session/start ->", s.status, JSON.stringify(s.body).slice(0, 200));
  const sb = s.body as Record<string, any>;
  const sessionId = sb?.session?.id ?? sb?.sessionId ?? sb?.state?.session_id ?? sb?.id;

  const wh = await postJSON("/api/photon/webhook", {
    event: "messages",
    space: { phone: HANDLER },
    message: {
      id: "smoke-" + Date.now(),
      direction: "inbound",
      sender: { id: PHONE },
      space: { phone: HANDLER },
      content: { type: "text", text: "Cache recovered. Heading to meet Mara at Pier 7." },
    },
  });
  console.log("POST /api/photon/webhook(text) ->", wh.status, JSON.stringify(wh.body).slice(0, 200));

  if (sessionId) {
    const st = await get("/api/status?sessionId=" + sessionId);
    console.log("GET  /api/status ->", st.status, st.body.slice(0, 200));
  } else {
    console.log("(no sessionId returned — check session/start response shape)");
  }
  console.log("\n✅ SMOKE DONE");
}
main().catch((e) => {
  console.error("❌ SMOKE FAIL", e);
  process.exit(1);
});
