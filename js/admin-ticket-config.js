import { apiPost } from './api-client.js';
import { escapeHtml, makeDirtyTracker, showLoading } from './common-ui.js';
import { applyUrgencyConfig, ensureTicketConfigLoaded, resetTicketConfigCache, ticketConfigCache } from './tickets.js';

// ── ADMIN: TICKET CONFIG — categories/subcategories/urgencies ──
// Order is set by drag-and-drop, not manual numbers — dropping re-numbers the whole
// list ((index+1)*10) and persists every row whose order actually changed.
export async function loadTicketConfigAdminPage() {
    showLoading(true);
    resetTicketConfigCache(); // this screen is the source of truth — force a refetch
    await ensureTicketConfigLoaded();
    showLoading(false);
    renderTicketConfigCategories();
    renderTicketConfigUrgencies();
}

var draggedCategoryId = null;
var draggedSubcategoryId = null;
var draggedUrgencyId = null;

function renderTicketConfigCategories() {
    var container = document.getElementById('tcCategoriesList');
    container.innerHTML = '';
    var categories = ticketConfigCache.categories;
    if (!categories.length) { container.innerHTML = '<p style="color:var(--muted);font-size:13px">אין קטגוריות עדיין.</p>'; return; }
    categories.forEach(function (c) {
        var card = document.createElement('div');
        card.className = 'tc-category-card';
        card.draggable = true;
        var subsHtml = c.subcategories.map(function (s) {
            return '<div class="tc-sub-row" data-sub-id="' + s.id + '" draggable="true">' +
                '<span class="tc-sub-row-left"><span class="tc-drag-handle" title="גרירה לסידור מחדש">⠿</span>' +
                escapeHtml(s.name) + (s.isDynamic ? ' <span style="color:var(--muted);font-size:11px">(דינמי)</span>' : '') + '</span>' +
                '<span class="admin-row-actions">' +
                '<button type="button" class="icon-button" data-edit-sub title="עריכה">✏️</button>' +
                '<button type="button" class="icon-button" data-delete-sub title="מחיקה">🗑️</button></span></div>';
        }).join('');
        card.innerHTML =
            '<div class="tc-category-header"><span class="tc-category-header-left">' +
            '<span class="tc-drag-handle" title="גרירה לסידור מחדש">⠿</span><strong>' + escapeHtml(c.name) + '</strong></span>' +
            '<span class="admin-row-actions">' +
            '<button type="button" class="icon-button" data-add-sub title="הוסף תת-קטגוריה">➕</button>' +
            '<button type="button" class="icon-button" data-edit title="עריכה">✏️</button>' +
            '<button type="button" class="icon-button" data-delete title="מחיקה">🗑️</button></span></div>' +
            subsHtml;
        card.querySelector('[data-edit]').addEventListener('click', function () { openCategoryModal(c); });
        card.querySelector('[data-delete]').addEventListener('click', function () { deleteTicketCategory(c); });
        card.querySelector('[data-add-sub]').addEventListener('click', function () { openSubcategoryModal(null, c.id); });

        card.addEventListener('dragstart', function (e) { draggedCategoryId = c.id; e.stopPropagation(); });
        card.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); card.classList.add('tc-drag-over'); });
        card.addEventListener('dragleave', function () { card.classList.remove('tc-drag-over'); });
        card.addEventListener('drop', function (e) {
            e.preventDefault(); e.stopPropagation();
            card.classList.remove('tc-drag-over');
            reorderCategories(draggedCategoryId, c.id);
        });

        c.subcategories.forEach(function (s) {
            var row = card.querySelector('[data-sub-id="' + s.id + '"]');
            row.querySelector('[data-edit-sub]').addEventListener('click', function () { openSubcategoryModal(s, c.id); });
            row.querySelector('[data-delete-sub]').addEventListener('click', function () { deleteTicketSubcategory(s); });
            row.addEventListener('dragstart', function (e) { draggedSubcategoryId = s.id; e.stopPropagation(); });
            row.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); row.classList.add('tc-drag-over'); });
            row.addEventListener('dragleave', function () { row.classList.remove('tc-drag-over'); });
            row.addEventListener('drop', function (e) {
                e.preventDefault(); e.stopPropagation();
                row.classList.remove('tc-drag-over');
                reorderSubcategories(draggedSubcategoryId, s.id);
            });
        });
        container.appendChild(card);
    });
}

function reorderCategories(draggedId, targetId) {
    if (!draggedId || draggedId === targetId) return;
    var list = ticketConfigCache.categories;
    var fromIdx = list.findIndex(function (x) { return x.id === draggedId; });
    var toIdx = list.findIndex(function (x) { return x.id === targetId; });
    if (fromIdx < 0 || toIdx < 0) return;
    list.splice(toIdx, 0, list.splice(fromIdx, 1)[0]);
    renderTicketConfigCategories();
    persistCategoryOrder();
}

async function persistCategoryOrder() {
    showLoading(true);
    for (var i = 0; i < ticketConfigCache.categories.length; i++) {
        var c = ticketConfigCache.categories[i];
        var newOrder = (i + 1) * 10;
        if (c.order !== newOrder) {
            c.order = newOrder;
            await apiPost('ticketConfig', 'saveCategory', { id: c.id, name: c.name, order: newOrder });
        }
    }
    showLoading(false);
}

function reorderSubcategories(draggedId, targetId) {
    if (!draggedId || draggedId === targetId) return;
    var category = ticketConfigCache.categories.filter(function (c) {
        return c.subcategories.some(function (s) { return s.id === draggedId; });
    })[0];
    if (!category) return;
    var list = category.subcategories;
    var fromIdx = list.findIndex(function (x) { return x.id === draggedId; });
    var toIdx = list.findIndex(function (x) { return x.id === targetId; });
    if (fromIdx < 0 || toIdx < 0) return;
    list.splice(toIdx, 0, list.splice(fromIdx, 1)[0]);
    renderTicketConfigCategories();
    persistSubcategoryOrder(category);
}

async function persistSubcategoryOrder(category) {
    showLoading(true);
    for (var i = 0; i < category.subcategories.length; i++) {
        var s = category.subcategories[i];
        var newOrder = (i + 1) * 10;
        if (s.order !== newOrder) {
            s.order = newOrder;
            await apiPost('ticketConfig', 'saveSubcategory', {
                id: s.id, categoryId: category.id, name: s.name,
                isDynamic: s.isDynamic, dynamicSource: s.dynamicSource || '', order: newOrder,
            });
        }
    }
    showLoading(false);
}

function renderTicketConfigUrgencies() {
    var container = document.getElementById('tcUrgenciesList');
    container.innerHTML = '';
    ticketConfigCache.urgencies.forEach(function (u) {
        var row = document.createElement('div');
        row.className = 'tc-urgency-row';
        row.draggable = true;
        row.innerHTML =
            '<span class="tc-urgency-row-left"><span class="tc-drag-handle" title="גרירה לסידור מחדש">⠿</span>' +
            '<span class="tc-color-dot" style="background:' + escapeHtml(u.colorHex) + '"></span>' +
            '<strong>' + escapeHtml(u.name) + '</strong> — ' + escapeHtml(u.description) + '</span>' +
            '<span class="admin-row-actions">' +
            '<button type="button" class="icon-button" data-edit title="עריכה">✏️</button>' +
            '<button type="button" class="icon-button" data-delete title="מחיקה">🗑️</button></span>';
        row.querySelector('[data-edit]').addEventListener('click', function () { openUrgencyModal(u); });
        row.querySelector('[data-delete]').addEventListener('click', function () { deleteTicketUrgency(u); });
        row.addEventListener('dragstart', function () { draggedUrgencyId = u.id; });
        row.addEventListener('dragover', function (e) { e.preventDefault(); row.classList.add('tc-drag-over'); });
        row.addEventListener('dragleave', function () { row.classList.remove('tc-drag-over'); });
        row.addEventListener('drop', function (e) {
            e.preventDefault();
            row.classList.remove('tc-drag-over');
            reorderUrgencies(draggedUrgencyId, u.id);
        });
        container.appendChild(row);
    });
}

function reorderUrgencies(draggedId, targetId) {
    if (!draggedId || draggedId === targetId) return;
    var list = ticketConfigCache.urgencies;
    var fromIdx = list.findIndex(function (x) { return x.id === draggedId; });
    var toIdx = list.findIndex(function (x) { return x.id === targetId; });
    if (fromIdx < 0 || toIdx < 0) return;
    list.splice(toIdx, 0, list.splice(fromIdx, 1)[0]);
    renderTicketConfigUrgencies();
    applyUrgencyConfig();
    persistUrgencyOrder();
}

// Position IS the severity — top of the list is least urgent, bottom is most urgent
// (matches the drag order), so there's no separate "severity number" for IT to manage.
async function persistUrgencyOrder() {
    showLoading(true);
    for (var i = 0; i < ticketConfigCache.urgencies.length; i++) {
        var u = ticketConfigCache.urgencies[i];
        var newRank = i + 1;
        if (u.order !== newRank || u.severity !== newRank) {
            u.order = newRank;
            u.severity = newRank;
            await apiPost('ticketConfig', 'saveUrgency', {
                id: u.id, name: u.name, description: u.description, colorHex: u.colorHex,
                severity: newRank, order: newRank,
            });
        }
    }
    applyUrgencyConfig();
    showLoading(false);
}

var editingCategoryId = null;
var tcCategoryTracker = makeDirtyTracker(document.getElementById('tcCategoryModalBackdrop'));

function openCategoryModal(c) {
    editingCategoryId = c ? c.id : null;
    document.getElementById('tcCategoryModalTitle').textContent = c ? 'עריכת קטגוריה' : 'קטגוריה חדשה';
    document.getElementById('tcCategoryName').value = c ? c.name : '';
    document.getElementById('tcCategoryModalError').style.display = 'none';
    document.getElementById('tcCategoryModalBackdrop').classList.add('visible');
    tcCategoryTracker.reset();
}
function closeCategoryModal() { document.getElementById('tcCategoryModalBackdrop').classList.remove('visible'); }

document.getElementById('tcCategoryAddBtn').addEventListener('click', function () { openCategoryModal(null); });
document.getElementById('tcCategoryCancelBtn').addEventListener('click', function () {
    if (tcCategoryTracker.confirmDiscard()) closeCategoryModal();
});
document.getElementById('tcCategorySaveBtn').addEventListener('click', async function () {
    var errEl = document.getElementById('tcCategoryModalError');
    var name = document.getElementById('tcCategoryName').value.trim();
    if (!name) { errEl.textContent = 'יש למלא שם קטגוריה'; errEl.style.display = 'block'; return; }
    var existing = editingCategoryId ? ticketConfigCache.categories.filter(function (c) { return c.id === editingCategoryId; })[0] : null;
    var payload = { name: name, order: existing ? existing.order : (ticketConfigCache.categories.length + 1) * 10 };
    if (editingCategoryId) payload.id = editingCategoryId;
    showLoading(true);
    var res = await apiPost('ticketConfig', 'saveCategory', payload);
    showLoading(false);
    if (res.ok) { tcCategoryTracker.reset(); closeCategoryModal(); loadTicketConfigAdminPage(); }
    else { errEl.textContent = res.error || 'שגיאה בשמירה'; errEl.style.display = 'block'; }
});

async function deleteTicketCategory(c) {
    if (!confirm('למחוק את הקטגוריה "' + c.name + '"? כל תתי-הקטגוריות שלה יימחקו גם כן.')) return;
    showLoading(true);
    var res = await apiPost('ticketConfig', 'deleteCategory', { id: c.id });
    showLoading(false);
    if (res.ok) loadTicketConfigAdminPage(); else alert(res.error || 'שגיאה במחיקה');
}

var editingSubcategoryId = null;
var editingSubcategoryCategoryId = null;
var tcSubcategoryTracker = makeDirtyTracker(document.getElementById('tcSubcategoryModalBackdrop'));

function openSubcategoryModal(s, categoryId) {
    editingSubcategoryId = s ? s.id : null;
    editingSubcategoryCategoryId = categoryId;
    document.getElementById('tcSubcategoryModalTitle').textContent = s ? 'עריכת תת-קטגוריה' : 'תת-קטגוריה חדשה';
    document.getElementById('tcSubcategoryName').value = s ? s.name : '';
    document.getElementById('tcSubcategoryDynamic').checked = s ? s.isDynamic : false;
    document.getElementById('tcSubcategoryDynamicSource').value = (s && s.dynamicSource) ? s.dynamicSource : 'printers-by-branch';
    document.getElementById('tcSubcategoryDynamicSourceField').style.display = (s && s.isDynamic) ? 'block' : 'none';
    document.getElementById('tcSubcategoryModalError').style.display = 'none';
    document.getElementById('tcSubcategoryModalBackdrop').classList.add('visible');
    tcSubcategoryTracker.reset();
}
function closeSubcategoryModal() { document.getElementById('tcSubcategoryModalBackdrop').classList.remove('visible'); }

document.getElementById('tcSubcategoryDynamic').addEventListener('change', function () {
    document.getElementById('tcSubcategoryDynamicSourceField').style.display = this.checked ? 'block' : 'none';
});
document.getElementById('tcSubcategoryCancelBtn').addEventListener('click', function () {
    if (tcSubcategoryTracker.confirmDiscard()) closeSubcategoryModal();
});
document.getElementById('tcSubcategorySaveBtn').addEventListener('click', async function () {
    var errEl = document.getElementById('tcSubcategoryModalError');
    var name = document.getElementById('tcSubcategoryName').value.trim();
    if (!name) { errEl.textContent = 'יש למלא שם'; errEl.style.display = 'block'; return; }
    var isDynamic = document.getElementById('tcSubcategoryDynamic').checked;
    var category = ticketConfigCache.categories.filter(function (c) { return c.id === editingSubcategoryCategoryId; })[0];
    var existing = (editingSubcategoryId && category)
        ? category.subcategories.filter(function (s) { return s.id === editingSubcategoryId; })[0] : null;
    var payload = {
        categoryId: editingSubcategoryCategoryId,
        name: name,
        isDynamic: isDynamic,
        dynamicSource: isDynamic ? document.getElementById('tcSubcategoryDynamicSource').value : '',
        order: existing ? existing.order : ((category ? category.subcategories.length : 0) + 1) * 10,
    };
    if (editingSubcategoryId) payload.id = editingSubcategoryId;
    showLoading(true);
    var res = await apiPost('ticketConfig', 'saveSubcategory', payload);
    showLoading(false);
    if (res.ok) { tcSubcategoryTracker.reset(); closeSubcategoryModal(); loadTicketConfigAdminPage(); }
    else { errEl.textContent = res.error || 'שגיאה בשמירה'; errEl.style.display = 'block'; }
});

async function deleteTicketSubcategory(s) {
    if (!confirm('למחוק את "' + s.name + '"?')) return;
    showLoading(true);
    var res = await apiPost('ticketConfig', 'deleteSubcategory', { id: s.id });
    showLoading(false);
    if (res.ok) loadTicketConfigAdminPage(); else alert(res.error || 'שגיאה במחיקה');
}

var editingUrgencyId = null;
var tcUrgencyTracker = makeDirtyTracker(document.getElementById('tcUrgencyModalBackdrop'));

function openUrgencyModal(u) {
    editingUrgencyId = u ? u.id : null;
    document.getElementById('tcUrgencyModalTitle').textContent = u ? 'עריכת דרגה' : 'דרגת דחיפות חדשה';
    document.getElementById('tcUrgencyName').value = u ? u.name : '';
    document.getElementById('tcUrgencyDescription').value = u ? u.description : '';
    document.getElementById('tcUrgencyColor').value = u ? u.colorHex : '#edd76f';
    document.getElementById('tcUrgencyModalError').style.display = 'none';
    document.getElementById('tcUrgencyModalBackdrop').classList.add('visible');
    tcUrgencyTracker.reset();
}
function closeUrgencyModal() { document.getElementById('tcUrgencyModalBackdrop').classList.remove('visible'); }

document.getElementById('tcUrgencyAddBtn').addEventListener('click', function () { openUrgencyModal(null); });
document.getElementById('tcUrgencyCancelBtn').addEventListener('click', function () {
    if (tcUrgencyTracker.confirmDiscard()) closeUrgencyModal();
});
document.getElementById('tcUrgencySaveBtn').addEventListener('click', async function () {
    var errEl = document.getElementById('tcUrgencyModalError');
    var name = document.getElementById('tcUrgencyName').value.trim();
    if (!name) { errEl.textContent = 'יש למלא שם'; errEl.style.display = 'block'; return; }
    var existing = editingUrgencyId ? ticketConfigCache.urgencies.filter(function (u) { return u.id === editingUrgencyId; })[0] : null;
    var rank = existing ? existing.order : ticketConfigCache.urgencies.length + 1;
    var payload = {
        name: name,
        description: document.getElementById('tcUrgencyDescription').value.trim(),
        colorHex: document.getElementById('tcUrgencyColor').value,
        severity: rank,
        order: rank,
    };
    if (editingUrgencyId) payload.id = editingUrgencyId;
    showLoading(true);
    var res = await apiPost('ticketConfig', 'saveUrgency', payload);
    showLoading(false);
    if (res.ok) { tcUrgencyTracker.reset(); closeUrgencyModal(); loadTicketConfigAdminPage(); }
    else { errEl.textContent = res.error || 'שגיאה בשמירה'; errEl.style.display = 'block'; }
});

async function deleteTicketUrgency(u) {
    if (!confirm('למחוק את הדרגה "' + u.name + '"?')) return;
    showLoading(true);
    var res = await apiPost('ticketConfig', 'deleteUrgency', { id: u.id });
    showLoading(false);
    if (res.ok) loadTicketConfigAdminPage(); else alert(res.error || 'שגיאה במחיקה');
}
