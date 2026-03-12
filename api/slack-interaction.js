import { createClient } from "redis";

export default async function handler(req, res) {
  const payload = JSON.parse(req.body.payload);
  const userId = payload.user.id;
  const action = payload.actions[0];
  const vote = action.value;
  const ts = payload.message.ts;

const client = createClient({ url: "redis://default:OF9LXSzxVX7kWCXhKezSuLJ5cqxPemSi@redis-17590.crce196.sa-east-1-2.ec2.cloud.redislabs.com:17590" });
  await client.connect();

  const raw = await client.get(`poll:${ts}`);
  const poll = JSON.parse(raw);

  // Bloqueia voto duplicado
  if (poll.votes[userId]) {
    await client.disconnect();
    return res.status(200).json({ ok: true });
  }

  // Registra voto
  poll.votes[userId] = vote;
  await client.set(`poll:${ts}`, JSON.stringify(poll));

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

  await client.disconnect();
res.status(200).json({
  response_type: "ephemeral",
  text: "✅ Voto registrado!"
});
}
