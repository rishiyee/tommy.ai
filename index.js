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

// Store message threads for each WhatsApp number
const messageThreads = new Map();

// Function to get or create a thread for a number
function getThread(number) {
  if (!messageThreads.has(number)) {
    messageThreads.set(number, []);
  }
  return messageThreads.get(number);
}

// Function to add message to thread
function addToThread(number, message, isBot = false) {
  const thread = getThread(number);
  thread.push({
    message,
    timestamp: new Date(),
    isBot
  });
  // Keep only last 10 messages in thread
  if (thread.length > 10) {
    thread.shift();
  }
}

async function getAIResponse(userMessage, context) {
  const prompt = `You are a helpful and polite assistant for a boutique resort called Chembarathi Wayanad.

Context:
${botContext}

Recent conversation:
${context}

User asked:
${userMessage}

Guidelines for response:
1. If this is the first message in the conversation (no context), provide this greeting:
"Namaste! 😊 Welcome to Chembarathi Wayanad! I'm your virtual assistant and I can help you with:
• Viewing room photos and details
• Checking room availability and pricing
• Providing information about our amenities
• Answering questions about our location and services
• Assisting with booking inquiries

How may I assist you today?"

2. For all other responses:
- Be friendly, informative, and concise
- Use emojis and text formatting (like *bold* or _italics_) to improve readability
- Use bullet points when listing items
- Prices must be in *bold* and formatted like in the context
- If the user asks about booking, say: _"Our team will contact you soon to confirm the booking."_
- Never confirm a booking yourself. Just provide info or say someone will reach out.
- reply should be under 50 words
- Don't use **hello** for bold text; use *hello* instead.

Please provide a helpful and relevant response based on these guidelines.`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Error generating AI response:', error);
    throw error;
  }
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

  // Check if message is audio
  if (message.hasMedia && message.type === 'ptt') {
    const audioResponse = "Our team will contact you shortly.";
    logToFile(`🎵 [${time}] Audio message received from ${sender}`);
    await chat.sendMessage(audioResponse);
    addToThread(sender, audioResponse, true);
    return;
  }

  // Add user message to thread
  addToThread(sender, message.body);

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
    addToThread(sender, list, true);
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
      addToThread(sender, `[Image: ${image}]`, true);
    }
    return;
  }

  try {
    // Get conversation context from thread
    const thread = getThread(sender);
    const context = thread.map(msg => `${msg.isBot ? 'Bot' : 'User'}: ${msg.message}`).join('\n');
    
    const aiReply = await getAIResponse(msg, context);
    logToFile(`🤖 Bot Reply (AI):\n${aiReply}`);
    await chat.sendMessage(aiReply);
    addToThread(sender, aiReply, true);
  } catch (err) {
    console.error('AI Error:', err);
    const errorMsg = '⚠️ Sorry, I\'m having trouble responding right now. Please try again later.';
    await chat.sendMessage(errorMsg);
    addToThread(sender, errorMsg, true);
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
