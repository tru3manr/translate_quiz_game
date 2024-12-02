require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const moment = require("moment");
const express = require("express");
const axios = require("axios");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

// Инициализация базы данных
const db = new sqlite3.Database("leaderboard.db");

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS leaderboard (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        score INTEGER,
        date TEXT
    )`);
});

// Список языков с путями к флагам
const languages = [
  { name: "Английский", code: "en", flag: "/flags/gb.png" },
  { name: "Чешский", code: "cs", flag: "/flags/cz.png" },
  { name: "Немецкий", code: "de", flag: "/flags/de.png" },
  { name: "Датский", code: "da", flag: "/flags/dk.png" },
  { name: "Испанский", code: "es", flag: "/flags/es.png" },
  { name: "Финский", code: "fi", flag: "/flags/fi.png" },
  { name: "Французский", code: "fr", flag: "/flags/fr.png" },
  { name: "Хорватский", code: "hr", flag: "/flags/hr.png" },
  { name: "Венгерский", code: "hu", flag: "/flags/hu.png" },
  { name: "Итальянский", code: "it", flag: "/flags/it.png" },
  { name: "Голландский", code: "nl", flag: "/flags/nl.png" },
  { name: "Норвежский", code: "no", flag: "/flags/no.png" },
  { name: "Польский", code: "pl", flag: "/flags/pl.png" },
  { name: "Португальский", code: "pt", flag: "/flags/pt.png" },
  { name: "Румынский", code: "ro", flag: "/flags/ro.png" },
  { name: "Сербский", code: "sr", flag: "/flags/rs.png" },
  { name: "Шведский", code: "sv", flag: "/flags/se.png" },
  { name: "Словацкий", code: "sk", flag: "/flags/sk.png" },
  { name: "Турецкий", code: "tr", flag: "/flags/tr.png" }
];

// Словарь для хранения данных пользователей
let usersData = {};

// Кэш для хранения переводов
const translationCache = {};

// Настройка Express
app.use(express.static(__dirname + "/public"));
app.use("/flags", express.static(__dirname + "/public/flags"));
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// Настройка Socket.IO
io.on("connection", async (socket) => {
  const leaderboard = await getLeaderboard();
  socket.emit("leaderboard", leaderboard);

  socket.on("startGame", async (username) => {
    const userId = socket.id;
    usersData[userId] = {
      username: username || "Игрок",
      score: 0,
      questionCount: 0,
      totalQuestions: 12,
    };
    startGame(userId, socket);
  });

  socket.on("answer", async (data) => {
    const userId = socket.id;
    handleAnswer(userId, data, socket);
  });

  socket.on("disconnect", () => {
    delete usersData[socket.id];
  });
});

async function startGame(userId, socket) {
  const userData = usersData[userId];

  if (userData.questionCount >= userData.totalQuestions) {
    socket.emit("gameOver", {
      message: `Игра окончена! Ваш результат: ${userData.score} очков.`,
      score: userData.score,
    });
    updateLeaderboard(userData.username, userData.score).then(async () => {
      const leaderboard = await getLeaderboard();
      socket.emit("leaderboard", leaderboard);
    });
    return;
  }

  userData.roundPoints = 0;
  const currentWord = getRandomRussianWord();
  const correctLanguageObj = getRandomLanguage();

  await delay(200); // Задержка 200 мс перед каждым переводом
  translateWord(currentWord, correctLanguageObj.code).then((translatedWord) => {
    userData.currentWord = currentWord;
    userData.translatedWord = translatedWord;
    userData.correctLanguage = correctLanguageObj.name;
    userData.correctLanguageFlag = correctLanguageObj.flag;
    userData.startTime = new Date();
    userData.stage = 1;
    userData.questionCount++;

    const options = [
      { name: correctLanguageObj.name, flag: correctLanguageObj.flag },
    ];
    while (options.length < 4) {
      const langObj = getRandomLanguage();
      if (!options.find((option) => option.name === langObj.name)) {
        options.push({ name: langObj.name, flag: langObj.flag });
      }
    }

    options.sort(() => Math.random() - 0.5);

    socket.emit("question", {
      stage: 1,
      word: userData.translatedWord,
      options: options,
      score: userData.score,
      questionCount: userData.questionCount,
      totalQuestions: userData.totalQuestions,
      message: "На каком языке это слово?",
    });
  });
}

async function handleAnswer(userId, data, socket) {
  const userData = usersData[userId];

  const endTime = new Date();
  const timeDiff = (endTime - userData.startTime) / 1000;

  let points;
  if (timeDiff <= 2) {
    points = 300;
  } else if (timeDiff >= 10) {
    points = 100;
  } else {
    points = Math.round(300 - (timeDiff - 2) * (200 / 8));
  }

  let message;

  if (userData.stage === 1) {
    if (data.answer === userData.correctLanguage) {
      userData.score += points;
      userData.roundPoints += points;
      socket.emit("correctAnswer", {
        message: "Правильно!",
      });

      userData.startTime = new Date();
      userData.stage = 2;

      generateFakeTranslations(userData.currentWord).then(
        (fakeTranslations) => {
          const options = [userData.currentWord];
          options.push(...fakeTranslations);
          options.sort(() => Math.random() - 0.5);

          socket.emit("question", {
            stage: 2,
            word: userData.translatedWord,
            options: options,
            score: userData.score,
            questionCount: userData.questionCount,
            totalQuestions: userData.totalQuestions,
            message: "А угадаете, как оно переводится?",
          });
        }
      );
    } else {
      userData.score -= 150;
      userData.roundPoints -= 150;
      message = `Неправильно. -150 очков! Правильный перевод: "${userData.currentWord}".`;

      socket.emit("result", {
        message: message,
        score: userData.score,
        isCorrect: false,
        correctAnswer: userData.correctLanguage,
        totalPointsForRound: userData.roundPoints,
        showCorrectAnswerImage: true,
        flag: userData.correctLanguageFlag,
        correctLanguage: userData.correctLanguage,
        });

        userData.roundPoints = 0;
        setTimeout(() => {
        startGame(userId, socket);
        }, 3000); // Сократили время до 3 секунд
        }
        } else if (userData.stage === 2) {
        if (data.answer === userData.currentWord) {
        userData.score += points;
        userData.roundPoints += points;
        message = `Правильно!`;
        } else {
        message = `Неправильно. Правильный перевод: ${userData.currentWord}.`;
        }

        let totalPointsMessage;
        if (userData.roundPoints > 0) {
        totalPointsMessage = `Вы получили +${userData.roundPoints} очков за раунд.`;
        } else if (userData.roundPoints < 0) {
        totalPointsMessage = `Вы потеряли ${Math.abs(userData.roundPoints)} очков за раунд.`;
        } else {
        totalPointsMessage = `Вы не получили очков за раунд.`;
        }

        message = `${message} ${totalPointsMessage}`;

        socket.emit("result", {
        message: message,
        score: userData.score,
        isCorrect: data.answer === userData.currentWord,
        correctAnswer: userData.currentWord,
        totalPointsForRound: userData.roundPoints,
        showCorrectAnswerImage: false,
        });

        userData.roundPoints = 0;
        setTimeout(() => {
        startGame(userId, socket);
        }, 3000); // Сократили время до 3 секунд
        }
        }

        function updateLeaderboard(name, score) {
        return new Promise((resolve, reject) => {
        const date = moment().format("YYYY-MM-DD");
        db.run(
        `INSERT INTO leaderboard (name, score, date) VALUES (?, ?, ?)`,
        [name, score, date],
        function (err) {
        if (err) {
          console.error(err);
          reject(err);
        } else {
          resolve();
        }
        }
        );
        });
        }

        function getLeaderboard() {
        return new Promise((resolve, reject) => {
        const date = moment().format("YYYY-MM-DD");
        db.all(
        `SELECT name, score FROM leaderboard WHERE date = ? ORDER BY score DESC LIMIT 10`,
        [date],
        (err, rows) => {
        if (err) {
          console.error(err);
          reject(err);
        } else {
          resolve(rows);
        }
        }
        );
        });
        }

        function getRandomRussianWord() {
        const wordsList = fs
        .readFileSync("words.txt", "utf-8")
        .split("\n")
        .map((word) => word.trim())
        .filter((word) => word);
        const randomIndex = Math.floor(Math.random() * wordsList.length);
        return wordsList[randomIndex];
        }

        function getRandomLanguage() {
        const randomIndex = Math.floor(Math.random() * languages.length);
        return languages[randomIndex];
        }

        async function translateWord(word, targetLanguageCode) {
        const cacheKey = `${word}-${targetLanguageCode}`;
        if (translationCache[cacheKey]) {
        return translationCache[cacheKey];
        }
        try {
        const response = await axios.get('https://api.mymemory.translated.net/get', {
        params: {
        q: word,
        langpair: `ru|${targetLanguageCode}`,
        de: 'rtrusevich@gmail.com'  // Замените на ваш email
        }
        });
        if (response.data.responseStatus === 403) {
        console.error('Достигнут дневной лимит переводов');
        return null;
        }
        if (response.data && response.data.responseData) {
        const translation = response.data.responseData.translatedText;
        translationCache[cacheKey] = translation;
        return translation;
        } else {
        console.error('Unexpected response:', response.data);
        return null;
        }
        } catch (error) {
        console.error('Ошибка при переводе:', error.message);
        return null;
        }
        }

        function generateFakeTranslations(correctWord) {
        return new Promise((resolve, reject) => {
        const wordsList = fs
        .readFileSync("words.txt", "utf-8")
        .split("\n")
        .map((word) => word.trim())
        .filter((word) => word && word !== correctWord);

        const fakeTranslations = [];
        while (fakeTranslations.length < 3) {
        const randomIndex = Math.floor(Math.random() * wordsList.length);
        const word = wordsList[randomIndex];
        if (!fakeTranslations.includes(word)) {
        fakeTranslations.push(word);
        }
        }
        resolve(fakeTranslations);
        });
        }

        function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
        }

        const PORT = process.env.PORT || 3000;

        http.listen(PORT, () => {
        console.log(`Сервер запущен на порту ${PORT}`);
        });

        const bot = new Telegraf(process.env.BOT_TOKEN);

        bot.start((ctx) => {
        ctx.reply(
        "Привет! Нажмите кнопку ниже, чтобы начать игру:",
        Markup.keyboard([
        Markup.button.webApp(
        "Начать игру",
        "https://75248b24-e76f-444c-a795-808659869aec-00-ixqtk81uciw6.kirk.replit.dev/" // Замените на ваш адрес
        ),
        ]).resize()
        );
        });

        bot.on("web_app_data", (ctx) => {
        const data = JSON.parse(ctx.webAppData.data);
        ctx.reply(`Спасибо за игру! Ваш результат: ${data.score} очков.`);
        });

        bot.launch();
        console.log("Бот запущен");