const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const path = require('path');
require('dotenv').config();

const dbModule = require('./db');
const { requireAuth, requireAdmin } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'supersecretkey123',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 }
}));

// Инициализация БД перед запуском сервера
dbModule.initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('❌ Не удалось инициализировать БД:', err);
    process.exit(1);
});

// Получение пула БД
function getPool() {
    return dbModule.pool;
}

// ============ СТРАНИЦЫ ============
app.get('/', (req, res) => {
    if (req.session.user) {
        res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
    } else {
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
});

app.get('/setup', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});

// ============ API НАСТРОЙКА (СОЗДАНИЕ АДМИНА) ============
app.post('/api/setup', async (req, res) => {
    console.log('📥 Запрос на создание пользователя');
    
    const { secret, username, password, full_name, role } = req.body;
    
    // Проверка секретного ключа
    if (secret !== process.env.SESSION_SECRET) {
        console.log('❌ Неверный секретный ключ');
        return res.status(403).json({ error: 'Неверный секретный ключ' });
    }
    
    // Проверка обязательных полей
    if (!username || !password || !full_name) {
        return res.status(400).json({ error: 'Логин, пароль и имя обязательны' });
    }
    
    if (password.length < 4) {
        return res.status(400).json({ error: 'Пароль должен быть минимум 4 символа' });
    }
    
    try {
        const pool = getPool();
        
        // Проверяем, существует ли пользователь
        const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Пользователь с таким логином уже существует' });
        }
        
        // Хешируем пароль
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Создаем пользователя
        await pool.query(
            `INSERT INTO users (username, password, role, full_name, is_active) 
             VALUES (?, ?, ?, ?, TRUE)`,
            [username, hashedPassword, role || 'admin', full_name]
        );
        
        console.log(`✅ Пользователь ${username} (${role || 'admin'}) создан`);
        res.json({ 
            success: true, 
            message: `Пользователь ${username} успешно создан` 
        });
        
    } catch (err) {
        console.error('❌ Ошибка создания пользователя:', err);
        res.status(500).json({ error: 'Ошибка сервера: ' + err.message });
    }
});

// ============ API АУТЕНТИФИКАЦИЯ ============
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }
    
    try {
        const pool = getPool();
        const [rows] = await pool.query(
            'SELECT * FROM users WHERE username = ? AND is_active = TRUE', 
            [username]
        );
        
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }

        const user = rows[0];
        const match = await bcrypt.compare(password, user.password);
        
        if (!match) {
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }

        await pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role,
            full_name: user.full_name
        };

        console.log(`✅ Вход: ${user.username} (${user.role})`);
        
        res.json({ 
            success: true, 
            user: req.session.user
        });
    } catch (err) {
        console.error('❌ Ошибка при логине:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    res.json(req.session.user);
});

// ============ API КАТЕГОРИИ ============
app.get('/api/categories', requireAuth, async (req, res) => {
    try {
        const pool = getPool();
        const [categories] = await pool.query(`
            SELECT * FROM categories 
            WHERE is_active = TRUE 
            ORDER BY name
        `);
        res.json(categories);
    } catch (err) {
        console.error('❌ Ошибка получения категорий:', err);
        res.status(500).json({ error: 'Ошибка БД' });
    }
});

// ============ API ПОСТАВЩИКИ ============
app.get('/api/suppliers', requireAuth, async (req, res) => {
    try {
        const pool = getPool();
        const [suppliers] = await pool.query(`
            SELECT * FROM suppliers 
            WHERE is_active = TRUE 
            ORDER BY company_name
        `);
        res.json(suppliers);
    } catch (err) {
        console.error('❌ Ошибка получения поставщиков:', err);
        res.status(500).json({ error: 'Ошибка БД' });
    }
});

// ============ API ТОВАРЫ ============
app.get('/api/products', requireAuth, async (req, res) => {
    try {
        const { search } = req.query;
        const pool = getPool();
        
        let query = `
            SELECT 
                p.*,
                c.name as category_name,
                s.company_name as supplier_name
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN suppliers s ON p.supplier_id = s.id
            WHERE p.is_active = TRUE
        `;
        const params = [];
        
        if (search) {
            query += ' AND (p.name LIKE ? OR p.sku LIKE ?)';
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern);
        }
        
        query += ' ORDER BY p.name';
        
        const [products] = await pool.query(query, params);
        res.json(products);
    } catch (err) {
        console.error('❌ Ошибка получения товаров:', err);
        res.status(500).json({ error: 'Ошибка БД' });
    }
});

app.get('/api/products/:id', requireAuth, async (req, res) => {
    try {
        const pool = getPool();
        const [product] = await pool.query(`
            SELECT 
                p.*,
                c.name as category_name,
                s.company_name as supplier_name
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN suppliers s ON p.supplier_id = s.id
            WHERE p.id = ?
        `, [req.params.id]);
        
        if (product.length === 0) {
            return res.status(404).json({ error: 'Товар не найден' });
        }
        res.json(product[0]);
    } catch (err) {
        console.error('❌ Ошибка получения товара:', err);
        res.status(500).json({ error: 'Ошибка БД' });
    }
});

app.post('/api/products', requireAdmin, async (req, res) => {
    const { 
        sku, name, category_id, supplier_id, description, 
        purchase_price, retail_price, quantity, min_quantity, 
        barcode, location_in_store 
    } = req.body;
    
    if (!name || !retail_price || quantity === undefined) {
        return res.status(400).json({ error: 'Название, цена и количество обязательны' });
    }
    
    try {
        const pool = getPool();
        const productSku = sku || `SKU-${Date.now()}`;
        
        const [result] = await pool.query(
            `INSERT INTO products 
            (sku, name, category_id, supplier_id, description, purchase_price, retail_price, 
             quantity, min_quantity, barcode, location_in_store) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [productSku, name, category_id, supplier_id, description, purchase_price || 0, retail_price,
             quantity, min_quantity || 10, barcode, location_in_store]
        );
        
        const [newProduct] = await pool.query(`
            SELECT 
                p.*,
                c.name as category_name,
                s.company_name as supplier_name
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN suppliers s ON p.supplier_id = s.id
            WHERE p.id = ?
        `, [result.insertId]);
        
        res.json(newProduct[0]);
    } catch (err) {
        console.error('❌ Ошибка создания товара:', err);
        res.status(500).json({ error: 'Ошибка создания товара' });
    }
});

app.put('/api/products/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { 
        name, category_id, supplier_id, description, 
        purchase_price, retail_price, quantity, min_quantity,
        barcode, location_in_store, is_active 
    } = req.body;
    
    try {
        const pool = getPool();
        await pool.query(
            `UPDATE products SET 
                name = ?, category_id = ?, supplier_id = ?, description = ?,
                purchase_price = ?, retail_price = ?, quantity = ?, min_quantity = ?,
                barcode = ?, location_in_store = ?, is_active = ?
            WHERE id = ?`,
            [name, category_id, supplier_id, description, purchase_price, retail_price,
             quantity, min_quantity, barcode, location_in_store, is_active, id]
        );
        
        const [updated] = await pool.query(`
            SELECT 
                p.*,
                c.name as category_name,
                s.company_name as supplier_name
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN suppliers s ON p.supplier_id = s.id
            WHERE p.id = ?
        `, [id]);
        
        if (updated.length === 0) {
            return res.status(404).json({ error: 'Товар не найден' });
        }
        res.json(updated[0]);
    } catch (err) {
        console.error('❌ Ошибка обновления товара:', err);
        res.status(500).json({ error: 'Ошибка обновления' });
    }
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
    try {
        const pool = getPool();
        await pool.query('UPDATE products SET is_active = FALSE WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Ошибка удаления товара:', err);
        res.status(500).json({ error: 'Ошибка удаления' });
    }
});

// ============ API ЗАКАЗЫ ============
app.get('/api/orders', requireAuth, async (req, res) => {
    try {
        const { type, status } = req.query;
        const pool = getPool();
        
        let query = `
            SELECT 
                o.*,
                s.company_name as supplier_name,
                u.full_name as created_by_name
            FROM orders o
            LEFT JOIN suppliers s ON o.supplier_id = s.id
            LEFT JOIN users u ON o.created_by = u.id
            WHERE 1=1
        `;
        const params = [];
        
        if (type) {
            query += ' AND o.order_type = ?';
            params.push(type);
        }
        if (status) {
            query += ' AND o.status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY o.order_date DESC LIMIT 100';
        
        console.log('📦 Запрос заказов:', { type, status });
        
        const [orders] = await pool.query(query, params);
        console.log(`✅ Найдено заказов: ${orders.length}`);
        
        res.json(orders);
    } catch (err) {
        console.error('❌ Ошибка получения заказов:', err);
        res.status(500).json({ error: 'Ошибка БД: ' + err.message });
    }
});

// Получение позиций заказа
app.get('/api/orders/:id/items', requireAuth, async (req, res) => {
    try {
        const pool = getPool();
        const [items] = await pool.query(`
            SELECT 
                oi.*,
                p.name as product_name,
                p.sku as product_sku,
                p.retail_price
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = ?
        `, [req.params.id]);
        res.json(items);
    } catch (err) {
        console.error('❌ Ошибка получения позиций заказа:', err);
        res.status(500).json({ error: 'Ошибка БД' });
    }
});

// ============ API СТАТИСТИКА (УПРОЩЕННАЯ) ============
app.get('/api/statistics', requireAdmin, async (req, res) => {
    try {
        const pool = getPool();
        
        // 1. Общая статистика
        const [totalStats] = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM products WHERE is_active = TRUE) as total_products,
                (SELECT COALESCE(SUM(quantity), 0) FROM products WHERE is_active = TRUE) as total_stock,
                (SELECT COALESCE(ROUND(SUM(quantity * retail_price), 2), 0) FROM products WHERE is_active = TRUE) as total_value,
                (SELECT COALESCE(ROUND(SUM(quantity * purchase_price), 2), 0) FROM products WHERE is_active = TRUE) as total_cost,
                (SELECT COUNT(*) FROM orders WHERE order_type = 'outgoing' AND status = 'completed') as total_sales,
                (SELECT COALESCE(ROUND(SUM(total_amount), 2), 0) FROM orders WHERE order_type = 'outgoing' AND status = 'completed') as total_revenue,
                (SELECT COUNT(*) FROM users WHERE is_active = TRUE) as total_users,
                (SELECT COUNT(*) FROM suppliers WHERE is_active = TRUE) as total_suppliers,
                (SELECT COUNT(*) FROM categories WHERE is_active = TRUE) as total_categories
        `);
        
        // 2. Топ-5 товаров по продажам
        let topProducts = [];
        try {
            const [products] = await pool.query(`
                SELECT 
                    p.name,
                    COALESCE(SUM(oi.quantity), 0) as sold,
                    COALESCE(ROUND(SUM(oi.total_price), 2), 0) as revenue
                FROM products p
                LEFT JOIN order_items oi ON p.id = oi.product_id
                LEFT JOIN orders o ON oi.order_id = o.id AND o.order_type = 'outgoing' AND o.status = 'completed'
                WHERE p.is_active = TRUE
                GROUP BY p.id, p.name
                HAVING sold > 0
                ORDER BY sold DESC
                LIMIT 5
            `);
            topProducts = products;
        } catch (err) {
            console.warn('⚠️ Топ товаров не загружен:', err.message);
        }
        
        // 3. Товары с низким остатком
        let lowStock = [];
        try {
            const [stock] = await pool.query(`
                SELECT 
                    p.name,
                    p.quantity,
                    p.min_quantity,
                    s.company_name as supplier_name
                FROM products p
                LEFT JOIN suppliers s ON p.supplier_id = s.id
                WHERE p.is_active = TRUE AND p.quantity <= p.min_quantity
                ORDER BY p.quantity ASC
                LIMIT 5
            `);
            lowStock = stock;
        } catch (err) {
            console.warn('⚠️ Низкий остаток не загружен:', err.message);
        }
        
        // 4. Последние заказы
        let recentOrders = [];
        try {
            const [orders] = await pool.query(`
                SELECT 
                    o.order_number,
                    o.order_type,
                    o.customer_name,
                    o.total_amount,
                    o.status,
                    s.company_name as supplier_name
                FROM orders o
                LEFT JOIN suppliers s ON o.supplier_id = s.id
                ORDER BY o.order_date DESC
                LIMIT 5
            `);
            recentOrders = orders;
        } catch (err) {
            console.warn('⚠️ Последние заказы не загружены:', err.message);
        }
        
        // 5. Продажи по категориям
        let salesByCategory = [];
        try {
            const [categories] = await pool.query(`
                SELECT 
                    c.name as category,
                    COALESCE(SUM(oi.quantity), 0) as items_sold,
                    COALESCE(ROUND(SUM(oi.total_price), 2), 0) as revenue
                FROM categories c
                LEFT JOIN products p ON c.id = p.category_id
                LEFT JOIN order_items oi ON p.id = oi.product_id
                LEFT JOIN orders o ON oi.order_id = o.id AND o.order_type = 'outgoing' AND o.status = 'completed'
                WHERE c.is_active = TRUE
                GROUP BY c.id, c.name
                HAVING items_sold > 0
                ORDER BY revenue DESC
                LIMIT 5
            `);
            salesByCategory = categories;
        } catch (err) {
            console.warn('⚠️ Продажи по категориям не загружены:', err.message);
        }
        
        res.json({
            total: totalStats[0] || {
                total_products: 0,
                total_stock: 0,
                total_value: 0,
                total_cost: 0,
                total_sales: 0,
                total_revenue: 0,
                total_users: 0,
                total_suppliers: 0,
                total_categories: 0
            },
            topProducts: topProducts || [],
            lowStock: lowStock || [],
            recentOrders: recentOrders || [],
            salesByCategory: salesByCategory || []
        });
        
    } catch (err) {
        console.error('❌ Ошибка получения статистики:', err);
        res.json({
            total: {
                total_products: 0,
                total_stock: 0,
                total_value: 0,
                total_cost: 0,
                total_sales: 0,
                total_revenue: 0,
                total_users: 0,
                total_suppliers: 0,
                total_categories: 0
            },
            topProducts: [],
            lowStock: [],
            recentOrders: [],
            salesByCategory: []
        });
    }
});