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

// Constants and Configurations
const { Client, MessageMedia, LocalAuth } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MAX_HISTORY_LENGTH = 10;
const PORT = process.env.PORT || 4000;
const PING_INTERVAL = 13 * 60 * 1000; // 13 minutes
const TARGET_NUMBER = '918547838091@c.us';

// Environment Variables
const {
  SUPABASE_URL,
  SUPABASE_KEY: SUPABASE_SERVICE_KEY,
  GEMINI_API_KEY
} = process.env;

// Initialize Services
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
const userConversations = new Map();
const firstMessage = new Map();

// Image Configuration
const imageFolders = {
  'deluxe lawn view': 'deluxe_lawn_view',
  'premium mountain view': 'premium_mountain_view',
  'pool villa': 'pool_villa',
  'deluxe pool forest view': 'deluxe_pool_forest_view',
  'honeymoon suite': 'honeymoon_suite',
  'premium pool mountain view': 'premium_pool_mountain_view'
};

const imageTriggerWords = ['photo', 'photos', 'images', 'img', 'pics', 'pictures', 'pic'];
const bookingKeywords = ['book', 'booking', 'reserve', 'reservation', 'check-in', 'check in', 'checkin'];

// Add this constant at the top with other constants
const BOOKING_RESPONSE = `🌸 Thank you for choosing Chembarathi Wayanad!
To proceed with your booking, please share the following details:
👤 Name
🏡 Preferred Room Type
📅 Check-in Date
📅 Check-out Date
👨‍👩‍👧‍👦 Number of Guests (Adults & Children)

*Please contact us directly at:*
📞 *Phone*: +91 85478 38091
📧 *Email*: info@chembarathiwayanad.com`;

// Utility Functions
function logToFile(logMessage) {
  const logPath = path.join(__dirname, 'log.txt');
  const timestamp = new Date().toLocaleString();
  const logEntry = `[${timestamp}] ${logMessage}\n`;
  fs.appendFileSync(logPath, logEntry, 'utf8');
}

async function fetchRoomDetailsFromSupabase() {
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('room_name, rate, description, size, check_in_time, check_out_time')
      .order('rate', { ascending: true });

    if (error) throw error;

    return data.map(room => (
      `🏡 *${room.room_name}* (${room.size} sq. ft.)\n` +
      `💸 Rate: *₹${room.rate}*\n` +
      `📝 ${room.description}\n` +
      `🕐 Check-in: ${room.check_in_time}, Check-out: ${room.check_out_time}\n`
    )).join('\n\n');
  } catch (error) {
    console.error('Error fetching room details:', error);
    return '';
  }
}

// AI Response Handling
async function getAIResponse(userMessage, sender) {
  if (!userConversations.has(sender)) {
    userConversations.set(sender, []);
  }
  const conversationHistory = userConversations.get(sender);

  // Handle booking requests
  if (bookingKeywords.some(keyword => userMessage.toLowerCase().includes(keyword))) {
    updateConversationHistory(conversationHistory, userMessage, BOOKING_RESPONSE);
    return BOOKING_RESPONSE;
  }

  try {
    const dynamicContext = await fetchRoomDetailsFromSupabase();
    conversationHistory.push({ role: 'user', content: userMessage });
    
    while (conversationHistory.length > MAX_HISTORY_LENGTH) {
      conversationHistory.shift();
    }

    const historyText = conversationHistory
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');

    const prompt = generatePrompt(dynamicContext, historyText, userMessage);
    const result = await model.generateContent({
      contents: [{ parts: [{ text: prompt }] }]
    });

    const aiReply = result.response.text();
    updateConversationHistory(conversationHistory, null, aiReply);
    return aiReply;
  } catch (error) {
    console.error('AI Response Error:', error);
    throw error;
  }
}

function updateConversationHistory(history, userMessage, aiReply) {
  if (userMessage) history.push({ role: 'user', content: userMessage });
  if (aiReply) history.push({ role: 'assistant', content: aiReply });
}

function generatePrompt(dynamicContext, historyText, userMessage) {
  return `You are a helpful and polite assistant for a boutique resort called Chembarathi Wayanad.

Room Details:
${dynamicContext}

Previous conversation:
${historyText}

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
- Include Emoji
- Maintain conversation context and refer to previous messages when relevant
- NEVER provide booking assistance or accept bookings
- If user asks about booking, direct them to contact via phone or email
- Do not share the booking form or booking details`;
}

// Message Handling
async function handleImageRequest(message) {
  const roomOptions = Object.keys(imageFolders);
  let list = `🖼️ Here are our room options:\n\n`;
  roomOptions.forEach((room, index) => {
    list += `${index + 1}. ${room.charAt(0).toUpperCase() + room.slice(1)}\n`;
  });
  list += `\n📸 Please reply with the *room name* or *option number* to view images.`;
  logToFile(`🤖 Bot Reply (image menu):\n${list}`);
  await message.reply(list);
}

async function sendRoomImages(message, roomKey) {
  const folderPath = path.join(__dirname, 'images', imageFolders[roomKey]);
  try {
    const images = fs.readdirSync(folderPath);
    for (const image of images) {
      const imagePath = path.join(folderPath, image);
      const media = MessageMedia.fromFilePath(imagePath);
      await message.reply(media);
      logToFile(`🖼️ Sent image: ${imagePath}`);
    }
  } catch (error) {
    console.error('Error sending images:', error);
    await message.reply('Sorry, there was an error loading the images.');
  }
}

async function handleMessage(message) {
  const msg = message.body.trim().toLowerCase();
  const sender = message.from;
  const time = new Date().toLocaleString();

  logToFile(`📩 [${time}] Message from ${sender}: ${message.body}`);

  // Handle first-time messages
  if (!firstMessage.has(sender)) {
    const greeting = '🌺 Namasthe from Chembarathi Wayanad! 🌺 ';
    await message.reply(greeting);
    firstMessage.set(sender, true);
    logToFile(`🤖 Bot Reply (Greeting):\n${greeting}`);
  }

  // Handle image requests
  if (imageTriggerWords.some(word => msg.includes(word))) {
    await handleImageRequest(message);
    return;
  }

  // Handle room selection
  const roomOptions = Object.keys(imageFolders);
  const index = parseInt(msg) - 1;
  const roomKey = index >= 0 && index < roomOptions.length ? roomOptions[index] : msg;

  if (imageFolders[roomKey]) {
    await sendRoomImages(message, roomKey);
    return;
  }

  // Handle general queries
  try {
    const aiReply = await getAIResponse(msg, sender);
    logToFile(`🤖 Bot Reply (AI):\n${aiReply}`);
    await message.reply(aiReply);
  } catch (error) {
    console.error('Message handling error:', error);
    await message.reply('Our team will contact you as soon as possible.');
  }
}

// WhatsApp Client Setup
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox'],
  },
});

client.on('qr', (qr) => {
  console.log('QR RECEIVED, scan this with your WhatsApp app:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp client is ready!');
  setInterval(async () => {
    try {
      const chat = await client.getChatById(TARGET_NUMBER);
      await chat.sendMessage('👋 Ping to keep the bot alive!');
      console.log('✅ Ping message sent');
    } catch (err) {
      console.error('❌ Ping failed:', err.message);
    }
  }, PING_INTERVAL);
});

client.on('message', handleMessage);

// Express Server Setup
const app = express();
app.use(express.static(path.join(__dirname, 'images')));

// Initialize Services
client.initialize();
app.listen(PORT, () => {
  console.log(`🚀 Express server running on port ${PORT}`);
});
