// Vercel serverless function: receives the enquiry / custom itinerary forms
// and delivers them to the site owner on WhatsApp (via CallMeBot) and/or email (via Resend).
//
// Environment variables (Vercel > Project > Settings > Environment Variables).
// Set the WhatsApp pair, the email pair, or both. At least one is required.
//
//   WhatsApp (https://www.callmebot.com/blog/free-api-whatsapp-messages/)
//     WHATSAPP_PHONE     your number with country code, digits only, e.g. 919876543210
//     CALLMEBOT_APIKEY   the key CallMeBot sends you on WhatsApp
//
//   Email (https://resend.com)
//     RESEND_API_KEY     API key from Resend
//     NOTIFY_EMAIL       where enquiries are delivered
//     FROM_EMAIL         optional, defaults to "Trip to Asia <onboarding@resend.dev>"

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

async function sendWhatsApp(text) {
  const phone = (process.env.WHATSAPP_PHONE || "").replace(/\D/g, "");
  const apikey = process.env.CALLMEBOT_APIKEY;
  const url = "https://api.callmebot.com/whatsapp.php?phone=" + encodeURIComponent(phone) +
    "&apikey=" + encodeURIComponent(apikey) + "&text=" + encodeURIComponent(text);
  const r = await fetch(url);
  if (!r.ok) throw new Error("CallMeBot " + r.status + " " + (await r.text()));
}

async function sendEmail(subject, html, text) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL || "Trip to Asia <onboarding@resend.dev>",
      to: [process.env.NOTIFY_EMAIL],
      subject: subject,
      html: html,
      text: text
    })
  });
  if (!r.ok) throw new Error("Resend " + r.status + " " + (await r.text()));
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
  FIELDS.forEach(function (f) { data[f[0]] = clean(body[f[0]], f[0] === "message" ? 1500 : 200); });

  if (!data.name || !data.phone) return res.status(400).json({ error: "Name and phone are required" });
  if (formName === "custom-itinerary" && !data.destinations) return res.status(400).json({ error: "Destinations are required" });

  const useWhatsApp = !!(process.env.WHATSAPP_PHONE && process.env.CALLMEBOT_APIKEY);
  const useEmail = !!(process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL);
  if (!useWhatsApp && !useEmail) {
    console.error("No delivery configured: set WHATSAPP_PHONE + CALLMEBOT_APIKEY and/or RESEND_API_KEY + NOTIFY_EMAIL");
    return res.status(500).json({ error: "Server not configured" });
  }

  const rows = FIELDS.filter(function (f) { return data[f[0]]; });
  const subject = LABELS[formName] + " from " + data.name;
  const text = "*" + LABELS[formName] + "*\n\n" + rows.map(function (f) { return f[1] + ": " + data[f[0]]; }).join("\n");
  const html = "<h2>" + esc(LABELS[formName]) + "</h2><table cellpadding=\"6\">" +
    rows.map(function (f) {
      return "<tr><td><b>" + esc(f[1]) + "</b></td><td>" + esc(data[f[0]]).replace(/\n/g, "<br>") + "</td></tr>";
    }).join("") + "</table>";

  const jobs = [];
  if (useWhatsApp) jobs.push(sendWhatsApp(text));
  if (useEmail) jobs.push(sendEmail(subject, html, text));
  const results = await Promise.allSettled(jobs);
  results.forEach(function (r) { if (r.status === "rejected") console.error(r.reason); });

  // Succeed if at least one channel delivered it.
  if (results.some(function (r) { return r.status === "fulfilled"; })) return res.status(200).json({ ok: true });
  return res.status(502).json({ error: "Could not send" });
};
