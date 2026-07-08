const STORE_KEY = "ernar_aruzhan_rsvp_answers";

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

function parseBody(body) {
  if (typeof body !== "string") return body || {};

  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function sortRows(rows) {
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function isAdminAuthorized(request) {
  const adminToken = process.env.RSVP_ADMIN_TOKEN;
  const requestToken = request.headers["x-admin-token"];
  return Boolean(adminToken && requestToken && requestToken === adminToken);
}

async function kv(command) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("KV storage is not configured");
  }

  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    throw new Error(data.error || "KV request failed");
  }

  return data;
}

async function readKvRows() {
  const data = await kv(["GET", STORE_KEY]);
  if (!data.result) return [];

  try {
    const rows = JSON.parse(data.result);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function writeKvRows(rows) {
  await kv(["SET", STORE_KEY, JSON.stringify(rows)]);
}

async function readSheetRows() {
  const apiUrl = process.env.SHEETS_API_URL;
  if (!apiUrl) throw new Error("Google Sheets API URL is not configured");

  const upstream = await fetch(apiUrl, { method: "GET" });
  const data = await upstream.json().catch(() => ({}));

  if (!upstream.ok) {
    throw new Error(data.error || "Failed to read RSVPs from Google Sheets");
  }

  return Array.isArray(data.rows) ? data.rows : [];
}

async function writeSheetRow(answer) {
  const apiUrl = process.env.SHEETS_API_URL;
  if (!apiUrl) throw new Error("Google Sheets API URL is not configured");

  const upstream = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(answer),
  });
  const data = await upstream.json().catch(() => ({}));

  if (!upstream.ok) {
    throw new Error(data.error || "Failed to save RSVP to Google Sheets");
  }

  return data.answer || data;
}

function formatTelegramMessage(answer) {
  return [
    "New RSVP",
    `Name: ${answer.fullName}`,
    `Relation: ${answer.relation}`,
    `Answer: ${answer.attendance}`,
    `Guests: ${answer.guestCount}`,
    `Time: ${new Date(answer.createdAt).toLocaleString("ru-RU")}`,
  ].join("\n");
}

async function notifyTelegram(answer) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: formatTelegramMessage(answer),
    }),
  });
}

async function readRows() {
  try {
    return sortRows(await readKvRows());
  } catch {
    return sortRows(await readSheetRows());
  }
}

async function writeRow(answer) {
  let saved = false;

  try {
    const rows = await readKvRows();
    rows.push(answer);
    await writeKvRows(sortRows(rows));
    saved = true;
  } catch {
    // KV is optional when Google Sheets is configured.
  }

  if (!saved) {
    await writeSheetRow(answer);
  }

  await notifyTelegram(answer).catch(() => {});
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
      const answer = sanitizeAnswer(parseBody(request.body));

      if (!answer.fullName || !answer.relation || !answer.attendance) {
        return response.status(400).json({ error: "Required fields are missing" });
      }

      await writeRow(answer);
      return response.status(201).json({ ok: true, answer });
    }

    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    const status = /not configured|Unauthorized/i.test(error.message) ? 503 : 502;
    return response.status(status).json({
      error: "RSVP storage failed",
      details: error.message,
    });
  }
};
