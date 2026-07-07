module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  const apiUrl = process.env.SHEETS_API_URL;

  if (!apiUrl) {
    return response.status(503).json({
      error: "Google Sheets API URL is not configured",
    });
  }

  try {
    if (request.method === "GET") {
      const upstream = await fetch(apiUrl, { method: "GET" });

      if (!upstream.ok) {
        return response.status(upstream.status).json({
          error: "Failed to read RSVPs from Google Sheets",
        });
      }

      const data = await upstream.json();
      return response.status(200).json({ rows: Array.isArray(data.rows) ? data.rows : [] });
    }

    if (request.method === "POST") {
      const upstream = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body || {}),
      });

      const data = await upstream.json().catch(() => ({}));

      if (!upstream.ok) {
        return response.status(upstream.status).json({
          error: data.error || "Failed to save RSVP to Google Sheets",
        });
      }

      return response.status(201).json({ ok: true, answer: data.answer || data });
    }

    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return response.status(502).json({
      error: "Google Sheets API is unreachable",
      details: error.message,
    });
  }
};
