import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config({
    path: '.env'
});

const { Client, MessageMedia, LocalAuth } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load context from context.txt
const contextPath = path.join(__dirname, 'context.txt');
const botContext = fs.readFileSync(contextPath, 'utf8');

// Gemini AI setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

async function getAIResponse(userMessage) {
  const prompt = `You are a helpful and polite assistant for a boutique resort called Chembarathi Wayanad.\n\n` +
                 `Context:\n${botContext}\n\n` +
                 `User asked:\n${userMessage}\n\n` +
                 `Reply in a friendly, informative way.` +
                 `you should send message very readable by adding emojis and text styles`;

  const result = await model.generateContent({ contents: [{ parts: [{ text: prompt }] }] });
  const response = await result.response;
  return response.text();
}

// WhatsApp Client setup
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox'],
  },
});

// Express setup
const app = express();
const port = process.env.PORT || 4000;
app.use(express.static(path.join(__dirname, 'images')));

client.on('qr', (qr) => {
  console.log('QR RECEIVED, scan this with your WhatsApp app:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp client is ready!');
});

// Handle incoming messages with AI only
client.on('message', async (message) => {
  const chat = await message.getChat();
  const msg = message.body.trim();

  console.log(`[${new Date().toLocaleString()}] Message from ${message.from}: ${msg}`);

  try {
    const aiReply = await getAIResponse(msg);
    await chat.sendMessage(aiReply);
  } catch (err) {
    console.error('AI Error:', err);
    await chat.sendMessage('⚠️ Sorry, I’m having trouble responding right now. Please try again later.');
  }
});

// Start server and client
client.initialize();
app.listen(port, () => {
  console.log(`🚀 Express server running on port ${port}`);
});
