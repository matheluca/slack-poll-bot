import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  const question = process.env.SEND_POLL_QUESTION || "Você já atualizou as OPs do seu funil para evitar irregularidade?";
  const options = (process.env.SEND_POLL_OPTIONS || "😄 Sim!;😐 Ainda não!;😞 Ed, estava esquecendo. Obrigado!")
    .split(";")
    .map((o) => o.trim());

  const channels = (process.env.SEND_POLL_CHANNELS || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  if (channels.length === 0) {
    return res.status(500).json({ error: "SEND_POLL_CHANNELS not configured" });
  }

  const results = [];

  for (const channel of channels) {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `<!channel> *${question}*` },
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
    results.push({ channel, ok: data.ok, error: data.error });

    if (data.ts) {
      await redis.set(`poll:${data.ts}`, { question, options, votes: {} });
    }
  }

  res.status(200).json({ results });
}
