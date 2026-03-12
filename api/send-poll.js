import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  const question = "Como está seu humor hoje?";
  const options = ["😄 Ótimo", "😐 Ok", "😞 Ruim"];

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({
      channel: process.env.SLACK_CHANNEL_ID,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*${question}*` },
        },
        {
          type: "actions",
          elements: options.map((opt) => ({
            type: "button",
            text: { type: "plain_text", text: opt },
            action_id: `vote_${opt}`,
            value: opt,
          })),
        },
      ],
    }),
  });

  const data = await response.json();
  const ts = data.ts;

  // Inicializa os votos no KV
  await kv.set(`poll:${ts}`, { question, options, votes: {}, total_members: 10 });

  res.status(200).json({ ok: true, ts });
}
