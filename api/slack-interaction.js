import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  const payload = JSON.parse(req.body.payload);
  const userId = payload.user.id;
  const action = payload.actions[0];
  const vote = action.value;
  const ts = payload.message.ts;

  const poll = await kv.get(`poll:${ts}`);

  // Bloqueia voto duplicado
  if (poll.votes[userId]) {
    return res.status(200).json({ ok: true });
  }

  // Registra voto
  poll.votes[userId] = vote;
  await kv.set(`poll:${ts}`, poll);

  const totalVotes = Object.keys(poll.votes).length;

  // Se todos votaram, exibe resultado
  if (totalVotes >= poll.total_members) {
    const summary = poll.options.map((opt) => {
      const count = Object.values(poll.votes).filter((v) => v === opt).length;
      return `${opt}: ${count} voto(s)`;
    }).join("\n");

    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel: process.env.SLACK_CHANNEL_ID,
        text: `*Resultado da enquete:*\n${summary}`,
      }),
    });
  }

  res.status(200).json({ ok: true });
}
