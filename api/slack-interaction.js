import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  const payload = JSON.parse(req.body.payload);
  const userId = payload.user.id;
  const userName = payload.user.name;
  const action = payload.actions[0];
  const vote = action.value;
  const ts = payload.message.ts;
  const channelId = payload.channel.id;

  // Responde pro Slack imediatamente
  res.status(200).json({ ok: true });

  try {
    const docRef = db.collection("polls").doc(ts);
    const doc = await docRef.get();

    if (!doc.exists) return;

    const poll = doc.data();

    // Bloqueia voto duplicado
    if (poll.votes[userId]) {
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        },
        body: JSON.stringify({
          channel: channelId,
          thread_ts: ts,
          text: `⚠️ <@${u
