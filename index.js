require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const moment = require("moment");
const express = require("express");
const axios = require("axios"); // Используем axios для запросов
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

// Инициализация базы данных
const db = new sqlite3.Database("leaderboard.db");

db.serialize(() => {
  // Создаем таблицу для хранения результатов без уникального ограничения
  db.run(`CREATE TABLE IF NOT EXISTS leaderboard (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        score INTEGER,
        date TEXT
    )`);
});

// Список языков с путями к флагам (соответствуют поддерживаемым языкам LibreTranslate)
const languages = [
  { name: "Английский", code: "en", flag: "/flags/gb.png" },
  { name: "Испанский", code: "es", flag: "/flags/es.png" },
  { name: "Немецкий", code: "de", flag: "/flags/de.png" },
  { name: "Французский", code: "fr", flag: "/flags/fr.png" },
  { name: "Итальянский", code: "it", flag: "/flags/it.png" },
  { name: "Португальский", code: "pt", flag: "/flags/pt.png" },
  { name: "Польский", code: "pl", flag: "/flags/pl.png" },
  { name: "Турецкий", code: "tr", flag: "/flags/tr.png" },
  { name: "Китайский", code: "zh", flag: "/flags/cn.png" },
  { name: "Японский", code: "ja", flag: "/flags/jp.png" },
  // Добавьте другие поддерживаемые языки LibreTranslate
];

// Словарь для хранения данных пользователей
let usersData = {};

// Настройка Express
app.use(express.static(__dirname + "/public"));
app.use("/flags", express.static(__dirname + "/public/flags")); // Папка с флагами
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// Настройка Socket.IO
io.on("connection", async (socket) => {
  // Отправляем текущую таблицу лидеров при подключении
  const leaderboard = await getLeaderboard();
  socket.emit("leaderboard", leaderboard);

  // Обработчик события начала игры
  socket.on("startGame", async (username) => {
    const userId = socket.id;

    usersData[userId] = {
      username: username || "Игрок",
      score: 0,
      questionCount: 0,
      totalQuestions: 12, // Всего 12 вопросов
    };
    // Начинаем игру для этого пользователя
    startGame(userId, socket);
  });

  // Обработчик события ответа от пользователя
  socket.on("answer", async (data) => {
    const userId = socket.id;
    handleAnswer(userId, data, socket);
  });

  socket.on("disconnect", () => {
    // Удаляем данные пользователя, если необходимо
    delete usersData[socket.id];
  });
});

function startGame(userId, socket) {
  const userData = usersData[userId];

  if (userData.questionCount >= userData.totalQuestions) {
    // Игра окончена
    socket.emit("gameOver", {
      message: `Игра окончена! Ваш результат: ${userData.score} очков.`,
      score: userData.score,
    });
    // Обновляем таблицу лидеров и отправляем обновлённые данные клиенту
    updateLeaderboard(userData.username, userData.score).then(async () => {
      const leaderboard = await getLeaderboard();
      socket.emit("leaderboard", leaderboard);
    });
    return;
  }

  userData.roundPoints = 0; // Сброс очков раунда
  const currentWord = getRandomRussianWord();

  const correctLanguageObj = getRandomLanguage();

  translateWord(currentWord, correctLanguageObj.code).then((translatedWord) => {
    userData.currentWord = currentWord;
    userData.translatedWord = translatedWord;
    userData.correctLanguage = correctLanguageObj.name;
    userData.correctLanguageFlag = correctLanguageObj.flag; // Сохраняем флаг
    userData.startTime = new Date();
    userData.stage = 1; // Этап 1 - определение языка
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

    // Отправляем данные вопроса клиенту
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

// Функция для обработки ответа пользователя
async function handleAnswer(userId, data, socket) {
  const userData = usersData[userId];

  const endTime = new Date();
  const timeDiff = (endTime - userData.startTime) / 1000; // Время в секундах

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
    // Этап 1 - определение языка
    if (data.answer === userData.correctLanguage) {
      userData.score += points;
      userData.roundPoints += points; // Накопление очков раунда
      // Отправляем сообщение о правильном ответе
      socket.emit("correctAnswer", {
        message: "Правильно!",
      });

      // Переходим к следующему этапу
      userData.startTime = new Date();
      userData.stage = 2;

      // Генерируем неправильные варианты перевода
      generateFakeTranslations(userData.currentWord).then(
        (fakeTranslations) => {
          const options = [userData.currentWord];
          options.push(...fakeTranslations);
          options.sort(() => Math.random() - 0.5);

          // Отправляем данные для этапа 2
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

      userData.roundPoints = 0; // Сброс очков раунда
      // Переходим к следующему слову после задержки
      setTimeout(() => {
        startGame(userId, socket);
      }, 5000); // Увеличено до 5 секунд
    }
  } else if (userData.stage === 2) {
    // Этап 2 - определение перевода
    if (data.answer === userData.currentWord) {
      userData.score += points;
      userData.roundPoints += points;
      message = `Правильно!`;
    } else {
      message = `Неправильно. Правильный перевод: ${userData.currentWord}.`;
    }

    // Подготовка итогового сообщения за раунд
    let totalPointsMessage;
    if (userData.roundPoints > 0) {
      totalPointsMessage = `Вы получили +${userData.roundPoints} очков за раунд.`;
    } else if (userData.roundPoints < 0) {
      totalPointsMessage = `Вы потеряли ${userData.roundPoints} очков за раунд.`;
    } else {
      totalPointsMessage = `Вы не получили очков за раунд.`;
    }

    // Объединение сообщений
    message = `${message} ${totalPointsMessage}`;

    socket.emit("result", {
      message: message,
      score: userData.score,
      isCorrect: data.answer === userData.currentWord,
      correctAnswer: userData.currentWord,
      totalPointsForRound: userData.roundPoints,
      showCorrectAnswerImage: false,
    });

    userData.roundPoints = 0; // Сброс очков раунда
    // Переходим к следующему слову после задержки
    setTimeout(() => {
      startGame(userId, socket);
    }, 5000); // Увеличено до 5 секунд
  }
}

// Функции для работы с таблицей лидеров
function updateLeaderboard(name, score) {
  return new Promise((resolve, reject) => {
    const date = moment().format("YYYY-MM-DD");

    // Вставляем новую запись независимо от наличия предыдущих
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

// Получение случайного русского слова из файла
function getRandomRussianWord() {
  const wordsList = fs
    .readFileSync("words.txt", "utf-8")
    .split("\n")
    .map((word) => word.trim())
    .filter((word) => word);
  const randomIndex = Math.floor(Math.random() * wordsList.length);
  return wordsList[randomIndex];
}

// Получение случайного языка
function getRandomLanguage() {
  const randomIndex = Math.floor(Math.random() * languages.length);
  return languages[randomIndex];
}

// Функция для перевода слова с использованием LibreTranslate
function translateWord(word, targetLanguageCode) {
  return axios.post('https://libretranslate.com/translate', {
    q: word,
    source: 'ru',
    target: targetLanguageCode,
    format: 'text'
  })
  .then(response => {
    if (response.data && response.data.translatedText) {
      return response.data.translatedText;
    } else {
      return null;
    }
  })
  .catch(error => {
    console.error('Ошибка при переводе:', error);
    return null;
  });
}

// Генерация фейковых переводов
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

// Запуск сервера
const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

// Телеграм-бот
const bot = new Telegraf(process.env.BOT_TOKEN);

// Обработчик команды /start
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

// Обработчик данных от Web App
bot.on("web_app_data", (ctx) => {
  const data = JSON.parse(ctx.webAppData.data);
  ctx.reply(`Спасибо за игру! Ваш результат: ${data.score} очков.`);
  // Дополнительная обработка данных
});

// Запускаем бота
bot.launch();
console.log("Бот запущен");