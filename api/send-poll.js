import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const CHANNELS = ["C0ALDQ09TPW", "C06BR6JNTD5", "C06C63PCX6W", "C06C3C1RGQ5"];
const ALLOWED_HOURS_BRT = [10, 14, 17]; // horários de Brasília

export default async function handler(req, res) {
  const now = new Date();
  const hourUTC = now.getUTCHours();
  const hourBRT = (hourUTC - 3 + 24) % 24;
  const dayOfWeek = now.getUTCDay(); // 0=dom, 6=sab

  // só dispara em dias úteis e nos horários certos
  if (dayOfWeek === 0 || dayOfWeek === 6 || !ALLOWED_HOURS_BRT.includes(hourBRT)) {
    return res.status(200).json({ ok: false, reason: "fora do horário" });
  }

  const question = "Você já atualizou as OPs do seu funil para evitar irregularidade?";
  const options = ["😄 Sim!", "😐 Ainda não!", "😞 Ed, estava esquecendo. Obrigado!"];

  for (const channel of CHANNELS) {
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
    await redis.set(`poll:${ts}`, { question, options, votes: {} });
  }

  res.status(200).json({ ok: true });
}
