const socket = io();

let username;
let score = 0;
let questionCount = 0;
let totalQuestions = 12;
let startTime = null;
let selectedButton = null; // Для подсветки выбранного ответа

// Функция для сохранения и загрузки имени пользователя
function saveUsername(name) {
  localStorage.setItem('username', name);
}

function loadUsername() {
  return localStorage.getItem('username');
}

// При загрузке страницы
window.onload = () => {
  const savedUsername = loadUsername();
  if (savedUsername) {
    username = savedUsername;
    document.getElementById('displayName').textContent = username;
    showRulesModal();
  } else {
    showNameModal();
  }
};

// Функция для отображения модального окна ввода имени
function showNameModal() {
  const nameModal = document.getElementById('nameModal');
  nameModal.style.display = 'block';

  document.getElementById('saveUsernameBtn').onclick = function() {
    const inputName = document.getElementById('usernameInput').value.trim();
    if (inputName) {
      username = inputName;
      saveUsername(username);
      document.getElementById('displayName').textContent = username;
      nameModal.style.display = 'none';
      showRulesModal();
    } else {
      alert('Пожалуйста, введите ваше имя.');
    }
  };
}

// Функция для отображения модального окна с правилами
function showRulesModal() {
  const rulesModal = document.getElementById('rulesModal');
  rulesModal.style.display = 'block';

  document.getElementById('closeRulesBtn').onclick = function() {
    rulesModal.style.display = 'none';
    // Начинаем игру
    socket.emit('startGame', username);
    document.getElementById('game').style.display = 'block';
  };
}

// Обработчики для модального окна таблицы лидеров
document.querySelector('.close').onclick = function() {
  const modal = document.getElementById('leaderboardModal');
  modal.style.display = 'none';
};

window.onclick = function(event) {
  const modal = document.getElementById('leaderboardModal');
  if (event.target == modal) {
    modal.style.display = 'none';
  }
};

// Обработка получения вопроса от сервера
socket.on('question', (data) => {
  // Очищаем область для вариантов ответа
  const optionsContainer = document.getElementById('options');
  optionsContainer.innerHTML = '';

  // Обновляем счет, номер вопроса и имя игрока
  score = data.score;
  questionCount = data.questionCount;
  totalQuestions = data.totalQuestions;
  document.getElementById('scoreDisplay').textContent = `Очки: ${score}`;
  document.getElementById('questionCounter').textContent = `Вопрос: ${questionCount}/${totalQuestions}`;

  // Выводим сообщение (вопрос)
  document.getElementById('message').textContent = data.message;

  if (data.stage === 1) {
    // Этап 1: Отображаем загаданное слово
    document.getElementById('wordDisplay').textContent = data.word;

    data.options.forEach((option) => {
      const button = document.createElement('button');

      // Создаём элемент div для обертки содержимого кнопки
      const contentDiv = document.createElement('div');
      contentDiv.classList.add('button-content');

      // Создаём элемент изображения
      const img = document.createElement('img');
      img.src = option.flag;
      img.alt = option.name;
      img.classList.add('flag-image'); // Добавляем класс для изображения

      // Создаём элемент для названия языка
      const span = document.createElement('span');
      span.textContent = option.name;

      // Добавляем изображение и текст в обертку
      contentDiv.appendChild(img);
      contentDiv.appendChild(span);

      // Добавляем обертку в кнопку
      button.appendChild(contentDiv);

      button.addEventListener('click', () => sendAnswer(option.name, button));
      optionsContainer.appendChild(button);
    });
  } else if (data.stage === 2) {
    // Этап 2: Отображаем слово и варианты перевода
    document.getElementById('wordDisplay').textContent = data.word;

    data.options.forEach((option) => {
      const button = document.createElement('button');

      // Создаём элемент div для обертки содержимого кнопки
      const contentDiv = document.createElement('div');
      contentDiv.classList.add('button-content');

      const span = document.createElement('span');
      span.textContent = option;

      contentDiv.appendChild(span);
      button.appendChild(contentDiv);

      button.addEventListener('click', () => sendAnswer(option, button));
      optionsContainer.appendChild(button);
    });
  }

  startTime = new Date();
});

// Обработка результата от сервера
socket.on('result', (data) => {
  // Отображаем результат на месте загаданного слова
  if (data.showCorrectAnswerImage) {
    // Создаём элемент для отображения флага и названия языка
    const resultDiv = document.getElementById('wordDisplay');
    resultDiv.innerHTML = '';

    const container = document.createElement('div');
    container.classList.add('correct-answer-display');

    const img = document.createElement('img');
    img.src = data.flag;
    img.alt = data.correctLanguage;

    const span = document.createElement('span');
    span.textContent = data.correctLanguage;

    container.appendChild(img);
    container.appendChild(span);

    resultDiv.appendChild(container);

    // Добавляем сообщение
    const messageSpan = document.createElement('span');
    messageSpan.classList.add('result-message');
    messageSpan.textContent = data.message;
    resultDiv.appendChild(messageSpan);
  } else {
    document.getElementById('wordDisplay').innerHTML = `<span class="result-message">${data.message}</span>`;
  }

  // Обновляем очки
  score = data.score;
  document.getElementById('scoreDisplay').textContent = `Очки: ${score}`;

  // Подсветка ответов
  if (data.isCorrect) {
    selectedButton.classList.add('correct');
  } else {
    selectedButton.classList.add('incorrect');

    const buttons = document.querySelectorAll('#options button');
    buttons.forEach((button) => {
      if (button.textContent === data.correctAnswer) {
        button.classList.add('correct');
      }
    });
  }

  // Очищаем сообщение
  document.getElementById('message').textContent = '';
});

// Обработка правильного ответа на первый вопрос (переход ко второй части)
socket.on('correctAnswer', (data) => {
  // Отображаем сообщение "Правильно!" зелёным цветом
  document.getElementById('wordDisplay').innerHTML = `<span class="result-message" style="color: green;">Правильно!</span>`;

  // Очищаем сообщение
  document.getElementById('message').textContent = '';
});

// Обработка окончания игры
socket.on('gameOver', (data) => {
  // Скрываем игровой экран
  document.getElementById('game').style.display = 'none';

  // Отображаем модальное окно окончания игры
  const gameOverModal = document.getElementById('gameOverModal');
  gameOverModal.style.display = 'block';
  document.getElementById('finalScore').textContent = data.message;
});

// Обработчик для кнопки "Закрыть" в модальном окне окончания игры
document.getElementById('closeGameOverBtn').addEventListener('click', () => {
  // Скрываем модальное окно
  const gameOverModal = document.getElementById('gameOverModal');
  gameOverModal.style.display = 'none';

  // Отображаем таблицу лидеров и кнопку "Попробовать снова"
  document.getElementById('leaderboard').style.display = 'block';
  document.getElementById('retryBtn').style.display = 'block';
});

// Обновление таблицы лидеров
socket.on('leaderboard', (leaderboard) => {
  const topPlayersList = document.getElementById('top-players');
  topPlayersList.innerHTML = '';
  leaderboard.slice(0, 3).forEach((player, index) => {
    const li = document.createElement('li');

    let trophy = '';
    if (index === 0) {
      trophy = '🏆 ';
      li.classList.add('first-place');
    } else if (index === 1) {
      trophy = '🥈 ';
      li.classList.add('second-place');
    } else if (index === 2) {
      trophy = '🥉 ';
      li.classList.add('third-place');
    }

    li.innerHTML = `${trophy}${player.name}: ${player.score} очков`;
    topPlayersList.appendChild(li);
  });

  // Обработчик для отображения топ-10 игроков
  document.getElementById('showAllBtn').onclick = function() {
    const modal = document.getElementById('leaderboardModal');
    const top10PlayersList = document.getElementById('top-10-players');
    top10PlayersList.innerHTML = '';
    leaderboard.forEach((player, index) => {
      const li = document.createElement('li');

      let trophy = '';
      if (index === 0) {
        trophy = '🏆 ';
        li.classList.add('first-place');
      } else if (index === 1) {
        trophy = '🥈 ';
        li.classList.add('second-place');
      } else if (index === 2) {
        trophy = '🥉 ';
        li.classList.add('third-place');
      }

      li.innerHTML = `${trophy}${player.name}: ${player.score} очков`;
      top10PlayersList.appendChild(li);
    });
    modal.style.display = 'block';
  };
});

// Функция для отправки ответа на сервер
function sendAnswer(answer, buttonElement) {
  const endTime = new Date();
  const timeDiff = (endTime - startTime) / 1000; // Время в секундах

  socket.emit('answer', { answer: answer, time: timeDiff });

  // Блокируем кнопки после выбора ответа
  const buttons = document.querySelectorAll('#options button');
  buttons.forEach((button) => (button.disabled = true));

  // Сохраняем выбранную кнопку для подсветки
  selectedButton = buttonElement;
}

// Обработчик для кнопки "Попробовать снова"
document.getElementById('retryBtn').addEventListener('click', () => {
  // Скрываем элементы
  document.getElementById('leaderboard').style.display = 'none';
  document.getElementById('retryBtn').style.display = 'none';

  // Сбрасываем необходимые переменные
  score = 0;
  questionCount = 0;

  // Запускаем игру заново
  socket.emit('startGame', username);
  document.getElementById('game').style.display = 'block';
});