const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

let dbPool;

async function initDatabase() {
    try {
        console.log('🔧 Проверка базы данных...');
        
        const dbName = process.env.DB_NAME || 'stationery_db';
        
        // Создаем временное соединение для создания БД
        const tempConnection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || ''
        }).promise();
        
        await tempConnection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
        await tempConnection.end();
        
        // Создаем пул с указанием БД
        dbPool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: dbName,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            multipleStatements: true
        }).promise();
        
        // Проверяем, есть ли таблицы
        const [tables] = await dbPool.query(`
            SELECT COUNT(*) as count FROM information_schema.TABLES 
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'
        `, [dbName]);
        
        if (tables[0].count === 0) {
            console.log('📦 База данных пуста. Запускаю инициализацию...');
            
            const sqlPath = path.join(__dirname, 'init.sql');
            
            if (!fs.existsSync(sqlPath)) {
                console.warn('⚠️ Файл init.sql не найден!');
                await createMinimalTables();
            } else {
                await executeSqlFileOrdered(sqlPath);
            }
        } else {
            console.log('✅ Таблицы уже существуют');
        }
        
        module.exports.pool = dbPool;
        console.log('🚀 База данных готова к работе');
        
    } catch (err) {
        console.error('❌ Ошибка инициализации БД:', err);
        throw err;
    }
}

async function executeSqlFileOrdered(filePath) {
    let sqlContent = fs.readFileSync(filePath, 'utf8');
    
    // Удаляем комментарии
    sqlContent = sqlContent.replace(/--.*$/gm, '');
    
    // Разделяем на категории запросов
    const dropStatements = [];
    const createTableStatements = [];
    const insertStatements = [];
    const indexStatements = [];
    const selectStatements = [];
    
    // Разбиваем по точке с запятой
    const statements = sqlContent.split(';').map(s => s.trim()).filter(s => s.length > 0);
    
    for (const stmt of statements) {
        const upperStmt = stmt.toUpperCase();
        
        if (upperStmt.startsWith('DROP')) {
            dropStatements.push(stmt);
        } else if (upperStmt.includes('CREATE TABLE')) {
            createTableStatements.push(stmt);
        } else if (upperStmt.startsWith('INSERT')) {
            insertStatements.push(stmt);
        } else if (upperStmt.includes('CREATE INDEX') || upperStmt.includes('ALTER TABLE')) {
            indexStatements.push(stmt);
        } else if (upperStmt.startsWith('SELECT')) {
            selectStatements.push(stmt);
        }
    }
    
    console.log(`📝 Найдено: ${createTableStatements.length} таблиц, ${insertStatements.length} вставок, ${indexStatements.length} индексов`);
    
    // 1. Создаем таблицы
    for (const stmt of createTableStatements) {
        try {
            await dbPool.query(stmt);
            const tableName = stmt.match(/CREATE TABLE.*?(\w+)\s*\(/i);
            if (tableName) {
                console.log(`✅ Таблица ${tableName[1]} создана`);
            }
        } catch (err) {
            if (!err.message.includes('already exists')) {
                console.error(`❌ Ошибка создания таблицы:`, err.message);
            }
        }
    }
    
    // 2. Вставляем данные
    for (const stmt of insertStatements) {
        try {
            await dbPool.query(stmt);
            const tableName = stmt.match(/INSERT INTO\s+(\w+)/i);
            if (tableName) {
                console.log(`✅ Данные в ${tableName[1]} добавлены`);
            }
        } catch (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                console.log(`⚠️ Пропуск дубликата`);
            } else {
                console.error(`❌ Ошибка вставки:`, err.message);
            }
        }
    }
    
    // 3. Создаем индексы ПОСЛЕ всех таблиц
    for (const stmt of indexStatements) {
        try {
            await dbPool.query(stmt);
            console.log(`✅ Индекс создан`);
        } catch (err) {
            if (!err.message.includes('Duplicate key')) {
                console.error(`❌ Ошибка индекса:`, err.message);
            }
        }
    }
    
    console.log('✅ Инициализация из SQL файла завершена');
}

async function createMinimalTables() {
    await dbPool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            role ENUM('admin', 'employee') NOT NULL DEFAULT 'employee',
            full_name VARCHAR(100) NOT NULL,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✅ Создана минимальная таблица users');
}

module.exports = { 
    pool: dbPool, 
    initDatabase 
};