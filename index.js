import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config({ path: '.env' });

const { Client, MessageMedia, LocalAuth } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const contextPath = path.join(__dirname, 'context.txt');
const botContext = fs.readFileSync(contextPath, 'utf8');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

async function getAIResponse(userMessage) {
  const prompt = `You are a helpful and polite assistant for a boutique resort called Chembarathi Wayanad.

Context:
${botContext}

User asked:
${userMessage}

Guidelines for reply:
- Be friendly, informative, and under 40 words.
- Use emojis and text formatting (like *bold* or _italics_) to improve readability.
- Use bullet points when listing items.
- Prices must be in *bold* and formatted like in the context.
- The default Greeting Should be "Namasthe From Chembarathi Wayanad, Let me know how i help🌸"
- If the user asks about booking, say: _"Our team will contact you soon to confirm the booking."_ 
- ❗ Never confirm a booking yourself. Just provide info or say someone will reach out.`;

  const result = await model.generateContent({
    contents: [{ parts: [{ text: prompt }] }],
  });

  const response = await result.response;
  return response.text();
}

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox'],
  },
});

const app = express();
const port = process.env.PORT || 4000;
app.use(express.static(path.join(__dirname, 'images')));

const imageFolders = {
  'deluxe lawn view': 'deluxe_lawn_view',
  'premium mountain view': 'premium_mountain_view',
  'pool villa': 'pool_villa',
  'deluxe pool forest view': 'deluxe_pool_forest_view',
  'honeymoon suite': 'honeymoon_suite',
  'premium pool mountain view': 'premium_pool_mountain_view'
};

function logToFile(logMessage) {
  const logPath = path.join(__dirname, 'log.txt');
  const timestamp = new Date().toLocaleString();
  const logEntry = `[${timestamp}] ${logMessage}\n`;
  fs.appendFileSync(logPath, logEntry, 'utf8');
}

async function handleMessage(message) {
  const chat = await message.getChat();
  const msg = message.body.trim().toLowerCase();
  const sender = message.from;
  const time = new Date().toLocaleString();

  logToFile(`📩 [${time}] Message from ${sender}: ${message.body}`);

  const imageTriggerWords = ['photo', 'photos', 'images', 'img', 'pics', 'pictures', 'pic'];
  const roomOptions = Object.keys(imageFolders);

  if (imageTriggerWords.some(word => msg.includes(word))) {
    let list = `🖼️ Here are our room options:\n\n`;
    roomOptions.forEach((room, index) => {
      list += `${index + 1}. ${room.charAt(0).toUpperCase() + room.slice(1)}\n`;
    });
    list += `\n📸 Please reply with the *room name* or *option number* to view images.`;

    logToFile(`🤖 Bot Reply (image menu):\n${list}`);
    await chat.sendMessage(list);
    return;
  }

  const index = parseInt(msg) - 1;
  const roomKey = index >= 0 && index < roomOptions.length ? roomOptions[index] : msg;

  if (imageFolders[roomKey]) {
    const folderPath = path.join(__dirname, 'images', imageFolders[roomKey]);
    const images = fs.readdirSync(folderPath);

    for (const image of images) {
      const imagePath = path.join(folderPath, image);
      const media = MessageMedia.fromFilePath(imagePath);
      await chat.sendMessage(media);
      logToFile(`🖼️ Sent image: ${imagePath}`);
    }
    return;
  }

  try {
    const aiReply = await getAIResponse(msg);
    logToFile(`🤖 Bot Reply (AI):\n${aiReply}`);
    await chat.sendMessage(aiReply);
  } catch (err) {
    console.error('AI Error:', err);
    await chat.sendMessage('⚠️ Sorry, I’m having trouble responding right now. Please try again later.');
  }
}

client.on('qr', (qr) => {
  console.log('QR RECEIVED, scan this with your WhatsApp app:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('✅ WhatsApp client is ready!');

  // Ping every 13 minutes
  const targetNumber = '918547838091@c.us';
  setInterval(async () => {
    try {
      const chat = await client.getChatById(targetNumber);
      await chat.sendMessage('👋 Ping to keep the bot alive!');
      console.log('✅ Ping message sent');
    } catch (err) {
      console.error('❌ Ping failed:', err.message);
    }
  }, 13 * 60 * 1000);

  // Handle unread messages
  const chats = await client.getChats();
  for (const chat of chats) {
    if (chat.unreadCount > 0) {
      const messages = await chat.fetchMessages({ limit: chat.unreadCount });
      for (const message of messages) {
        if (!message.fromMe) {
          console.log(`📩 Handling unread message from ${chat.name || chat.id.user}: ${message.body}`);
          await handleMessage(message);
        }
      }
    }
  }
});

client.on('message', handleMessage);

client.initialize();

app.listen(port, () => {
  console.log(`🚀 Express server running on port ${port}`);
});