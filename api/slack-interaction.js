import { createClient } from "redis";

export default async function handler(req, res) {
  const payload = JSON.parse(req.body.payload);
  const userId = payload.user.id;
  const action = payload.actions[0];
  const vote = action.value;
  const ts = payload.message.ts;

  const client = createClient({ url: process.env.STORAGE_URL });
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
  await client.set(`poll:${ts}`, JSON.stringify(poll)
