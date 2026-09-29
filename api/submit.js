// Vercel serverless function: receives the enquiry / custom itinerary forms
// and emails them to the site owner through Resend (https://resend.com).
//
// Environment variables (set in Vercel > Project > Settings > Environment Variables):
//   RESEND_API_KEY  required  API key from Resend
//   NOTIFY_EMAIL    required  where enquiries are delivered
//   FROM_EMAIL      optional  defaults to Resend's test sender "Trip to Asia <onboarding@resend.dev>"

const LABELS = {
  "enquiry": "Enquiry",
  "custom-itinerary": "Custom itinerary request"
};

const FIELDS = [
  ["name", "Name"],
  ["phone", "Phone"],
  ["package", "Package"],
  ["destinations", "Destinations"],
  ["date-from", "Travel from"],
  ["date-to", "Travel to"],
  ["travellers", "No of travellers"],
  ["message", "Message"]
];

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function clean(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof req.body === "object" && req.body ? req.body : {};

  // Honeypot: bots fill the hidden field, people don't. Pretend success.
  if (clean(body["bot-field"], 100)) return res.status(200).json({ ok: true });

  const formName = clean(body["form-name"], 40);
  if (!LABELS[formName]) return res.status(400).json({ error: "Unknown form" });

  const data = {};
  FIELDS.forEach(function (f) { data[f[0]] = clean(body[f[0]], f[0] === "message" ? 3000 : 300); });

  if (!data.name || !data.phone) return res.status(400).json({ error: "Name and phone are required" });
  if (formName === "custom-itinerary" && !data.destinations) return res.status(400).json({ error: "Destinations are required" });

  const key = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;
  if (!key || !to) {
    console.error("RESEND_API_KEY or NOTIFY_EMAIL is not set");
    return res.status(500).json({ error: "Server not configured" });
  }

  const rows = FIELDS.filter(function (f) { return data[f[0]]; });
  const html = "<h2>" + esc(LABELS[formName]) + "</h2><table cellpadding=\"6\">" +
    rows.map(function (f) {
      return "<tr><td><b>" + esc(f[1]) + "</b></td><td>" + esc(data[f[0]]).replace(/\n/g, "<br>") + "</td></tr>";
    }).join("") + "</table>";
  const text = LABELS[formName] + "\n\n" + rows.map(function (f) { return f[1] + ": " + data[f[0]]; }).join("\n");

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.FROM_EMAIL || "Trip to Asia <onboarding@resend.dev>",
        to: [to],
        subject: LABELS[formName] + " from " + data.name,
        html: html,
        text: text
      })
    });
    if (!r.ok) {
      console.error("Resend error", r.status, await r.text());
      return res.status(502).json({ error: "Could not send" });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "Could not send" });
  }
};
