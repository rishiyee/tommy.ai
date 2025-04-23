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
- If the user asks about booking, say: _"Our team will contact you as soon as possible."_
- ❗ Never confirm a booking yourself. Just provide info or say someone will reach out.`;

  const result = await model.generateContent({
    contents: [{ parts: [{ text: prompt }] }], 
  });

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

// Handling 429 Too Many Requests error with retry logic
async function callAPIWithRetry(userMessage, retryCount = 0) {
  try {
    const aiReply = await getAIResponse(userMessage);
    logToFile(`🤖 Bot Reply (AI):\n${aiReply}`);
    return aiReply;
  } catch (error) {
    if (error.response && error.response.status === 429) {
      const retryDelay = error.response.data.error.details.find(detail => detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo').retryDelay;
      console.log(`Too many requests. Retrying in ${retryDelay} seconds...`);

      // Retry after the suggested delay
      const delay = parseInt(retryDelay) * 1000; // Convert retryDelay from seconds to milliseconds
      await new Promise(resolve => setTimeout(resolve, delay));

      // Retry logic with an increasing retry count
      if (retryCount < 3) {
        return callAPIWithRetry(userMessage, retryCount + 1);
      } else {
        console.error('Max retry attempts reached.');
        return 'Our team will contact you as soon as possible.'; // Updated fallback message
      }
    } else {
      console.error('API Error:', error.message);
      return 'Our team will contact you as soon as possible.'; // Updated fallback message
    }
  }
}

// Store user first messages
let firstMessage = {};  // Store if the user has received the greeting

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
  }, 13 * 60 * 1000); // Ping every 13 minutes
});

client.on('message', async (message) => {
  const chat = await message.getChat();
  const msg = message.body.trim().toLowerCase();
  const sender = message.from;
  const time = new Date().toLocaleString();

  // Log the incoming message to log.txt
  logToFile(`📩 [${time}] Message from ${sender}: ${message.body}`);

  // Check if it's the user's first message (by user ID or phone number)
  if (!firstMessage[sender]) {
    // Send greeting only the first time
    const greeting = '🌺 Namasthe from Chembarathi Wayanad! 🌺 How can I assist you today?';
    await message.reply(greeting);  // This sends the greeting
    firstMessage[sender] = true;  // Mark as greeted
    logToFile(`🤖 Bot Reply (Greeting):\n${greeting}`);
  }

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

    logToFile(`🤖 Bot Reply (image menu):\n${list}`);
    await message.reply(list);  // This sends a reply in the same thread
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
      await message.reply(media);  // This sends the image in the same thread

      logToFile(`🖼️ Sent image: ${imagePath}`);
    }
    return;
  }

  // Otherwise use Gemini AI with retry logic
  try {
    const aiReply = await callAPIWithRetry(msg);
    logToFile(`🤖 Bot Reply (AI):\n${aiReply}`);
    await message.reply(aiReply);  // This sends a reply in the same thread
  } catch (err) {
    console.error('AI Error:', err);
    await message.reply('Our team will contact you as soon as possible.'); // Updated fallback message
  }
});

client.initialize();
app.listen(port, () => {
  console.log(`🚀 Express server running on port ${port}`);
});
