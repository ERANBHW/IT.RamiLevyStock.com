import { Portal, apiGet, apiPost } from './api-client.js';
import { branchName, ensurePrintersLoaded, escapeHtml, formatDateTime, makeDirtyTracker, populatePrinterSelect, printersCache, showLoading } from './common-ui.js';
import { isHubActive, loadHubDashboard, patchDashboardTicket, refreshOpenDashboardDetail } from './hub.js';
import { showView } from './nav.js';

// ── TICKET VIEW ───────────────────────────────────────────
// Categories/subcategories/urgencies are no longer hardcoded here;
// they're loaded from the ticketConfig entity (managed by IT Admins) and cached like
// branches/printers/etc. ensureTicketConfigLoaded() is called wherever the ticket form
// or an admin screen needs this data.
export var ticketConfigCache = null;

export async function ensureTicketConfigLoaded() {
    if (ticketConfigCache) return ticketConfigCache;
    var res = await apiGet('ticketConfig', 'list', {});
    ticketConfigCache = res.ok ? res.data : { categories: [], urgencies: [] };
    applyUrgencyConfig();
    return ticketConfigCache;
}

export function hexToRgb(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var num = parseInt(h, 16) || 0;
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

var assignedComputer = null;
var myTickets = [];
export var URGENCY_SEVERITY = {};
export var URGENCY_COLOR = {};

export function applyUrgencyConfig() {
    URGENCY_SEVERITY = {};
    URGENCY_COLOR = {};
    (ticketConfigCache ? ticketConfigCache.urgencies : []).forEach(function (u) {
        URGENCY_SEVERITY[u.name] = u.severity;
        URGENCY_COLOR[u.name] = u.colorHex;
    });
}

function categoryByName(name) {
    return (ticketConfigCache ? ticketConfigCache.categories : []).filter(function (c) { return c.name === name; })[0] || null;
}

function renderCategoryOptions() {
    var sel = document.getElementById('tkCategory');
    var categories = ticketConfigCache ? ticketConfigCache.categories : [];
    sel.innerHTML = '<option value="">בחרו סוג תקלה</option>' +
        categories.map(function (c) { return '<option>' + escapeHtml(c.name) + '</option>'; }).join('');
}

// Urgency is a single sliding control — a track with
// one segment per level and a colored thumb that moves to whichever is selected,
// with that level's description shown below the track (not one line per option).
var tkSelectedUrgencyName = null;

function renderUrgencyOptions() {
    var container = document.getElementById('tkUrgencyTrack');
    var urgencies = ticketConfigCache ? ticketConfigCache.urgencies : [];
    container.innerHTML = '<div class="urgency-track-thumb" id="tkUrgencyThumb"></div>' +
        urgencies.map(function (u, i) {
            return '<button type="button" class="urgency-track-option" data-index="' + i + '">' + escapeHtml(u.name) + '</button>';
        }).join('');
    container.querySelectorAll('.urgency-track-option').forEach(function (btn) {
        btn.addEventListener('click', function () { selectTkUrgency(Number(btn.getAttribute('data-index'))); });
    });
    if (urgencies.length) selectTkUrgency(0);
}

function selectTkUrgency(index) {
    var urgencies = ticketConfigCache ? ticketConfigCache.urgencies : [];
    var u = urgencies[index];
    if (!u) return;
    var n = urgencies.length;
    var thumb = document.getElementById('tkUrgencyThumb');
    // RTL page: the track's flex row lays option 0 out on the right, so the thumb
    // has to slide via `right`, not `left` — otherwise it lands under the wrong option.
    thumb.style.width = 'calc(' + (100 / n) + '% - 4px)';
    thumb.style.right = 'calc(' + (index * 100 / n) + '% + 2px)';
    thumb.style.background = u.colorHex;
    document.querySelectorAll('#tkUrgencyTrack .urgency-track-option').forEach(function (btn, i) {
        btn.classList.toggle('selected', i === index);
    });
    document.getElementById('tkUrgencyDescription').textContent = u.description || '';
    tkSelectedUrgencyName = u.name;
}

// Populates the subcategory <select> for the currently-chosen category. Static
// subcategories just list their names; a dynamic one (currently only
// "printers-by-branch") reuses the Printers catalog, filtered to the caller's branch
// — "מרוחק" (branch 0) sees every printer, per the product spec. This is recorded on
// the ticket for IT's reference only — it does NOT drive the existing "for: my
// computer / a printer" email-routing toggle below, which stays independent.
async function renderSubcategoryOptions() {
    var field = document.getElementById('tkSubcategoryField');
    var sel = document.getElementById('tkSubcategory');
    var category = categoryByName(document.getElementById('tkCategory').value);
    var subs = category ? category.subcategories : [];
    if (!subs.length) { field.style.display = 'none'; sel.innerHTML = ''; return; }

    var dynamicOne = subs.filter(function (s) { return s.isDynamic; })[0];
    if (dynamicOne && dynamicOne.dynamicSource === 'printers-by-branch') {
        await ensurePrintersLoaded();
        var user = Portal.getUser();
        var branchFilter = user.branchNumber === 0 ? undefined : user.branchNumber;
        document.getElementById('tkSubcategoryLabel').textContent = dynamicOne.name;
        populatePrinterSelect(sel, '', branchFilter);
    } else {
        document.getElementById('tkSubcategoryLabel').textContent = 'פירוט';
        sel.innerHTML = '<option value="">בחרו</option>' +
            subs.map(function (s) { return '<option>' + escapeHtml(s.name) + '</option>'; }).join('');
    }
    field.style.display = 'block';
}

document.getElementById('tkCategory').addEventListener('change', renderSubcategoryOptions);

// ── Computer names — the "pick a different computer" pencil ──
var computerNamesCache = null;

async function ensureComputerNamesLoaded() {
    if (computerNamesCache) return computerNamesCache;
    var res = await apiGet('computers', 'listNames', {});
    computerNamesCache = res.ok ? res.data : [];
    return computerNamesCache;
}

function populateComputerNameSelect(selectEl, selectedName) {
    selectEl.innerHTML = (computerNamesCache || []).map(function (name) {
        return '<option' + (name === selectedName ? ' selected' : '') + '>' + escapeHtml(name) + '</option>';
    }).join('');
}

function fillComputerFields(data) {
    var user = Portal.getUser();
    var name = [user.firstName, user.lastName].filter(Boolean).join(' ');
    document.getElementById('tkName').value = name;
    document.getElementById('tkNameDisplay').textContent = name;
    document.getElementById('tkPhone').value = user.phone || '';
    document.getElementById('tkBranch').value = branchName(user.branchNumber);
    document.getElementById('tkComputerName').value = data ? (data.computerName || '') : '';
    document.getElementById('tkComputerDisplay').textContent = data ? data.computerName : 'ללא מחשב משוייך';
    document.getElementById('tkPrinter').value = data ? (data.defaultPrinterName || '') : '';
    document.getElementById('tkAnyDesk').value = data ? (data.anyDeskId || '') : '';
}

// Both pencils only affect this one ticket, never the profile/
// computer record itself; hidden by default, revealed on click.
document.getElementById('tkNameEditBtn').addEventListener('click', function () {
    document.getElementById('tkNameEditField').style.display = 'block';
    document.getElementById('tkName').focus();
});
document.getElementById('tkName').addEventListener('input', function () {
    document.getElementById('tkNameDisplay').textContent = document.getElementById('tkName').value || '';
});

document.getElementById('tkComputerEditBtn').addEventListener('click', async function () {
    document.getElementById('tkComputerEditSection').style.display = 'block';
    await ensureComputerNamesLoaded();
    populateComputerNameSelect(document.getElementById('tkComputerSelect'), document.getElementById('tkComputerName').value);
});

function updateTicketComputerDisplay() {
    var isPrinter = document.querySelector('input[name="tkForType"]:checked').value === 'printer';
    if (isPrinter) {
        var printerName = document.getElementById('tkPrinterSelect').value;
        document.getElementById('tkComputerDisplay').textContent = printerName ? ('מדפסת ' + printerName) : 'מדפסת';
    } else {
        document.getElementById('tkComputerDisplay').textContent = document.getElementById('tkComputerName').value || 'ללא מחשב משוייך';
    }
}

document.getElementById('tkComputerSelect').addEventListener('change', function () {
    document.getElementById('tkComputerName').value = this.value;
    updateTicketComputerDisplay();
});

// "for: my computer / a printer" toggle. Switching to "printer" shows a
// printer <select> filtered to the caller's own branch, defaulting to the assigned
// computer's default printer.
function resetForTypeToggle() {
    document.querySelector('input[name="tkForType"][value="computer"]').checked = true;
    document.getElementById('tkComputerSelectField').style.display = 'block';
    document.getElementById('tkPrinterSelectField').style.display = 'none';
    document.getElementById('tkNameEditField').style.display = 'none';
    document.getElementById('tkComputerEditSection').style.display = 'none';
}

document.querySelectorAll('input[name="tkForType"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
        var isPrinter = document.querySelector('input[name="tkForType"]:checked').value === 'printer';
        document.getElementById('tkComputerSelectField').style.display = isPrinter ? 'none' : 'block';
        document.getElementById('tkPrinterSelectField').style.display = isPrinter ? 'block' : 'none';
        if (isPrinter) {
            var user = Portal.getUser();
            var defaultPrinter = assignedComputer ? assignedComputer.defaultPrinterName : '';
            populatePrinterSelect(document.getElementById('tkPrinterSelect'), defaultPrinter, user.branchNumber);
        }
        updateTicketComputerDisplay();
    });
});

export async function loadTicketPage() {
    showLoading(true);
    await ensureTicketConfigLoaded();
    renderCategoryOptions();
    renderUrgencyOptions();
    document.getElementById('tkSubcategoryField').style.display = 'none';
    closedTicketsDisplayLimit = 10;
    document.getElementById('tkDescription').value = ''; // never start from a stale description
    resetForTypeToggle();

    var compRes = await apiGet('computers', 'getAssigned', {});
    assignedComputer = compRes.ok ? compRes.data : null;
    fillComputerFields(assignedComputer);
    await ensurePrintersLoaded();
    await refreshMyTickets();
    showLoading(false);
}

export async function refreshMyTickets() {
    var res = await apiGet('tickets', 'listMine', {});
    myTickets = res.ok ? res.data : [];
    renderOpenBanner();
    renderClosedTickets();
}

// Every open row (ticket or user-creation request) blinks with a border in its own
// color — same visual language as the "you have an open ticket" banner a regular
// user sees on their own ticket page.
export function applyOpenRowBlink(card, color) {
    card.style.borderRightWidth = '4px';
    card.style.borderRightStyle = 'solid';
    card.style.borderRightColor = color;
    card.classList.add('urgency-blink');
    var rgb = hexToRgb(color);
    card.style.setProperty('--urgency-glow-start', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.35)');
    card.style.setProperty('--urgency-glow-end', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0)');
}

export function buildTicketCard(t) {
    var card = document.createElement('div');
    card.className = 'ticket-card';
    var color = URGENCY_COLOR[t.urgency];
    if (t.status !== 'סגורה' && color) applyOpenRowBlink(card, color);
    var statusClass = t.status === 'סגורה' ? 'status-closed' : (t.status === 'בטיפול' ? 'status-progress' : 'status-open');
    card.innerHTML =
        '<div class="ticket-card-header"><strong>' + escapeHtml(t.ticketNumber) + '</strong>' +
        '<span class="status-badge ' + statusClass + '">' + escapeHtml(t.status) + '</span></div>' +
        '<div class="ticket-meta">' + formatDateTime(t.timestamp) + ' | ' + escapeHtml(t.category) + ' | ' + escapeHtml(t.urgency) + '</div>';
    card.addEventListener('click', function () { openTicketDetail(t); });
    return card;
}

// The same blinking "open tickets" banner shows on
// both the hub and the ticket-submission page — two DOM instances kept in sync from
// the same myTickets state, so opening/closing one never affects the other.
function renderOpenBannerInto(prefix) {
    var banner = document.getElementById(prefix + 'Banner');
    if (!banner) return;
    var open = myTickets.filter(function (t) { return t.status !== 'סגורה'; });
    var title = document.getElementById(prefix + 'BannerTitle');
    var list = document.getElementById(prefix + 'BannerList');
    if (!open.length) { banner.style.display = 'none'; list.classList.remove('expanded'); return; }

    banner.style.display = 'block';
    title.textContent = 'יש לך ' + open.length + ' קריאות פתוחות (לחצו להצגה)';
    list.innerHTML = '';
    // Open tickets expand inline (same accordion as
    // "קריאות שטופלו"), not the old read-only popup — buildTicketCard/openTicketDetail
    // stay in use elsewhere (e.g. the computer-history admin modal) where a plain
    // read-only view of someone else's tickets is still the right thing to show.
    open.forEach(function (t) { list.appendChild(buildEmployeeTicketRow(t).wrap); });
}

function renderOpenBanner() {
    renderOpenBannerInto('openTickets');
    renderOpenBannerInto('hubOpenTickets');
}

['openTickets', 'hubOpenTickets'].forEach(function (prefix) {
    var banner = document.getElementById(prefix + 'Banner');
    banner.addEventListener('click', function (e) {
        if (e.target.closest('.ticket-card')) return;
        document.getElementById(prefix + 'BannerList').classList.toggle('expanded');
    });
});

// Closed tickets render as plain rows (same visual
// language as the dashboard's ticket table, not the button-like open-ticket cards),
// and clicking one expands inline — same timeline as the dashboard row — ending in a
// gray "פתרון" block pulled from the resolution note logged when IT closed it.
var employeeRowElements = {};
var openEmployeeTicketNumber = null;
var openEmployeeRow = null;

// An open ("פתוחה") ticket gets two small, borderless
// pencils — one next to the title to correct the category/subcategory ("סוג קריאה"),
// one next to the "תיאור הקריאה" divider (inside the expanded detail) to correct the
// description. Both call the same requester-edit endpoint the backend already
// restricts to status === STATUS_OPEN, so they naturally disappear the moment IT
// takes the ticket.
function employeeTicketRowInnerHtml(t) {
    var titleParts = [escapeHtml(t.category)];
    if (t.subcategory) titleParts.push(escapeHtml(t.subcategory));
    titleParts.push(escapeHtml(t.ticketNumber));
    var pencilHtml = t.status === 'פתוחה'
        ? '<button type="button" class="icon-button-plain" data-edit-type title="שינוי סוג קריאה" data-stop>✏️</button>'
        : '';
    var statusClass = t.status === 'סגורה' ? 'status-closed' : (t.status === 'בטיפול' ? 'status-progress' : 'status-open');
    var rgb = hexToRgb(URGENCY_COLOR[t.urgency] || '#cccccc');
    var urgencyBg = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.2)';
    return '<div class="ticket-card-header"><span><strong>' + titleParts.join(' | ') + '</strong>' + pencilHtml + '</span>' +
        '<span class="status-badge ' + statusClass + '">' + escapeHtml(t.status) + '</span></div>' +
        '<div class="ticket-meta">' + formatDateTime(t.timestamp) + ' | <span class="dash-urgency-chip" style="background:' + urgencyBg + '">' + escapeHtml(t.urgency) + '</span></div>';
}

function closeEmployeeTicketDetail() {
    if (openEmployeeRow) {
        openEmployeeRow.detailEl.style.display = 'none';
        openEmployeeRow.detailEl.innerHTML = '';
        openEmployeeRow.cardEl.classList.remove('expanded');
        closeEmployeeEditForm(openEmployeeRow.editForm);
    }
    openEmployeeTicketNumber = null;
    openEmployeeRow = null;
}

function toggleEmployeeTicketDetail(t, cardEl, detailEl, editForm) {
    if (openEmployeeTicketNumber === t.ticketNumber) { closeEmployeeTicketDetail(); return; }
    if (openEmployeeRow) closeEmployeeTicketDetail();
    openEmployeeTicketNumber = t.ticketNumber;
    openEmployeeRow = { cardEl: cardEl, detailEl: detailEl, editForm: editForm };
    loadEmployeeTicketDetail(t, cardEl, detailEl, editForm);
}

async function loadEmployeeTicketDetail(t, cardEl, detailEl, editForm) {
    cardEl.classList.add('expanded');
    detailEl.style.display = 'block';
    detailEl.innerHTML = '<p style="color:var(--muted);font-size:13px">טוען...</p>';
    var res = await apiGet('tickets', 'get', { ticketNumber: t.ticketNumber });
    if (!res.ok) {
        detailEl.innerHTML = '<p style="color:var(--danger);font-size:13px">' + escapeHtml(res.error || 'שגיאה בטעינה') + '</p>';
        return;
    }
    renderEmployeeTicketDetail(detailEl, res.data.ticket, res.data.log, editForm);
}

function renderEmployeeTicketDetail(el, t, log, editForm) {
    var resolutionNote = null;
    if (t.status === 'סגורה') {
        for (var i = log.length - 1; i >= 0; i--) {
            if (log[i].action === 'note') { resolutionNote = log[i]; break; }
        }
    }
    var descPencilHtml = t.status === 'פתוחה'
        ? '<button type="button" class="icon-button-plain" data-edit-content title="שינוי תוכן הקריאה">✏️</button>'
        : '';
    el.innerHTML =
        '<div class="dash-section-divider">תיאור הקריאה' + descPencilHtml + '</div>' +
        '<div style="font-size:14px;white-space:pre-wrap;margin-bottom:10px">' + escapeHtml(t.description) + '</div>' +
        '<div class="dash-section-divider">היסטוריית הקריאה</div>' +
        '<div class="dash-timeline">' +
        (log.length ? log.map(function (entry) { return renderTimelineEntry(entry, t); }).join('') : '<span style="color:var(--muted);font-size:12px">אין רשומות</span>') +
        '</div>' +
        // Once IT has taken the ticket, the pencils are gone (nothing left to correct
        // via the requester-edit path) — instead the owner can still add a note, same
        // "הוסף הערה" affordance the IT admin sees on their own dashboard row.
        (t.status === 'בטיפול' ? '<div class="field" style="margin:10px 0 0"><label>הוסף הערה</label><div style="display:flex;gap:8px">' +
            '<input data-emp-note-input type="text" style="flex:1" placeholder="הוסף הערה (Enter לשליחה)">' +
            '<button type="button" class="secondary-button" data-emp-add-note>הוסף</button></div></div>' : '') +
        (resolutionNote ? '<div class="dash-section-divider">פתרון</div>' +
            '<div style="background:var(--background);border-radius:10px;padding:10px 12px;font-size:14px;white-space:pre-wrap">' +
            escapeHtml(resolutionNote.message) + '</div>' : '');

    var descPencilBtn = el.querySelector('[data-edit-content]');
    if (descPencilBtn) {
        descPencilBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleEmployeeEditForm(editForm, t, 'content');
        });
    }

    var noteInput = el.querySelector('[data-emp-note-input]');
    var addNoteBtn = el.querySelector('[data-emp-add-note]');
    function submitNote() {
        var note = noteInput.value.trim();
        if (note) employeeAddNote(t, note);
    }
    if (addNoteBtn) addNoteBtn.addEventListener('click', submitNote);
    if (noteInput) {
        noteInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); submitNote(); }
        });
    }
}

async function employeeAddNote(t, message) {
    showLoading(true);
    var res = await apiPost('tickets', 'addNote', { ticketNumber: t.ticketNumber, message: message });
    showLoading(false);
    if (!res.ok) { alert(res.error || 'שגיאה'); return; }
    if (openEmployeeRow) loadEmployeeTicketDetail(t, openEmployeeRow.cardEl, openEmployeeRow.detailEl, openEmployeeRow.editForm);
}

function closeEmployeeEditForm(editForm) {
    if (!editForm) return;
    editForm.style.display = 'none';
    editForm.innerHTML = '';
    editForm.removeAttribute('data-mode');
}

function toggleEmployeeEditForm(editForm, t, mode) {
    var alreadyOpenSameMode = editForm.style.display !== 'none' && editForm.getAttribute('data-mode') === mode;
    if (alreadyOpenSameMode) { closeEmployeeEditForm(editForm); return; }
    editForm.setAttribute('data-mode', mode);
    editForm.style.display = 'block';
    if (mode === 'type') renderEmployeeEditTypeForm(editForm, t);
    else renderEmployeeEditContentForm(editForm, t);
}

function renderEmployeeEditTypeForm(editForm, t) {
    var categories = ticketConfigCache ? ticketConfigCache.categories : [];
    editForm.innerHTML =
        '<div class="field"><label>סוג תקלה</label><select data-ef-category></select></div>' +
        '<div class="field" data-ef-subcategory-field style="display:none"><label>פירוט</label><select data-ef-subcategory></select></div>' +
        '<div data-ef-error style="display:none;color:var(--danger);font-size:13px;margin-bottom:6px"></div>' +
        '<div style="display:flex;gap:8px"><button type="button" class="primary-button" data-ef-save style="flex:1">שמירה</button>' +
        '<button type="button" class="secondary-button" data-ef-cancel>ביטול</button></div>';

    var catSel = editForm.querySelector('[data-ef-category]');
    catSel.innerHTML = categories.map(function (c) {
        return '<option' + (c.name === t.category ? ' selected' : '') + '>' + escapeHtml(c.name) + '</option>';
    }).join('');

    function refreshSubOptions(selectedName) {
        var category = categoryByName(catSel.value);
        var subs = category ? category.subcategories : [];
        var field = editForm.querySelector('[data-ef-subcategory-field]');
        var subSel = editForm.querySelector('[data-ef-subcategory]');
        if (!subs.length) { field.style.display = 'none'; subSel.innerHTML = ''; return; }
        field.style.display = 'block';
        subSel.innerHTML = subs.map(function (s) {
            return '<option' + (s.name === selectedName ? ' selected' : '') + '>' + escapeHtml(s.name) + '</option>';
        }).join('');
    }
    catSel.addEventListener('change', function () { refreshSubOptions(null); });
    refreshSubOptions(t.subcategory);

    editForm.querySelector('[data-ef-cancel]').addEventListener('click', function () { closeEmployeeEditForm(editForm); });
    editForm.querySelector('[data-ef-save]').addEventListener('click', async function () {
        var subField = editForm.querySelector('[data-ef-subcategory-field]');
        var subVisible = subField.style.display !== 'none';
        var subValue = subVisible ? editForm.querySelector('[data-ef-subcategory]').value : '';
        var errEl = editForm.querySelector('[data-ef-error]');
        if (subVisible && !subValue) {
            errEl.textContent = 'יש לבחור פירוט לסוג התקלה'; errEl.style.display = 'block';
            return;
        }
        showLoading(true);
        var res = await apiPost('tickets', 'update', { ticketNumber: t.ticketNumber, category: catSel.value, subcategory: subValue });
        showLoading(false);
        if (res.ok) { closeEmployeeEditForm(editForm); refreshMyTickets(); }
        else { errEl.textContent = res.error || 'שגיאה בשמירה'; errEl.style.display = 'block'; }
    });
}

function renderEmployeeEditContentForm(editForm, t) {
    editForm.innerHTML =
        '<div class="field"><label>תיאור התקלה</label><textarea data-ef-description rows="4"></textarea></div>' +
        '<div data-ef-error style="display:none;color:var(--danger);font-size:13px;margin-bottom:6px"></div>' +
        '<div style="display:flex;gap:8px"><button type="button" class="primary-button" data-ef-save style="flex:1">שמירה</button>' +
        '<button type="button" class="secondary-button" data-ef-cancel>ביטול</button></div>';
    editForm.querySelector('[data-ef-description]').value = t.description || '';
    editForm.querySelector('[data-ef-cancel]').addEventListener('click', function () { closeEmployeeEditForm(editForm); });
    editForm.querySelector('[data-ef-save]').addEventListener('click', async function () {
        var description = editForm.querySelector('[data-ef-description]').value.trim();
        var errEl = editForm.querySelector('[data-ef-error]');
        if (!description) { errEl.textContent = 'יש למלא תיאור התקלה'; errEl.style.display = 'block'; return; }
        showLoading(true);
        var res = await apiPost('tickets', 'update', { ticketNumber: t.ticketNumber, description: description });
        showLoading(false);
        if (res.ok) { closeEmployeeEditForm(editForm); refreshMyTickets(); }
        else { errEl.textContent = res.error || 'שגיאה בשמירה'; errEl.style.display = 'block'; }
    });
}

function buildEmployeeTicketRow(t) {
    var wrap = document.createElement('div');
    var card = document.createElement('div');
    card.className = 'ticket-card dash-ticket-card';
    card.innerHTML = employeeTicketRowInnerHtml(t);

    var editForm = document.createElement('div');
    editForm.className = 'dash-ticket-detail';
    editForm.style.display = 'none';
    editForm.addEventListener('click', function (e) { e.stopPropagation(); });

    var detail = document.createElement('div');
    detail.className = 'dash-ticket-detail';
    detail.style.display = 'none';
    detail.addEventListener('click', function (e) { e.stopPropagation(); });

    card.addEventListener('click', function () { toggleEmployeeTicketDetail(t, card, detail, editForm); });
    card.querySelectorAll('[data-stop]').forEach(function (el) { el.addEventListener('click', function (e) { e.stopPropagation(); }); });

    var editTypeBtn = card.querySelector('[data-edit-type]');
    if (editTypeBtn) editTypeBtn.addEventListener('click', function () { toggleEmployeeEditForm(editForm, t, 'type'); });

    wrap.appendChild(card);
    wrap.appendChild(editForm);
    wrap.appendChild(detail);
    return { wrap: wrap, card: card, detail: detail, editForm: editForm };
}

// "קריאות שטופלו" is always visible now (no more
// show/hide toggle) — closed tickets load 10 at a time, "הצג עוד" reveals more
// instead of the whole (potentially long) history dumping in at once.
var closedTicketsDisplayLimit = 10;

function renderClosedTickets() {
    var closed = myTickets.filter(function (t) { return t.status === 'סגורה'; });
    var container = document.getElementById('closedTicketsList');
    if (openEmployeeTicketNumber && closed.every(function (t) { return t.ticketNumber !== openEmployeeTicketNumber; })) {
        closeEmployeeTicketDetail();
    }
    var visible = closed.slice(0, closedTicketsDisplayLimit);
    employeeRowElements = {};
    container.innerHTML = visible.length ? '' : '<p style="color:var(--muted);font-size:13px">אין קריאות סגורות.</p>';
    visible.forEach(function (t) {
        var built = buildEmployeeTicketRow(t);
        employeeRowElements[t.ticketNumber] = built;
        container.appendChild(built.wrap);
    });
    document.getElementById('closedTicketsLoadMoreBtn').style.display = closed.length > visible.length ? 'block' : 'none';
}

document.getElementById('closedTicketsLoadMoreBtn').addEventListener('click', function () {
    closedTicketsDisplayLimit += 10;
    renderClosedTickets();
});

var TICKET_FIELD_LABELS = {
    Category: 'קטגוריה', Urgency: 'דחיפות', Description: 'תיאור', ComputerName: 'מחשב',
    IP: 'IP', Printer: 'מדפסת', AnyDeskId: 'AnyDesk', Status: 'סטטוס',
};

function describeLogEntry(entry) {
    if (entry.action === 'field_updated') {
        return (TICKET_FIELD_LABELS[entry.fieldName] || entry.fieldName) + ' שונה: "' +
            (entry.oldValue || '') + '" ← "' + (entry.newValue || '') + '"';
    }
    if (entry.action === 'status_changed') return 'סטטוס שונה: ' + entry.oldValue + ' ← ' + entry.newValue;
    return entry.message || entry.action;
}

function renderLogEntry(entry) {
    var text = describeLogEntry(entry);
    return '<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">' +
        '<div style="color:var(--muted)">' + formatDateTime(entry.timestamp) + ' - ' + escapeHtml(entry.actorName || entry.actorEmail) + '</div>' +
        '<div style="margin-top:2px">' + escapeHtml(text) + '</div></div>';
}

// Timeline-style rendering used by the dashboard's inline ticket expansion.
// `ticket` (optional) lets us tell an IT admin's action apart from the requester's
// own — anyone other than the ticket's original owner acting on it is IT staff
// (only IT-only endpoints write these entries), so their name gets colored.
export function renderTimelineEntry(entry, ticket) {
    var text = describeLogEntry(entry);
    var user = Portal.getUser();
    var isNoteLike = entry.action === 'note' || entry.action === 'internal_note';
    var isMine = isNoteLike && entry.actorEmail && user && user.email &&
        String(entry.actorEmail).toLowerCase() === String(user.email).toLowerCase();
    var idAttr = isMine ? ' data-log-id="' + entry.id + '"' : '';
    var dotClass = 'dash-timeline-dot' + (isMine ? ' editable' : '');
    var internalTag = entry.action === 'internal_note' ? '<span class="dash-timeline-internal-tag">פנימי</span>' : '';
    var actorName = escapeHtml(entry.actorName || entry.actorEmail);
    var isItActor = ticket && entry.actorEmail && String(entry.actorEmail).toLowerCase() !== String(ticket.userEmail || '').toLowerCase();
    var actorHtml = isItActor ? '<span class="dash-it-actor">' + actorName + '</span>' : '<span class="dash-user-actor">' + actorName + '</span>';
    return '<div class="dash-timeline-item"' + idAttr + '>' +
        '<span class="' + dotClass + '"' + (isMine ? ' title="לחץ לעריכת ההערה"' : '') + '></span>' +
        '<div class="dash-timeline-time">' + formatDateTime(entry.timestamp) + ' · ' + actorHtml + '</div>' +
        '<div class="dash-timeline-text">' + internalTag + '<span data-log-text>' + escapeHtml(text) + '</span></div></div>';
}

// Every mutation is refetched from the server, never trusted from local state.
function refreshTicketViews() {
    if (document.getElementById('view-ticket').classList.contains('active')) refreshMyTickets();
    if (isHubActive() && Portal.isITAdmin()) loadHubDashboard();
}

var ticketDetailTracker = makeDirtyTracker(document.getElementById('ticketDetailBackdrop'));

async function openTicketDetail(ticketSummary) {
    document.getElementById('ticketDetailTitle').textContent = ticketSummary.ticketNumber;
    document.getElementById('ticketDetailBody').innerHTML = '<p style="color:var(--muted);font-size:13px">טוען...</p>';
    document.getElementById('ticketDetailBackdrop').classList.add('visible');
    ticketDetailTracker.reset();

    var res = await apiGet('tickets', 'get', { ticketNumber: ticketSummary.ticketNumber });
    if (!res.ok) {
        document.getElementById('ticketDetailBody').innerHTML = '<p style="color:var(--danger)">' + escapeHtml(res.error || 'שגיאה בטעינה') + '</p>';
        return;
    }
    renderTicketDetail(res.data.ticket, res.data.log);
}

function renderTicketDetail(t, log) {
    var user = Portal.getUser();
    var isOwner = String(t.userEmail).toLowerCase() === String(user.email).toLowerCase();
    var canEdit = isOwner && t.status === 'פתוחה';
    var isIT = Portal.isITAdmin();

    var actionsHtml = '';
    if (canEdit) actionsHtml += '<button type="button" class="secondary-button" id="ticketDetailEditBtn">ערוך קריאה</button>';
    if (isIT && t.status === 'פתוחה') actionsHtml += '<button type="button" class="primary-button" id="ticketDetailTakeBtn">קח קריאה</button>';
    if (isIT && t.status === 'בטיפול') actionsHtml += '<button type="button" class="secondary-button" id="ticketDetailCloseTicketBtn">סגור קריאה</button>';

    document.getElementById('ticketDetailBody').innerHTML =
        '<div style="display:grid;gap:10px;font-size:14px">' +
        '<div><strong>סטטוס:</strong> ' + escapeHtml(t.status) + '</div>' +
        '<div><strong>קטגוריה:</strong> ' + escapeHtml(t.category) + '</div>' +
        '<div><strong>דחיפות:</strong> ' + escapeHtml(t.urgency) + '</div>' +
        '<div><strong>מחשב:</strong> ' + escapeHtml(t.computerName) + '</div>' +
        '<div><strong>תאריך פתיחה:</strong> ' + formatDateTime(t.timestamp) + '</div>' +
        (t.assignedToName ? '<div><strong>מטופל ע"י:</strong> ' + escapeHtml(t.assignedToName) + '</div>' : '') +
        '<div><strong>תיאור:</strong><br><span style="white-space:pre-wrap">' + escapeHtml(t.description) + '</span></div>' +
        '<div id="ticketDetailEditForm" style="display:none"></div>' +
        (actionsHtml ? '<div style="display:flex;gap:8px;flex-wrap:wrap">' + actionsHtml + '</div>' : '') +
        (isIT ? '<div class="field" style="margin:0"><label for="ticketDetailNoteInput">הוסף הערה</label>' +
            '<div style="display:flex;gap:8px"><input id="ticketDetailNoteInput" type="text" style="flex:1">' +
            '<button type="button" class="secondary-button" id="ticketDetailAddNoteBtn">הוסף</button></div></div>' : '') +
        '<div><strong>היסטוריה:</strong><div style="margin-top:6px" id="ticketDetailLog">' +
        (log.length ? log.map(renderLogEntry).join('') : '<span style="color:var(--muted);font-size:12px">אין רשומות</span>') +
        '</div></div>' +
        '</div>';

    var addNoteBtn = document.getElementById('ticketDetailAddNoteBtn');
    if (addNoteBtn) {
        addNoteBtn.addEventListener('click', async function () {
            var input = document.getElementById('ticketDetailNoteInput');
            var note = input.value.trim();
            if (!note) return;
            showLoading(true);
            var res = await apiPost('tickets', 'updateStatus', { ticketNumber: t.ticketNumber, status: t.status, message: note });
            showLoading(false);
            if (res.ok) { refreshTicketViews(); openTicketDetail(t); } else alert(res.error || 'שגיאה');
        });
    }

    var editBtn = document.getElementById('ticketDetailEditBtn');
    if (editBtn) editBtn.addEventListener('click', function () { openTicketEditForm(t); });
    var takeBtn = document.getElementById('ticketDetailTakeBtn');
    if (takeBtn) takeBtn.addEventListener('click', function () { takeTicket(t); });
    var closeTicketBtn = document.getElementById('ticketDetailCloseTicketBtn');
    if (closeTicketBtn) closeTicketBtn.addEventListener('click', function () { closeTicketWithNote(t); });
}

function openTicketEditForm(t) {
    var container = document.getElementById('ticketDetailEditForm');
    container.style.display = 'block';
    container.innerHTML =
        '<div class="field"><label>קטגוריה</label><select id="tdEditCategory"></select></div>' +
        '<div class="field"><label>תיאור</label><textarea id="tdEditDescription" rows="4"></textarea></div>' +
        '<button type="button" class="primary-button" id="tdEditSaveBtn" style="width:100%">שמירת שינויים</button>';
    var sel = container.querySelector('#tdEditCategory');
    var categories = ticketConfigCache ? ticketConfigCache.categories : [];
    sel.innerHTML = categories.map(function (c) {
        return '<option' + (c.name === t.category ? ' selected' : '') + '>' + escapeHtml(c.name) + '</option>';
    }).join('');
    container.querySelector('#tdEditDescription').value = t.description || '';
    container.querySelector('#tdEditSaveBtn').addEventListener('click', async function () {
        showLoading(true);
        var res = await apiPost('tickets', 'update', {
            ticketNumber: t.ticketNumber,
            category: sel.value,
            description: container.querySelector('#tdEditDescription').value.trim(),
        });
        showLoading(false);
        if (res.ok) { refreshTicketViews(); openTicketDetail(t); }
        else alert(res.error || 'שגיאה בשמירה');
    });
}

async function takeTicket(t) {
    showLoading(true);
    var res = await apiPost('tickets', 'take', { ticketNumber: t.ticketNumber });
    showLoading(false);
    if (res.ok) { refreshTicketViews(); openTicketDetail(t); }
    else alert(res.error || 'שגיאה');
}

async function closeTicketWithNote(t) {
    var note = prompt('הערת סגירה (אופציונלי):', '') || '';
    showLoading(true);
    var res = await apiPost('tickets', 'updateStatus', { ticketNumber: t.ticketNumber, status: 'סגורה', message: note });
    showLoading(false);
    if (res.ok) { refreshTicketViews(); openTicketDetail(t); }
    else alert(res.error || 'שגיאה');
}

document.getElementById('ticketDetailCloseBtn').addEventListener('click', function () {
    if (ticketDetailTracker.confirmDiscard()) document.getElementById('ticketDetailBackdrop').classList.remove('visible');
});

// ── ITEM 5: admin correction of mis-entered ticket fields (with audit log) ──
var ticketFieldsModal = document.getElementById('ticketFieldsModalBackdrop');
var ticketFieldsError = document.getElementById('ticketFieldsModalError');
var ticketFieldsTracker = makeDirtyTracker(ticketFieldsModal);
var editingTicketFields = null;
var tfUsersCache = null;
var tfComputerNamesCache = null;

async function ensureTfAutocompleteData() {
    if (!tfUsersCache) {
        var uRes = await apiGet('users', 'list', {});
        tfUsersCache = uRes.ok ? uRes.data : [];
    }
    if (!tfComputerNamesCache) {
        var cRes = await apiGet('computers', 'listNames', {});
        tfComputerNamesCache = cRes.ok ? cRes.data : [];
    }
    await ensurePrintersLoaded();
}

// Populates the subcategory <select> for whichever category is currently chosen in
// the modal — same source (ticketConfigCache) as the ticket-submission form's own
// subcategory field, so an admin correction offers exactly the same options.
function populateTfSubcategoryOptions(categoryName, selectedSubcategory) {
    var field = document.getElementById('tfSubcategoryField');
    var sel = document.getElementById('tfSubcategory');
    var category = categoryByName(categoryName);
    var subs = category ? category.subcategories : [];
    if (!subs.length) { field.style.display = 'none'; sel.innerHTML = ''; return; }
    field.style.display = 'block';
    sel.innerHTML = subs.map(function (s) {
        return '<option' + (s.name === selectedSubcategory ? ' selected' : '') + '>' + escapeHtml(s.name) + '</option>';
    }).join('');
}

document.getElementById('tfCategory').addEventListener('change', function () {
    populateTfSubcategoryOptions(this.value, null);
});

export async function openTicketEditFieldsModal(t) {
    editingTicketFields = t;
    document.getElementById('tfTicketNumber').textContent = t.ticketNumber;
    showLoading(true);
    await ensureTfAutocompleteData();
    showLoading(false);

    var catSel = document.getElementById('tfCategory');
    var categories = ticketConfigCache ? ticketConfigCache.categories : [];
    catSel.innerHTML = categories.map(function (c) {
        return '<option' + (c.name === t.category ? ' selected' : '') + '>' + escapeHtml(c.name) + '</option>';
    }).join('');
    populateTfSubcategoryOptions(catSel.value, t.subcategory);

    var urgSel = document.getElementById('tfUrgency');
    var urgencies = ticketConfigCache ? ticketConfigCache.urgencies : [];
    urgSel.innerHTML = urgencies.map(function (u) {
        return '<option' + (u.name === t.urgency ? ' selected' : '') + '>' + escapeHtml(u.name) + '</option>';
    }).join('');

    // Text inputs paired with a <datalist>: typing filters the native
    // browser suggestion dropdown against the real users/computers/printers lists.
    document.getElementById('tfUserNameOptions').innerHTML = tfUsersCache.map(function (u) {
        var name = [u.firstName, u.lastName].filter(Boolean).join(' ');
        return name ? '<option value="' + escapeHtml(name) + '">' : '';
    }).join('');
    document.getElementById('tfUserName').value = t.userName || '';

    document.getElementById('tfComputerNameOptions').innerHTML = tfComputerNamesCache.map(function (n) {
        return '<option value="' + escapeHtml(n) + '">';
    }).join('');
    document.getElementById('tfComputerName').value = t.computerName || '';

    // Always available (not just for tickets already flagged as printer tickets) —
    // this is also how a mis-categorized ticket (e.g. printer-related category picked
    // without the separate toggle) gets corrected: assigning a printer here flips
    // IsPrinterTicket server-side, same inference the submission form now applies.
    document.getElementById('tfPrinterField').style.display = 'block';
    document.getElementById('tfPrinterOptions').innerHTML = (printersCache || []).map(function (p) {
        return '<option value="' + escapeHtml(p.printerName) + '">';
    }).join('');
    document.getElementById('tfPrinter').value = t.printer || '';

    ticketFieldsError.style.display = 'none';
    ticketFieldsModal.classList.add('visible');
    ticketFieldsTracker.reset();
}

function closeTicketFieldsModal() { ticketFieldsModal.classList.remove('visible'); }

document.getElementById('ticketFieldsCancelBtn').addEventListener('click', function () {
    if (ticketFieldsTracker.confirmDiscard()) closeTicketFieldsModal();
});

document.getElementById('ticketFieldsSaveBtn').addEventListener('click', async function () {
    if (!editingTicketFields) return;
    var subcategoryVisible = document.getElementById('tfSubcategoryField').style.display !== 'none';
    var payload = {
        ticketNumber: editingTicketFields.ticketNumber,
        category: document.getElementById('tfCategory').value,
        subcategory: subcategoryVisible ? document.getElementById('tfSubcategory').value : '',
        urgency: document.getElementById('tfUrgency').value,
        userName: document.getElementById('tfUserName').value.trim(),
        computerName: document.getElementById('tfComputerName').value.trim(),
        printer: document.getElementById('tfPrinter').value.trim(),
    };
    showLoading(true);
    var res = await apiPost('tickets', 'adminUpdateFields', payload);
    showLoading(false);
    if (!res.ok) {
        ticketFieldsError.textContent = res.error || 'שגיאה בשמירה';
        ticketFieldsError.style.display = 'block';
        return;
    }
    ticketFieldsTracker.reset();
    closeTicketFieldsModal();
    // Mirrors the server's own inference (adminUpdateFields): actually changing the
    // printer field to a non-empty value flips isPrinterTicket, so the printer
    // quick-tag can appear immediately without waiting for the next full refresh.
    var printerChanged = payload.printer && payload.printer !== (editingTicketFields.printer || '');
    var isPrinterTicket = (printerChanged && !editingTicketFields.isPrinterTicket) ? true : editingTicketFields.isPrinterTicket;
    patchDashboardTicket(payload.ticketNumber, {
        category: payload.category, subcategory: payload.subcategory, urgency: payload.urgency,
        userName: payload.userName, computerName: payload.computerName, printer: payload.printer,
        isPrinterTicket: isPrinterTicket,
    });
    refreshOpenDashboardDetail();
});

document.getElementById('ticketSubmitBtn').addEventListener('click', async function () {
    var errEl = document.getElementById('ticketSubmitError');
    errEl.style.display = 'none';

    var category = document.getElementById('tkCategory').value;
    var description = document.getElementById('tkDescription').value.trim();
    var subcategoryField = document.getElementById('tkSubcategoryField');
    var subcategory = subcategoryField.style.display !== 'none' ? document.getElementById('tkSubcategory').value : '';
    var subcategoryRequired = subcategoryField.style.display !== 'none';

    // Whenever the chosen "פירוט" (subcategory) value is itself a real printer name
    // (whether that dropdown is the dynamic "printers-by-branch" catalog picker or a
    // plain static list an admin filled with printer names), the user has already
    // told us exactly which printer this is about — that alone marks the ticket as a
    // printer ticket, no need to also flip the separate "for: מחשב/מדפסת" toggle.
    var subcategoryIsPrinterName = !!subcategory && (printersCache || []).some(function (p) { return p.printerName === subcategory; });
    var isPrinterTicket = subcategoryIsPrinterName
        ? true
        : document.querySelector('input[name="tkForType"]:checked').value === 'printer';
    var printerName = isPrinterTicket
        ? (subcategoryIsPrinterName ? subcategory : document.getElementById('tkPrinterSelect').value)
        : '';
    if (!category || !tkSelectedUrgencyName || !description || (isPrinterTicket && !printerName) || (subcategoryRequired && !subcategory)) {
        errEl.textContent = isPrinterTicket && !printerName ? 'יש לבחור מדפסת' :
            (subcategoryRequired && !subcategory ? 'יש לבחור פירוט לסוג התקלה' : 'יש למלא את כל שדות החובה.');
        errEl.style.display = 'block';
        return;
    }

    var payload = {
        userName: document.getElementById('tkName').value,
        phone: document.getElementById('tkPhone').value,
        branch: document.getElementById('tkBranch').value,
        computerName: document.getElementById('tkComputerName').value,
        printer: document.getElementById('tkPrinter').value,
        printerName: printerName,
        anyDeskId: document.getElementById('tkAnyDesk').value,
        category: category,
        subcategory: subcategory,
        urgency: tkSelectedUrgencyName,
        description: description,
    };

    showLoading(true);
    try {
        var res = await apiPost('tickets', 'create', payload);
        showLoading(false);
        if (res.ok) {
            document.getElementById('tkDescription').value = ''; // never leave old text sitting in the field
            document.getElementById('confirmTicketNumber').textContent = res.data.ticketNumber;
            document.getElementById('ticketSuccessModalBackdrop').classList.add('visible');
            refreshMyTickets();
            setTimeout(function () {
                document.getElementById('ticketSuccessModalBackdrop').classList.remove('visible');
                showView('hub');
            }, 2500);
        } else {
            errEl.textContent = res.error || 'שגיאה בשליחת הקריאה';
            errEl.style.display = 'block';
        }
    } catch (e) {
        showLoading(false);
        errEl.textContent = 'שגיאה בחיבור לשרת';
        errEl.style.display = 'block';
    }
});


export function resetTicketConfigCache() { ticketConfigCache = null; }
