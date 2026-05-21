let currentUser = null;
let currentTab = 'products';

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupEventListeners();
});

function setupEventListeners() {
    // Вкладки
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    
    // Фильтры товаров
    document.getElementById('searchProduct')?.addEventListener('input', debounce(loadProducts, 300));
    document.getElementById('filterCategory')?.addEventListener('change', loadProducts);
    document.getElementById('filterSupplier')?.addEventListener('change', loadProducts);
    document.getElementById('filterLowStock')?.addEventListener('change', loadProducts);
    document.getElementById('resetFilters')?.addEventListener('click', resetFilters);
    
    // Фильтры заказов
    document.getElementById('filterOrderType')?.addEventListener('change', loadOrders);
    document.getElementById('filterOrderStatus')?.addEventListener('change', loadOrders);
    
    // Кнопки
    document.getElementById('addProductBtn')?.addEventListener('click', () => openProductModal());
    document.getElementById('addSupplierBtn')?.addEventListener('click', openSupplierModal);
    document.getElementById('logoutBtn')?.addEventListener('click', logout);
    
    // Формы
    document.getElementById('productForm')?.addEventListener('submit', saveProduct);
    document.getElementById('supplierForm')?.addEventListener('submit', saveSupplier);
    
    // Закрытие модальных окон
    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', closeAllModals);
    });
    
    // Кнопка удаления фото
    document.getElementById('removeImageBtn')?.addEventListener('click', removeProductImage);
}

async function checkAuth() {
    try {
        const res = await fetch('/api/me');
        if (!res.ok) {
            window.location.href = '/login.html';
            return;
        }
        currentUser = await res.json();
        
        document.getElementById('userName').textContent = currentUser.full_name || currentUser.username;
        document.getElementById('userRole').textContent = currentUser.role === 'admin' ? '👑 Администратор' : '👤 ' + (currentUser.position || 'Сотрудник');
        
        if (currentUser.role === 'admin') {
            document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'block');
            document.getElementById('addProductBtn').style.display = 'block';
        }
        
        await loadInitialData();
        loadProducts();
    } catch (err) {
        window.location.href = '/login.html';
    }
}

async function loadInitialData() {
    try {
        // Загружаем категории
        const catRes = await fetch('/api/categories');
        const categories = await catRes.json();
        const catSelect = document.getElementById('filterCategory');
        const catModalSelect = document.getElementById('category_id');
        
        if (catSelect) {
            catSelect.innerHTML = '<option value="">Все категории</option>';
            categories.forEach(cat => {
                const prefix = cat.parent_id ? '— ' : '';
                catSelect.innerHTML += `<option value="${cat.id}">${prefix}${cat.name}</option>`;
            });
        }
        
        if (catModalSelect) {
            catModalSelect.innerHTML = '<option value="">Выберите категорию</option>';
            categories.forEach(cat => {
                const prefix = cat.parent_id ? '— ' : '';
                catModalSelect.innerHTML += `<option value="${cat.id}">${prefix}${cat.name}</option>`;
            });
        }
        
        // Загружаем поставщиков
        const supRes = await fetch('/api/suppliers');
        const suppliers = await supRes.json();
        const supSelect = document.getElementById('filterSupplier');
        const supModalSelect = document.getElementById('supplier_id');
        
        if (supSelect) {
            supSelect.innerHTML = '<option value="">Все поставщики</option>';
            suppliers.forEach(sup => {
                supSelect.innerHTML += `<option value="${sup.id}">${sup.company_name}</option>`;
            });
        }
        
        if (supModalSelect) {
            supModalSelect.innerHTML = '<option value="">Выберите поставщика</option>';
            suppliers.forEach(sup => {
                supModalSelect.innerHTML += `<option value="${sup.id}">${sup.company_name}</option>`;
            });
        }
    } catch (err) {
        console.error('Ошибка загрузки данных:', err);
    }
}

function switchTab(tab) {
    currentTab = tab;
    
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
    
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`${tab}Tab`)?.classList.add('active');
    
    // Загружаем данные для вкладки
    if (tab === 'products') loadProducts();
    else if (tab === 'orders') loadOrders();
    else if (tab === 'suppliers') loadSuppliers();
    else if (tab === 'statistics') loadStatistics();
}

async function loadProducts() {
    const container = document.getElementById('productsList');
    if (!container) return;
    
    container.innerHTML = '<div class="loading">Загрузка...</div>';
    
    try {
        const params = new URLSearchParams({
            search: document.getElementById('searchProduct')?.value || '',
            category: document.getElementById('filterCategory')?.value || '',
            supplier: document.getElementById('filterSupplier')?.value || '',
            low_stock: document.getElementById('filterLowStock')?.checked || false
        });
        
        const res = await fetch('/api/products?' + params);
        const products = await res.json();
        
        if (products.length === 0) {
            container.innerHTML = '<p class="no-data">Товары не найдены</p>';
            return;
        }
        
        let html = '';
        products.forEach(p => {
            const stockClass = p.quantity === 0 ? 'out-of-stock' : (p.quantity <= p.min_quantity ? 'low-stock' : '');
            
            // Экранируем описание
            let description = '';
            if (p.description) {
                description = p.description
                    .replace(/[&<>]/g, function(m) {
                        if (m === '&') return '&amp;';
                        if (m === '<') return '&lt;';
                        if (m === '>') return '&gt;';
                        return m;
                    })
                    .replace(/\n/g, '<br>');
            }
            
            html += `
                <div class="product-card ${stockClass}">
                    ${p.image_url ? `
                        <div class="product-image-container">
                            <img src="${p.image_url}" alt="${p.name}" class="product-image" onerror="this.src='/uploads/products/placeholder.png'">
                        </div>
                    ` : `
                        <div class="product-image-placeholder">📦</div>
                    `}
                    <div class="product-header">
                        <span class="category-badge">${p.category_icon || '📦'} ${p.category_name || 'Без категории'}</span>
                        <span class="sku">SKU: ${p.sku}</span>
                    </div>
                    <h3>${p.name}</h3>
                    ${p.supplier_name ? `<p class="supplier">🏢 ${p.supplier_name}</p>` : ''}
                    ${description ? `<div class="product-description">📝 ${description}</div>` : ''}
                    <div class="product-prices">
                        <span class="retail-price">${p.retail_price} ₽</span>
                        ${currentUser.role === 'admin' ? `<span class="purchase-price">Закуп: ${p.purchase_price} ₽</span>` : ''}
                    </div>
                    <div class="product-stock">
                        <span class="quantity ${p.quantity <= p.min_quantity ? 'warning' : ''}">
                            📊 ${p.quantity} ${p.unit || 'шт'}
                        </span>
                        ${p.quantity <= p.min_quantity ? '<span class="low-stock-badge">⚠️ Мало</span>' : ''}
                    </div>
                    ${p.location_in_store ? `<p class="location">📍 ${p.location_in_store}</p>` : ''}
                    ${currentUser.role === 'admin' ? `
                        <div class="product-actions">
                            <button onclick="editProduct(${p.id})" class="btn-icon">✏️</button>
                            <button onclick="deleteProduct(${p.id})" class="btn-icon">🗑️</button>
                        </div>
                    ` : ''}
                </div>
            `;
        });
        
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = '<p class="error">Ошибка загрузки товаров</p>';
    }
}

async function loadOrders() {
    const container = document.getElementById('ordersList');
    if (!container) return;
    
    container.innerHTML = '<div class="loading">📦 Загрузка заказов...</div>';
    
    try {
        const type = document.getElementById('filterOrderType')?.value || '';
        const status = document.getElementById('filterOrderStatus')?.value || '';
        
        let url = '/api/orders';
        const params = new URLSearchParams();
        if (type) params.append('type', type);
        if (status) params.append('status', status);
        if (params.toString()) url += '?' + params.toString();
        
        const res = await fetch(url);
        const orders = await res.json();
        
        if (orders.length === 0) {
            container.innerHTML = '<p class="no-data">📭 Заказы не найдены</p>';
            return;
        }
        
        const incoming = orders.filter(o => o.order_type === 'incoming').length;
        const outgoing = orders.filter(o => o.order_type === 'outgoing').length;
        
        let html = `
            <div class="orders-stats">
                <span class="stat-badge">📦 Всего: ${orders.length}</span>
                <span class="stat-badge incoming">📥 Приход: ${incoming}</span>
                <span class="stat-badge outgoing">📤 Расход: ${outgoing}</span>
            </div>
            <table class="orders-table">
                <thead>
                    <tr>
                        <th>Номер</th>
                        <th>Тип</th>
                        <th>Контрагент</th>
                        <th>Дата</th>
                        <th>Сумма</th>
                        <th>Статус</th>
                        <th>Оплата</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        orders.forEach(o => {
            const typeText = o.order_type === 'incoming' ? '📥 Приход' : '📤 Расход';
            const counterparty = o.order_type === 'incoming' 
                ? (o.supplier_name || 'Поставщик')
                : (o.customer_name || 'Покупатель');
            
            const date = o.order_date ? new Date(o.order_date).toLocaleDateString('ru-RU') : '—';
            
            html += `
                <tr>
                    <td><strong>${o.order_number}</strong></td>
                    <td>${typeText}</td>
                    <td>${counterparty}</td>
                    <td>${date}</td>
                    <td><strong>${formatMoney(o.total_amount)}</strong></td>
                    <td><span class="status-badge status-${o.status}">${getStatusText(o.status)}</span></td>
                    <td><span class="status-badge payment-${o.payment_status}">${getPaymentText(o.payment_status)}</span></td>
                </tr>
            `;
        });
        
        html += `</tbody></table>`;
        container.innerHTML = html;
    } catch (err) {
        console.error('❌ Ошибка загрузки заказов:', err);
        container.innerHTML = `<div class="error"><p>❌ Ошибка загрузки заказов</p><button onclick="loadOrders()" class="btn-secondary">🔄 Повторить</button></div>`;
    }
}

async function loadSuppliers() {
    const container = document.getElementById('suppliersList');
    if (!container) return;
    
    container.innerHTML = '<div class="loading">Загрузка...</div>';
    
    try {
        const res = await fetch('/api/suppliers');
        const suppliers = await res.json();
        
        if (suppliers.length === 0) {
            container.innerHTML = '<p class="no-data">Поставщики не найдены</p>';
            return;
        }
        
        let html = '';
        suppliers.forEach(s => {
            html += `
                <div class="supplier-card">
                    <h3>${s.company_name}</h3>
                    <p><strong>Контакт:</strong> ${s.contact_person || '—'}</p>
                    <p><strong>📞</strong> ${s.phone}</p>
                    <p><strong>✉️</strong> ${s.email || '—'}</p>
                    <p><strong>📍</strong> ${s.address || '—'}</p>
                    <p><strong>ИНН:</strong> ${s.inn || '—'}</p>
                    <p><strong>Рейтинг:</strong> ${'⭐'.repeat(Math.round(s.rating || 5))}</p>
                </div>
            `;
        });
        
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = '<p class="error">Ошибка загрузки поставщиков</p>';
    }
}

async function loadStatistics() {
    const container = document.getElementById('statsContainer');
    if (!container) return;
    
    container.innerHTML = '<div class="loading">📊 Загрузка статистики...</div>';
    
    try {
        const res = await fetch('/api/statistics');
        const stats = await res.json();
        const total = stats.total || {};
        
        const profit = (total.total_value || 0) - (total.total_cost || 0);
        const profitMargin = total.total_cost > 0 ? ((profit / total.total_cost) * 100).toFixed(1) : 0;
        
        let html = `
            <div class="stats-grid">
                <div class="stat-card primary">
                    <h3>📦 Товаров</h3>
                    <div class="stat-value">${total.total_products || 0}</div>
                    <small>В ${total.total_categories || 0} категориях</small>
                </div>
                <div class="stat-card success">
                    <h3>📊 Остаток</h3>
                    <div class="stat-value">${formatNumber(total.total_stock || 0)} шт</div>
                    <small>${formatMoney(total.total_value || 0)}</small>
                </div>
                <div class="stat-card info">
                    <h3>📈 Продаж</h3>
                    <div class="stat-value">${total.total_sales || 0}</div>
                    <small>Заказов</small>
                </div>
                <div class="stat-card success">
                    <h3>💵 Выручка</h3>
                    <div class="stat-value">${formatMoney(total.total_revenue || 0)}</div>
                    <small>Прибыль ${formatMoney(profit)}</small>
                </div>
                <div class="stat-card warning">
                    <h3>👥 Пользователей</h3>
                    <div class="stat-value">${total.total_users || 0}</div>
                    <small>🏢 Поставщиков: ${total.total_suppliers || 0}</small>
                </div>
                <div class="stat-card ${profit >= 0 ? 'success' : 'danger'}">
                    <h3>🎯 Маржа</h3>
                    <div class="stat-value">${profitMargin}%</div>
                    <small>Рентабельность</small>
                </div>
            </div>
        `;
        
        html += `<div class="stats-two-columns">`;
        html += `<div class="stats-column">`;
        
        if (stats.topProducts && stats.topProducts.length > 0) {
            html += `
                <div class="stats-section">
                    <h3>🔥 Топ-5 продаж</h3>
                    <table class="stats-table">
                        <thead><tr><th>Товар</th><th>Продано</th><th>Выручка</th></tr></thead>
                        <tbody>
                            ${stats.topProducts.map(p => `
                                <tr>
                                    <td>${p.name}</td>
                                    <td>${p.sold || 0} шт</td>
                                    <td>${formatMoney(p.revenue || 0)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
        
        if (stats.salesByCategory && stats.salesByCategory.length > 0) {
            html += `
                <div class="stats-section">
                    <h3>📂 По категориям</h3>
                    <table class="stats-table">
                        <thead><tr><th>Категория</th><th>Продано</th><th>Выручка</th></tr></thead>
                        <tbody>
                            ${stats.salesByCategory.map(c => `
                                <tr>
                                    <td>${c.category}</td>
                                    <td>${c.items_sold || 0} шт</td>
                                    <td>${formatMoney(c.revenue || 0)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
        
        html += `</div><div class="stats-column">`;
        
        if (stats.lowStock && stats.lowStock.length > 0) {
            html += `
                <div class="stats-section warning">
                    <h3>⚠️ Низкий остаток</h3>
                    <table class="stats-table">
                        <thead><tr><th>Товар</th><th>Остаток</th><th>Мин.</th></tr></thead>
                        <tbody>
                            ${stats.lowStock.map(p => `
                                <tr>
                                    <td>${p.name}</td>
                                    <td class="warning">${p.quantity || 0}</td>
                                    <td>${p.min_quantity || 0}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
        
        if (stats.recentOrders && stats.recentOrders.length > 0) {
            html += `
                <div class="stats-section">
                    <h3>🛒 Последние заказы</h3>
                    <table class="stats-table">
                        <thead><tr><th>Номер</th><th>Клиент/Поставщик</th><th>Сумма</th></tr></thead>
                        <tbody>
                            ${stats.recentOrders.map(o => {
                                const party = o.order_type === 'incoming' 
                                    ? (o.supplier_name || 'Поставщик')
                                    : (o.customer_name || 'Покупатель');
                                return `
                                    <tr>
                                        <td>${o.order_number}</td>
                                        <td>${party}</td>
                                        <td>${formatMoney(o.total_amount || 0)}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
        
        html += `</div></div>`;
        container.innerHTML = html;
    } catch (err) {
        console.error('❌ Ошибка загрузки статистики:', err);
        container.innerHTML = `<div class="error"><p>❌ Ошибка загрузки статистики</p><small>${err.message}</small></div>`;
    }
}

// CRUD функции для товаров
function openProductModal(product = null) {
    const modal = document.getElementById('productModal');
    const title = document.getElementById('modalTitle');
    
    if (product) {
        title.textContent = 'Редактировать товар';
        document.getElementById('productId').value = product.id;
        document.getElementById('sku').value = product.sku;
        document.getElementById('name').value = product.name;
        document.getElementById('category_id').value = product.category_id || '';
        document.getElementById('supplier_id').value = product.supplier_id || '';
        document.getElementById('purchase_price').value = product.purchase_price;
        document.getElementById('retail_price').value = product.retail_price;
        document.getElementById('quantity').value = product.quantity;
        document.getElementById('min_quantity').value = product.min_quantity;
        document.getElementById('barcode').value = product.barcode || '';
        document.getElementById('location_in_store').value = product.location_in_store || '';
        document.getElementById('description').value = product.description || '';
        
        // Показываем текущее фото, если есть
        if (product.image_url) {
            const preview = document.getElementById('imagePreview');
            const previewDiv = document.getElementById('currentImagePreview');
            preview.src = product.image_url;
            previewDiv.style.display = 'block';
        } else {
            document.getElementById('currentImagePreview').style.display = 'none';
        }
    } else {
        title.textContent = 'Добавить товар';
        document.getElementById('productForm').reset();
        document.getElementById('productId').value = '';
        document.getElementById('currentImagePreview').style.display = 'none';
        document.getElementById('productImage').value = '';
    }
    
    modal.style.display = 'block';
}

async function editProduct(id) {
    try {
        const res = await fetch(`/api/products/${id}`);
        const product = await res.json();
        openProductModal(product);
    } catch (err) {
        alert('Ошибка загрузки товара');
    }
}

async function deleteProduct(id) {
    if (!confirm('Удалить товар?')) return;
    try {
        await fetch(`/api/products/${id}`, { method: 'DELETE' });
        loadProducts();
    } catch (err) {
        alert('Ошибка удаления');
    }
}

async function uploadProductImage(productId, file) {
    const formData = new FormData();
    formData.append('image', file);
    
    try {
        const res = await fetch(`/api/products/${productId}/upload`, {
            method: 'POST',
            body: formData
        });
        
        if (res.ok) {
            const data = await res.json();
            return data.image_url;
        } else {
            throw new Error('Ошибка загрузки');
        }
    } catch (err) {
        alert('Не удалось загрузить фото');
        return null;
    }
}

async function removeProductImage() {
    const productId = document.getElementById('productId').value;
    if (!productId) return;
    
    if (!confirm('Удалить фото товара?')) return;
    
    try {
        const res = await fetch(`/api/products/${productId}/image`, {
            method: 'DELETE'
        });
        
        if (res.ok) {
            document.getElementById('currentImagePreview').style.display = 'none';
            document.getElementById('imagePreview').src = '';
            alert('Фото удалено');
        } else {
            throw new Error('Ошибка удаления');
        }
    } catch (err) {
        alert('Ошибка удаления фото');
    }
}

async function saveProduct(e) {
    e.preventDefault();
    
    const id = document.getElementById('productId').value;
    const product = {
        name: document.getElementById('name').value,
        category_id: document.getElementById('category_id').value || null,
        supplier_id: document.getElementById('supplier_id').value || null,
        purchase_price: document.getElementById('purchase_price').value,
        retail_price: document.getElementById('retail_price').value,
        quantity: document.getElementById('quantity').value,
        min_quantity: document.getElementById('min_quantity').value,
        barcode: document.getElementById('barcode').value,
        location_in_store: document.getElementById('location_in_store').value,
        description: document.getElementById('description').value
    };
    
    if (!id) product.sku = document.getElementById('sku').value || null;
    
    try {
        const url = id ? `/api/products/${id}` : '/api/products';
        const method = id ? 'PUT' : 'POST';
        
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(product)
        });
        
        if (res.ok) {
            const savedProduct = await res.json();
            
            // Если есть файл фото, загружаем
            const imageFile = document.getElementById('productImage').files[0];
            if (imageFile && savedProduct.id) {
                await uploadProductImage(savedProduct.id, imageFile);
            }
            
            closeAllModals();
            loadProducts();
        } else {
            const error = await res.json();
            alert(error.error || 'Ошибка сохранения');
        }
    } catch (err) {
        alert('Ошибка сети');
    }
}

// CRUD для поставщиков
function openSupplierModal() {
    document.getElementById('supplierModal').style.display = 'block';
}

async function saveSupplier(e) {
    e.preventDefault();
    
    const supplier = {
        company_name: document.getElementById('supplierName').value,
        contact_person: document.getElementById('contactPerson').value,
        email: document.getElementById('supplierEmail').value,
        phone: document.getElementById('supplierPhone').value,
        address: document.getElementById('supplierAddress').value,
        inn: document.getElementById('supplierInn').value,
        payment_terms: document.getElementById('paymentTerms').value
    };
    
    try {
        const res = await fetch('/api/suppliers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(supplier)
        });
        
        if (res.ok) {
            closeAllModals();
            loadSuppliers();
            loadInitialData();
        }
    } catch (err) {
        alert('Ошибка сохранения');
    }
}

function resetFilters() {
    document.getElementById('searchProduct').value = '';
    document.getElementById('filterCategory').value = '';
    document.getElementById('filterSupplier').value = '';
    document.getElementById('filterLowStock').checked = false;
    loadProducts();
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    document.getElementById('productImage').value = '';
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
}

// Вспомогательные функции
function getStatusText(status) {
    const map = {
        'draft': 'Черновик',
        'pending': 'Ожидает',
        'processing': 'В обработке',
        'completed': 'Завершен',
        'cancelled': 'Отменен'
    };
    return map[status] || status;
}

function getPaymentText(status) {
    const map = {
        'unpaid': 'Не оплачен',
        'partial': 'Частично',
        'paid': 'Оплачен'
    };
    return map[status] || status;
}

function formatMoney(amount) {
    return new Intl.NumberFormat('ru-RU').format(amount || 0) + ' ₽';
}

function formatNumber(num) {
    return new Intl.NumberFormat('ru-RU').format(num || 0);
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Глобальные функции для onclick
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.closeModal = closeAllModals;
window.closeSupplierModal = closeAllModals;