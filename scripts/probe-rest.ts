// Throwaway: discover Butterbase's update/delete route shapes.
import "./_env";
const apiUrl = process.env.BUTTERBASE_API_URL!;
const key = process.env.BUTTERBASE_SERVICE_KEY!;
const H: Record<string, string> = {
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

async function probe(method: string, path: string, body?: unknown) {
  const r = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { ...H, Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  console.log(`${method} ${path} -> ${r.status}  ${t.slice(0, 140).replace(/\n/g, " ")}`);
  return r.status;
}

async function main() {
  const ins = await fetch(`${apiUrl}/players`, {
    method: "POST",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ phone: `+1777${Date.now().toString().slice(-7)}`, handle: "probe" }),
  });
  const j = await ins.json();
  const p = Array.isArray(j) ? j[0] : j;
  const id = p.id as string;
  console.log("inserted", id, "\n--- update variants ---");
  await probe("PATCH", `/players/${id}`, { handle: "u1" });
  await probe("PUT", `/players/${id}`, { handle: "u2" });
  await probe("POST", `/players/${id}`, { handle: "u3" });
  await probe("PATCH", `/players?id=eq.${id}`, { handle: "u4" });
  console.log("--- delete variants ---");
  await probe("DELETE", `/players/${id}`);
  await probe("DELETE", `/players?id=eq.${id}`);
  console.log("--- final state ---");
  const left = await fetch(`${apiUrl}/players?id=eq.${id}`, { headers: H });
  console.log("rows left:", (await left.json()).length);
}
main().catch((e) => console.error(e));
