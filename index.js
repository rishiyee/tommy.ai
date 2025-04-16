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
                 `Reply in a friendly, informative way.\n` +
                 `the lists should be more readle by adding the bulletpoints\n` +
                 `You should send message very readable by adding emojis and text styles. \n ` +
                 `the replies should be less that 40 words`;
                 `You should send message very readable by adding emojis and text styles.`;

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

// Room image folders mapped to keywords
const imageFolders = {
  'deluxe lawn view': 'deluxe_lawn_view',
  'premium mountain view': 'premium_mountain_view',
  'pool villa': 'pool_villa',
  'deluxe pool forest view': 'deluxe_pool_forest_view',
  'honeymoon suite': 'honeymoon_suite',
  'premium pool mountain view': 'premium_pool_mountain_view'
};

// Log function to backup to log.txt
function logToFile(logMessage) {
  const logPath = path.join(__dirname, 'log.txt');
  const timestamp = new Date().toLocaleString();
  const logEntry = `[${timestamp}] ${logMessage}\n`;
  fs.appendFileSync(logPath, logEntry, 'utf8');
}

client.on('qr', (qr) => {
  console.log('QR RECEIVED, scan this with your WhatsApp app:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
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
});

client.on('message', async (message) => {
  const chat = await message.getChat();
  const msg = message.body.trim().toLowerCase();
  const sender = message.from;
  const time = new Date().toLocaleString();

  // Log the incoming message to log.txt
  logToFile(`📩 [${time}] Message from ${sender}: ${message.body}`);

  // Define keywords for image trigger
  const imageTriggerWords = ['photo', 'photos', 'images', 'img', 'pics', 'pictures', 'pic'];
  const roomOptions = Object.keys(imageFolders);

  // If the message is a photo/image trigger
  if (imageTriggerWords.some(word => msg.includes(word))) {
    let list = `🖼️ Here are our room options:\n\n`;
    roomOptions.forEach((room, index) => {
      list += `${index + 1}. ${room.charAt(0).toUpperCase() + room.slice(1)}\n`;
    });
    list += `\n📸 Please reply with the *room name* or *option number* to view images.`;

    // Log the bot's reply to log.txt
    logToFile(`🤖 Bot Reply (image menu):\n${list}`);
    await chat.sendMessage(list);
    return;
  }

  // If the message is a room name or number
  const index = parseInt(msg) - 1;
  const roomKey = index >= 0 && index < roomOptions.length ? roomOptions[index] : msg;

  if (imageFolders[roomKey]) {
    const folderPath = path.join(__dirname, 'images', imageFolders[roomKey]);
    const images = fs.readdirSync(folderPath);

    for (const image of images) {
      const imagePath = path.join(folderPath, image);
      const media = MessageMedia.fromFilePath(imagePath);
      await chat.sendMessage(media);

      // Log the bot's sent image to log.txt
      logToFile(`🖼️ Sent image: ${imagePath}`);
    }
    return;
  }

  // Otherwise use Gemini AI
  try {
    const aiReply = await getAIResponse(msg);

    // Log the AI response to log.txt
    logToFile(`🤖 Bot Reply (AI):\n${aiReply}`);
    await chat.sendMessage(aiReply);
  } catch (err) {
    console.error('AI Error:', err);
    await chat.sendMessage('⚠️ Sorry, I’m having trouble responding right now. Please try again later.');
  }
});

client.initialize();
app.listen(port, () => {
  console.log(`🚀 Express server running on port ${port}`);
});
