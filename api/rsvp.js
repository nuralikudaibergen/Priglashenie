const STORE_KEY = "ernar_aruzhan_rsvp_answers";

async function kv(command) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("KV storage is not configured");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    throw new Error("KV request failed");
  }

  return response.json();
}

async function readRows() {
  const data = await kv(["GET", STORE_KEY]);
  if (!data.result) return [];

  try {
    const rows = JSON.parse(data.result);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function writeRows(rows) {
  await kv(["SET", STORE_KEY, JSON.stringify(rows)]);
}

function sanitizeAnswer(value) {
  return {
    id: Number(value.id) || Date.now(),
    fullName: String(value.fullName || "").trim().slice(0, 120),
    relation: String(value.relation || "").trim().slice(0, 120),
    attendance: String(value.attendance || "").trim().slice(0, 120),
    guestCount: Math.max(1, Math.min(10, Number(value.guestCount) || 1)),
    createdAt: value.createdAt || new Date().toISOString(),
  };
}

function isAdminAuthorized(request) {
  const adminToken = process.env.RSVP_ADMIN_TOKEN;
  const requestToken = request.headers["x-admin-token"];
  return Boolean(adminToken && requestToken && requestToken === adminToken);
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  try {
    if (request.method === "GET") {
      if (!isAdminAuthorized(request)) {
        return response.status(401).json({ error: "Unauthorized" });
      }

      return response.status(200).json({ rows: await readRows() });
    }

    if (request.method === "POST") {
      const answer = sanitizeAnswer(request.body || {});

      if (!answer.fullName || !answer.relation || !answer.attendance) {
        return response.status(400).json({ error: "Required fields are missing" });
      }

      const rows = await readRows();
      rows.push(answer);
      await writeRows(rows);
      return response.status(201).json({ ok: true, answer });
    }

    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return response.status(503).json({
      error: "Shared RSVP storage is not configured",
      details: error.message,
    });
  }
};
