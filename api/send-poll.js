import { createClient } from "redis";

export default async function handler(req, res) {
  const client = createClient({ url: process.env.STORAGE_URL });
  await client.connect();

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

  await client.set(`poll:${ts}`, JSON.stringify({ question, options, votes: {}, total_members: 10 }));
  await client.disconnect();

  res.status(200).json({ ok: true, ts });
}
