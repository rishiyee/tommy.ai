import dotenv from 'dotenv';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

// Load environment variables from .env file
dotenv.config();

const { Client, MessageMedia, LocalAuth } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Access keys from .env file
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Supabase setup
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Gemini AI setup
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

async function fetchRoomDetailsFromSupabase() {
  const { data, error } = await supabase
    .from('rooms')
    .select('room_name, rate, description, size, check_in_time, check_out_time')
    .order('rate', { ascending: true });

  if (error) {
    console.error('Error fetching room details:', error);
    return '';
  }

  return data.map(room => (
    `🏡 *${room.room_name}* (${room.size} sq. ft.)\n` +
    `💸 Rate: *₹${room.rate}*\n` +
    `📝 ${room.description}\n` +
    `🕐 Check-in: ${room.check_in_time}, Check-out: ${room.check_out_time}\n`
  )).join('\n\n');
}

async function getAIResponse(userMessage) {
  const dynamicContext = await fetchRoomDetailsFromSupabase();

  const prompt = `You are a helpful and polite assistant for a boutique resort called Chembarathi Wayanad.

Room Details:
${dynamicContext}

User asked:
${userMessage}

Guidelines for reply:
- Be friendly, informative, and under 40 words.
- Use emojis and formatting (*bold*, _italics_) to improve readability.
- Prices must be in *bold* (e.g., ₹8,500).
- Even if rooms have same rates, treat them as separate and list them all.
- Need only * instead ** 
- Don't send various cottages and villas starting from ₹8000.
- dont send room details in each message, only send them if asked
- Include Emoji`;

  const result = await model.generateContent({
    contents: [{ parts: [{ text: prompt }] }]
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

async function callAPIWithRetry(userMessage, retryCount = 0) {
  try {
    const aiReply = await getAIResponse(userMessage);
    logToFile(`🤖 Bot Reply (AI):\n${aiReply}`);
    return aiReply;
  } catch (error) {
    if (error.response && error.response.status === 429) {
      const retryDelay = error.response.data.error.details.find(detail => detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo').retryDelay;
      const delay = parseInt(retryDelay) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      if (retryCount < 3) {
        return callAPIWithRetry(userMessage, retryCount + 1);
      } else {
        console.error('Max retry attempts reached.');
        return 'Our team will contact you as soon as possible.';
      }
    } else {
      console.error('API Error:', error.message);
      return 'Our team will contact you as soon as possible.';
    }
  }
}

let firstMessage = {};

client.on('qr', (qr) => {
  console.log('QR RECEIVED, scan this with your WhatsApp app:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp client is ready!');
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

  logToFile(`📩 [${time}] Message from ${sender}: ${message.body}`);

  if (!firstMessage[sender]) {
    const greeting = '🌺 Namasthe from Chembarathi Wayanad! 🌺 ';
    await message.reply(greeting);
    firstMessage[sender] = true;
    logToFile(`🤖 Bot Reply (Greeting):\n${greeting}`);
  }

  const imageTriggerWords = ['photo', 'photos', 'images', 'img', 'pics', 'pictures', 'pic'];
  const roomOptions = Object.keys(imageFolders);

  if (imageTriggerWords.some(word => msg.includes(word))) {
    let list = `🖼️ Here are our room options:\n\n`;
    roomOptions.forEach((room, index) => {
      list += `${index + 1}. ${room.charAt(0).toUpperCase() + room.slice(1)}\n`;
    });
    list += `\n📸 Please reply with the *room name* or *option number* to view images.`;
    logToFile(`🤖 Bot Reply (image menu):\n${list}`);
    await message.reply(list);
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
      await message.reply(media);
      logToFile(`🖼️ Sent image: ${imagePath}`);
    }
    return;
  }

  try {
    const aiReply = await callAPIWithRetry(msg);
    logToFile(`🤖 Bot Reply (AI):\n${aiReply}`);
    await message.reply(aiReply);
  } catch (err) {
    console.error('AI Error:', err);
    await message.reply('Our team will contact you as soon as possible.');
  }
});

client.initialize();
app.listen(port, () => {
  console.log(`🚀 Express server running on port ${port}`);
});
