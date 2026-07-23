import { apiGet, apiPost } from './api-client.js';
import { escapeHtml, makeDirtyTracker, showLoading } from './common-ui.js';
import { showView } from './nav.js';

// ── PROCEDURES VIEW ───────────────────────────────────────
// ── PROCEDURES: category config, shared by the main (read-only) view and the
// "עריכת נהלי עבודה" admin screen — same cache pattern as ensureTicketConfigLoaded.
var procedureConfigCache = null;

async function ensureProcedureConfigLoaded() {
    if (procedureConfigCache) return procedureConfigCache;
    var res = await apiGet('procedureConfig', 'list', {});
    procedureConfigCache = res.ok ? res.data : { categories: [] };
    return procedureConfigCache;
}

function procedureCategoryById(id) {
    return (procedureConfigCache && procedureConfigCache.categories || []).filter(function (c) { return c.id === id; })[0];
}

// The main screen is now pure read-only — grouped and colored by
// category (right-border chip, like the dashboard task cards), no add/edit affordances
// (those moved to "עריכת נהלי עבודה"). A draft procedure only ever reaches this list for
// a procedures admin (see procedures.js list()), so the red badge is always safe to show.
export async function loadProceduresPage() {
    showLoading(true);
    await ensureProcedureConfigLoaded();
    var res = await apiGet('procedures', 'list', {});
    showLoading(false);
    renderProcedures(res.ok ? res.data : []);
}

// Content is now rich HTML from the mini-Word editor — a legacy
// plain-text procedure (saved before this feature existed) has no tags at all, so it
// renders as escaped text with line breaks preserved instead of raw HTML.
function renderProcedureContentInto(el, content) {
    var raw = content || '';
    el.innerHTML = raw.indexOf('<') === -1 ? escapeHtml(raw).replace(/\n/g, '<br>') : raw;
}

function buildProcedureCard(proc, color) {
    var card = document.createElement('div');
    card.className = 'procedure-card' + (proc.isDraft ? ' is-draft' : '');
    card.style.borderRightColor = proc.isDraft ? 'var(--danger)' : color;

    var draftBadge = proc.isDraft ? ' <span class="procedure-draft-badge">טיוטה - טרם פורסם</span>' : '';
    var header = document.createElement('div');
    header.className = 'procedure-card-header';
    header.innerHTML = '<span class="procedure-card-title">' + escapeHtml(proc.title) + draftBadge + '</span>';

    var content = document.createElement('div');
    content.className = 'procedure-card-content rich';
    renderProcedureContentInto(content, proc.content);

    header.addEventListener('click', function () { card.classList.toggle('expanded'); });

    card.appendChild(header);
    card.appendChild(content);
    return card;
}

function renderProcedures(list) {
    var container = document.getElementById('proceduresList');
    container.innerHTML = '';
    if (!list.length) {
        container.innerHTML = '<p style="color:var(--muted);font-size:13px">אין נהלים עדיין.</p>';
        return;
    }
    var groups = (procedureConfigCache.categories || []).map(function (c) {
        return { category: c, procedures: list.filter(function (p) { return p.categoryId === c.id; }) };
    });
    var uncategorized = list.filter(function (p) { return !procedureCategoryById(p.categoryId); });
    if (uncategorized.length) groups.push({ category: null, procedures: uncategorized });

    groups.forEach(function (group) {
        if (!group.procedures.length) return;
        var color = group.category ? group.category.colorHex : '#9ca3af';
        var heading = document.createElement('h3');
        heading.className = 'procedure-category-title';
        heading.innerHTML = '<span class="tc-color-dot" style="background:' + escapeHtml(color) + '"></span>' +
            escapeHtml(group.category ? group.category.name : 'ללא קטגוריה');
        container.appendChild(heading);
        group.procedures.forEach(function (proc) { container.appendChild(buildProcedureCard(proc, color)); });
    });
}

// ── ADMIN: עריכת נהלי עבודה (categories/subcategories + full procedure CRUD) ──
var draggedProcedureCategoryId = null;
var draggedProcedureSubcategoryId = null;
var proceduresAdminCache = [];

export async function loadProcedureConfigAdminPage() {
    showLoading(true);
    procedureConfigCache = null; // this screen is the source of truth — force a refetch
    await ensureProcedureConfigLoaded();
    var res = await apiGet('procedures', 'list', {});
    showLoading(false);
    proceduresAdminCache = res.ok ? res.data : [];
    renderProcedureConfigCategories();
    renderProceduresAdminList();
}

function renderProcedureConfigCategories() {
    var container = document.getElementById('pcCategoriesList');
    container.innerHTML = '';
    var categories = procedureConfigCache.categories;
    if (!categories.length) { container.innerHTML = '<p style="color:var(--muted);font-size:13px">אין קטגוריות עדיין.</p>'; return; }
    categories.forEach(function (c) {
        var card = document.createElement('div');
        card.className = 'tc-category-card';
        card.draggable = true;
        var subsHtml = c.subcategories.map(function (s) {
            return '<div class="tc-sub-row" data-sub-id="' + s.id + '" draggable="true">' +
                '<span class="tc-sub-row-left"><span class="tc-drag-handle" title="גרירה לסידור מחדש">⠿</span>' + escapeHtml(s.name) + '</span>' +
                '<span class="admin-row-actions">' +
                '<button type="button" class="icon-button" data-edit-sub title="עריכה">✏️</button>' +
                '<button type="button" class="icon-button" data-delete-sub title="מחיקה">🗑️</button></span></div>';
        }).join('');
        card.innerHTML =
            '<div class="tc-category-header"><span class="tc-category-header-left">' +
            '<span class="tc-drag-handle" title="גרירה לסידור מחדש">⠿</span>' +
            '<span class="tc-color-dot" style="background:' + escapeHtml(c.colorHex) + '"></span>' +
            '<strong>' + escapeHtml(c.name) + '</strong></span>' +
            '<span class="admin-row-actions">' +
            '<button type="button" class="icon-button" data-add-sub title="הוסף תת-קטגוריה">➕</button>' +
            '<button type="button" class="icon-button" data-edit title="עריכה">✏️</button>' +
            '<button type="button" class="icon-button" data-delete title="מחיקה">🗑️</button></span></div>' +
            subsHtml;
        card.querySelector('[data-edit]').addEventListener('click', function () { openProcedureCategoryModal(c); });
        card.querySelector('[data-delete]').addEventListener('click', function () { deleteProcedureCategory(c); });
        card.querySelector('[data-add-sub]').addEventListener('click', function () { openProcedureSubcategoryModal(null, c.id); });

        card.addEventListener('dragstart', function (e) { draggedProcedureCategoryId = c.id; e.stopPropagation(); });
        card.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); card.classList.add('tc-drag-over'); });
        card.addEventListener('dragleave', function () { card.classList.remove('tc-drag-over'); });
        card.addEventListener('drop', function (e) {
            e.preventDefault(); e.stopPropagation();
            card.classList.remove('tc-drag-over');
            reorderProcedureCategories(draggedProcedureCategoryId, c.id);
        });

        c.subcategories.forEach(function (s) {
            var row = card.querySelector('[data-sub-id="' + s.id + '"]');
            row.querySelector('[data-edit-sub]').addEventListener('click', function () { openProcedureSubcategoryModal(s, c.id); });
            row.querySelector('[data-delete-sub]').addEventListener('click', function () { deleteProcedureSubcategory(s); });
            row.addEventListener('dragstart', function (e) { draggedProcedureSubcategoryId = s.id; e.stopPropagation(); });
            row.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); row.classList.add('tc-drag-over'); });
            row.addEventListener('dragleave', function () { row.classList.remove('tc-drag-over'); });
            row.addEventListener('drop', function (e) {
                e.preventDefault(); e.stopPropagation();
                row.classList.remove('tc-drag-over');
                reorderProcedureSubcategories(draggedProcedureSubcategoryId, s.id);
            });
        });
        container.appendChild(card);
    });
}

function reorderProcedureCategories(draggedId, targetId) {
    if (!draggedId || draggedId === targetId) return;
    var list = procedureConfigCache.categories;
    var fromIdx = list.findIndex(function (x) { return x.id === draggedId; });
    var toIdx = list.findIndex(function (x) { return x.id === targetId; });
    if (fromIdx < 0 || toIdx < 0) return;
    list.splice(toIdx, 0, list.splice(fromIdx, 1)[0]);
    renderProcedureConfigCategories();
    persistProcedureCategoryOrder();
}

async function persistProcedureCategoryOrder() {
    showLoading(true);
    for (var i = 0; i < procedureConfigCache.categories.length; i++) {
        var c = procedureConfigCache.categories[i];
        var newOrder = (i + 1) * 10;
        if (c.order !== newOrder) {
            c.order = newOrder;
            await apiPost('procedureConfig', 'saveCategory', { id: c.id, name: c.name, colorHex: c.colorHex, order: newOrder });
        }
    }
    showLoading(false);
}

function reorderProcedureSubcategories(draggedId, targetId) {
    if (!draggedId || draggedId === targetId) return;
    var category = procedureConfigCache.categories.filter(function (c) {
        return c.subcategories.some(function (s) { return s.id === draggedId; });
    })[0];
    if (!category) return;
    var list = category.subcategories;
    var fromIdx = list.findIndex(function (x) { return x.id === draggedId; });
    var toIdx = list.findIndex(function (x) { return x.id === targetId; });
    if (fromIdx < 0 || toIdx < 0) return;
    list.splice(toIdx, 0, list.splice(fromIdx, 1)[0]);
    renderProcedureConfigCategories();
    persistProcedureSubcategoryOrder(category);
}

async function persistProcedureSubcategoryOrder(category) {
    showLoading(true);
    for (var i = 0; i < category.subcategories.length; i++) {
        var s = category.subcategories[i];
        var newOrder = (i + 1) * 10;
        if (s.order !== newOrder) {
            s.order = newOrder;
            await apiPost('procedureConfig', 'saveSubcategory', { id: s.id, categoryId: category.id, name: s.name, order: newOrder });
        }
    }
    showLoading(false);
}

var editingProcedureCategoryId = null;
var pcCategoryTracker = makeDirtyTracker(document.getElementById('pcCategoryModalBackdrop'));

function openProcedureCategoryModal(c) {
    editingProcedureCategoryId = c ? c.id : null;
    document.getElementById('pcCategoryModalTitle').textContent = c ? 'עריכת קטגוריה' : 'קטגוריה חדשה';
    document.getElementById('pcCategoryName').value = c ? c.name : '';
    document.getElementById('pcCategoryColor').value = c ? c.colorHex : '#8b5cf6';
    document.getElementById('pcCategoryModalError').style.display = 'none';
    document.getElementById('pcCategoryModalBackdrop').classList.add('visible');
    pcCategoryTracker.reset();
}
function closeProcedureCategoryModal() { document.getElementById('pcCategoryModalBackdrop').classList.remove('visible'); }

document.getElementById('pcCategoryAddBtn').addEventListener('click', function () { openProcedureCategoryModal(null); });
document.getElementById('pcCategoryCancelBtn').addEventListener('click', function () {
    if (pcCategoryTracker.confirmDiscard()) closeProcedureCategoryModal();
});
document.getElementById('pcCategorySaveBtn').addEventListener('click', async function () {
    var errEl = document.getElementById('pcCategoryModalError');
    var name = document.getElementById('pcCategoryName').value.trim();
    if (!name) { errEl.textContent = 'יש למלא שם קטגוריה'; errEl.style.display = 'block'; return; }
    var existing = editingProcedureCategoryId ? procedureConfigCache.categories.filter(function (c) { return c.id === editingProcedureCategoryId; })[0] : null;
    var payload = {
        name: name,
        colorHex: document.getElementById('pcCategoryColor').value,
        order: existing ? existing.order : (procedureConfigCache.categories.length + 1) * 10,
    };
    if (editingProcedureCategoryId) payload.id = editingProcedureCategoryId;
    showLoading(true);
    var res = await apiPost('procedureConfig', 'saveCategory', payload);
    showLoading(false);
    if (res.ok) { pcCategoryTracker.reset(); closeProcedureCategoryModal(); loadProcedureConfigAdminPage(); }
    else { errEl.textContent = res.error || 'שגיאה בשמירה'; errEl.style.display = 'block'; }
});

async function deleteProcedureCategory(c) {
    if (!confirm('למחוק את הקטגוריה "' + c.name + '"? כל תתי-הקטגוריות שלה יימחקו גם כן, ונהלים המשוייכים אליה יעברו ל"ללא קטגוריה".')) return;
    showLoading(true);
    var res = await apiPost('procedureConfig', 'deleteCategory', { id: c.id });
    showLoading(false);
    if (res.ok) loadProcedureConfigAdminPage(); else alert(res.error || 'שגיאה במחיקה');
}

var editingProcedureSubcategoryId = null;
var editingProcedureSubcategoryCategoryId = null;
var pcSubcategoryTracker = makeDirtyTracker(document.getElementById('pcSubcategoryModalBackdrop'));

function openProcedureSubcategoryModal(s, categoryId) {
    editingProcedureSubcategoryId = s ? s.id : null;
    editingProcedureSubcategoryCategoryId = categoryId;
    document.getElementById('pcSubcategoryModalTitle').textContent = s ? 'עריכת תת-קטגוריה' : 'תת-קטגוריה חדשה';
    document.getElementById('pcSubcategoryName').value = s ? s.name : '';
    document.getElementById('pcSubcategoryModalError').style.display = 'none';
    document.getElementById('pcSubcategoryModalBackdrop').classList.add('visible');
    pcSubcategoryTracker.reset();
}
function closeProcedureSubcategoryModal() { document.getElementById('pcSubcategoryModalBackdrop').classList.remove('visible'); }

document.getElementById('pcSubcategoryCancelBtn').addEventListener('click', function () {
    if (pcSubcategoryTracker.confirmDiscard()) closeProcedureSubcategoryModal();
});
document.getElementById('pcSubcategorySaveBtn').addEventListener('click', async function () {
    var errEl = document.getElementById('pcSubcategoryModalError');
    var name = document.getElementById('pcSubcategoryName').value.trim();
    if (!name) { errEl.textContent = 'יש למלא שם'; errEl.style.display = 'block'; return; }
    var category = procedureConfigCache.categories.filter(function (c) { return c.id === editingProcedureSubcategoryCategoryId; })[0];
    var existing = (editingProcedureSubcategoryId && category)
        ? category.subcategories.filter(function (s) { return s.id === editingProcedureSubcategoryId; })[0] : null;
    var payload = {
        categoryId: editingProcedureSubcategoryCategoryId,
        name: name,
        order: existing ? existing.order : ((category ? category.subcategories.length : 0) + 1) * 10,
    };
    if (editingProcedureSubcategoryId) payload.id = editingProcedureSubcategoryId;
    showLoading(true);
    var res = await apiPost('procedureConfig', 'saveSubcategory', payload);
    showLoading(false);
    if (res.ok) { pcSubcategoryTracker.reset(); closeProcedureSubcategoryModal(); loadProcedureConfigAdminPage(); }
    else { errEl.textContent = res.error || 'שגיאה בשמירה'; errEl.style.display = 'block'; }
});

async function deleteProcedureSubcategory(s) {
    if (!confirm('למחוק את "' + s.name + '"?')) return;
    showLoading(true);
    var res = await apiPost('procedureConfig', 'deleteSubcategory', { id: s.id });
    showLoading(false);
    if (res.ok) loadProcedureConfigAdminPage(); else alert(res.error || 'שגיאה במחיקה');
}

function populateProcedureCategorySelect(selectedId) {
    var select = document.getElementById('peCategory');
    var options = (procedureConfigCache.categories || []).map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === selectedId ? ' selected' : '') + '>' + escapeHtml(c.name) + '</option>';
    }).join('');
    select.innerHTML = '<option value="">בחר קטגוריה</option>' + options;
}

// Subcategory is always optional — the field only appears at all
// when the chosen category actually has subcategories to offer.
function populateProcedureSubcategorySelect(categoryId, selectedId) {
    var field = document.getElementById('peSubcategoryField');
    var select = document.getElementById('peSubcategory');
    var category = procedureCategoryById(categoryId);
    var subcategories = (category && category.subcategories) || [];
    if (!subcategories.length) {
        field.style.display = 'none';
        select.innerHTML = '';
        return;
    }
    field.style.display = 'block';
    var options = subcategories.map(function (s) {
        return '<option value="' + s.id + '"' + (s.id === selectedId ? ' selected' : '') + '>' + escapeHtml(s.name) + '</option>';
    }).join('');
    select.innerHTML = '<option value="">ללא תת-קטגוריה</option>' + options;
}

document.getElementById('peCategory').addEventListener('change', function () {
    populateProcedureSubcategorySelect(this.value, '');
});

// A small "mini-Word" toolbar over the contenteditable page — plain
// execCommand, no library. The selection inside #peContent is saved continuously so a
// click on the toolbar (or opening the native color picker) never loses what was selected.
var peContentEl = document.getElementById('peContent');
var peSavedRange = null;
function savePeSelection() {
    var sel = window.getSelection();
    if (sel.rangeCount > 0 && peContentEl.contains(sel.anchorNode)) peSavedRange = sel.getRangeAt(0);
}
function restorePeSelection() {
    peContentEl.focus();
    if (!peSavedRange) return;
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(peSavedRange);
}
peContentEl.addEventListener('mouseup', savePeSelection);
peContentEl.addEventListener('keyup', savePeSelection);

document.querySelectorAll('.rte-toolbar .rte-btn').forEach(function (btn) {
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', function () {
        restorePeSelection();
        document.execCommand(btn.getAttribute('data-cmd'), false, btn.getAttribute('data-value') || undefined);
    });
});
document.getElementById('peTextColor').addEventListener('input', function () {
    restorePeSelection();
    document.execCommand('foreColor', false, this.value);
});
document.getElementById('peHighlightColor').addEventListener('input', function () {
    restorePeSelection();
    document.execCommand('hiliteColor', false, this.value);
});

function renderProceduresAdminList() {
    var container = document.getElementById('pcProceduresList');
    container.innerHTML = '';
    if (!proceduresAdminCache.length) {
        container.innerHTML = '<p style="color:var(--muted);font-size:13px">אין נהלים עדיין.</p>';
        return;
    }
    proceduresAdminCache.forEach(function (proc) {
        var category = procedureCategoryById(proc.categoryId);
        var subcategory = category && (category.subcategories || []).filter(function (s) { return s.id === proc.subcategoryId; })[0];
        var categoryLabel = (category ? category.name : 'ללא קטגוריה') + (subcategory ? ' / ' + subcategory.name : '');
        var row = document.createElement('div');
        row.className = 'tc-sub-row' + (proc.isDraft ? ' procedure-row-draft' : '');
        row.innerHTML =
            '<span class="tc-sub-row-left">' +
            '<span class="tc-color-dot" style="background:' + escapeHtml(category ? category.colorHex : '#9ca3af') + '"></span>' +
            (proc.isDraft ? '<strong style="color:var(--danger)">[טיוטה] </strong>' : '') +
            escapeHtml(proc.title) + ' <span style="color:var(--muted);font-size:12px">(' + escapeHtml(categoryLabel) + ')</span>' +
            '</span>' +
            '<span class="admin-row-actions">' +
            '<button type="button" class="icon-button" data-edit title="עריכה">✏️</button>' +
            '<button type="button" class="icon-button" data-delete title="מחיקה">🗑️</button></span>';
        row.querySelector('[data-edit]').addEventListener('click', function () { openProcedureEditorPage(proc); });
        row.querySelector('[data-delete]').addEventListener('click', function () { deleteProcedure(proc); });
        container.appendChild(row);
    });
}

// Create/edit moved from a small modal to its own page — same
// dirty-tracking convention as every other edit screen, just scoped to the whole view.
var editingProcedureId = null;
export var procedureEditorTracker = makeDirtyTracker(document.getElementById('view-procedure-editor'));

function openProcedureEditorPage(proc) {
    editingProcedureId = proc ? proc.id : null;
    document.getElementById('peTitle').textContent = proc ? 'עריכת נוהל' : 'נוהל חדש';
    populateProcedureCategorySelect(proc ? proc.categoryId : '');
    populateProcedureSubcategorySelect(proc ? proc.categoryId : '', proc ? proc.subcategoryId : '');
    document.getElementById('peTitleInput').value = proc ? proc.title : '';
    document.getElementById('peIsDraft').checked = proc ? proc.isDraft : false;
    peContentEl.innerHTML = proc ? (proc.content || '') : '';
    peSavedRange = null;
    document.getElementById('procedureEditorError').style.display = 'none';
    showView('procedure-editor');
    procedureEditorTracker.reset();
}

document.getElementById('pcProcedureAddBtn').addEventListener('click', function () { openProcedureEditorPage(null); });
document.getElementById('peCancelBtn').addEventListener('click', function () {
    if (procedureEditorTracker.confirmDiscard()) showView('admin-procedure-config');
});

document.getElementById('peSaveBtn').addEventListener('click', async function () {
    var errEl = document.getElementById('procedureEditorError');
    var content = peContentEl.innerHTML.trim();
    var isEmpty = !content || content === '<br>';
    var payload = {
        categoryId: document.getElementById('peCategory').value,
        subcategoryId: document.getElementById('peSubcategory').value || null,
        title: document.getElementById('peTitleInput').value.trim(),
        content: content,
        isDraft: document.getElementById('peIsDraft').checked,
    };
    if (!payload.categoryId || !payload.title || isEmpty) {
        errEl.textContent = 'יש למלא קטגוריה, כותרת ותוכן.';
        errEl.style.display = 'block';
        return;
    }
    if (editingProcedureId) payload.id = editingProcedureId;

    showLoading(true);
    var res = await apiPost('procedures', editingProcedureId ? 'update' : 'create', payload);
    showLoading(false);
    if (res.ok) {
        procedureEditorTracker.reset();
        showView('admin-procedure-config');
    } else {
        errEl.textContent = res.error || 'שגיאה בשמירה';
        errEl.style.display = 'block';
    }
});

async function deleteProcedure(proc) {
    if (!confirm('למחוק את הנוהל "' + proc.title + '"?')) return;
    showLoading(true);
    var res = await apiPost('procedures', 'delete', { id: proc.id });
    showLoading(false);
    if (res.ok) loadProcedureConfigAdminPage();
    else alert(res.error || 'שגיאה במחיקה');
}
