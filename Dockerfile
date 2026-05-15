# Используем официальный образ Node.js
FROM node:18-alpine

# Устанавливаем необходимые системные зависимости
RUN apk add --no-cache \
    mysql-client \
    bash

# Создаём директорию приложения
WORKDIR /app

# Копируем файлы package.json
COPY package*.json ./

# Устанавливаем зависимости (используем npm install вместо ci)
RUN npm install --production && npm cache clean --force

# Копируем исходный код
COPY . .

# Создаём директорию для загрузок
RUN mkdir -p /app/uploads

# Устанавливаем права
RUN chown -R node:node /app

# Переключаемся на непривилегированного пользователя
USER node

# Открываем порт
EXPOSE 3000

# Проверка здоровья контейнера
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/', (r) => {r.statusCode === 200 ? process.exit(0) : process.exit(1)})"

# Запускаем приложение
CMD ["npm", "start"]