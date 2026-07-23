import { openComputerAdminModal } from './admin-computers.js';
import { openPrinterAdminModal } from './admin-printers.js';
import { openUserAdminModal, setComputersCache } from './admin-users.js';
import { Portal, apiGet, apiPost } from './api-client.js';
import { branchName, ensureBranchesLoaded, ensurePrintersLoaded, escapeHtml, formatDateTime, makeDirtyTracker, printersCache, showLoading } from './common-ui.js';
import { showView } from './nav.js';
import { openProfileModal } from './profile.js';
import { URGENCY_COLOR, URGENCY_SEVERITY, applyOpenRowBlink, hexToRgb, openTicketEditFieldsModal, renderTimelineEntry } from './tickets.js';
import { openUserRequestDetail } from './user-requests.js';

// ── HUB VIEW ──────────────────────────────────────────────
var HUB_BUTTONS = [
    { id: 'ticket', icon: '📋', label: 'פתיחת קריאה' },
    { id: 'signature', icon: '✍️', label: 'יצירת חתימה' },
    { id: 'procedures', icon: '📖', label: 'נהלי עבודה' },
];

// Section for anyone with the user-request-submitter permission — separate from the
// main grid so it reads as its own tier, and separate from HUB_ADMIN_BUTTONS since
// submitters aren't necessarily IT/Procedures/SuperAdmins.
var HUB_GENERAL_BUTTONS = [
    { id: 'user-request', icon: '🧑‍💼', label: 'בקשת הקמת משתמש', check: function () { return Portal.isUserRequestSubmitter(); } },
    { id: 'admin-procedure-config', icon: '📖', label: 'עריכת נהלי עבודה', check: function () { return Portal.isProceduresAdmin(); } },
];

var HUB_ADMIN_BUTTONS = [
    // IT-only (and SuperAdmin) — a plain "עריכת נהלים" permission must never grant this,
    // it's a completely separate axis (see the 3-permission model: IT / נהלים / בקשת משתמש).
    { id: 'admin-users', icon: '👥', label: 'ניהול משתמשים', check: function () {
        return Portal.isSuperAdmin() || Portal.isITAdmin();
    } },
    { id: 'admin-computers', icon: '💻', label: 'ניהול מחשבים', check: function () { return Portal.isITAdmin(); } },
    { id: 'admin-printers', icon: '🖨️', label: 'קטלוג מדפסות', check: function () { return Portal.isITAdmin(); } },
    { id: 'admin-ticket-config', icon: '🏷️', label: 'סוגי קריאות', check: function () { return Portal.isITAdmin(); } },
    { id: 'admin-view-as', icon: '👁️', label: 'התחזות למשתמש', check: function () { return Portal.isITAdmin(); } },
];

var HUB_SUPERADMIN_BUTTONS = [
    { id: 'admin-branches', icon: '🏢', label: 'ניהול סניפים', check: function () { return Portal.isSuperAdmin(); } },
    { id: 'admin-sharedfolders', icon: '📁', label: 'תיקיות משותפות', check: function () { return Portal.isSuperAdmin(); } },
    { id: 'admin-email-settings', icon: '📧', label: 'ניהול כתובות מייל', check: function () { return Portal.isSuperAdmin(); } },
];

function renderHubButtons(container, buttons) {
    container.innerHTML = '';
    buttons.forEach(function (btn) {
        var el = document.createElement('button');
        el.className = 'hub-btn';
        el.type = 'button';
        el.innerHTML = '<span class="hub-btn-icon">' + btn.icon + '</span>' + escapeHtml(btn.label);
        el.addEventListener('click', function () { showView(btn.id); });
        container.appendChild(el);
    });
}

export function renderHubActions() {
    var mainButtons = HUB_BUTTONS.filter(function (b) { return !b.check || b.check(); });
    renderHubButtons(document.getElementById('hubActions'), mainButtons);

    var generalButtons = HUB_GENERAL_BUTTONS.filter(function (b) { return b.check(); });
    document.getElementById('hubGeneralSection').style.display = generalButtons.length ? 'block' : 'none';
    renderHubButtons(document.getElementById('hubGeneralActions'), generalButtons);

    var adminButtons = HUB_ADMIN_BUTTONS.filter(function (b) { return b.check(); });
    var superAdminButtons = HUB_SUPERADMIN_BUTTONS.filter(function (b) { return b.check(); });
    document.getElementById('hubAdminSection').style.display = (adminButtons.length || superAdminButtons.length) ? 'block' : 'none';
    renderHubButtons(document.getElementById('hubAdminActions'), adminButtons);
    document.getElementById('hubSuperAdminSection').style.display = superAdminButtons.length ? 'block' : 'none';
    renderHubButtons(document.getElementById('hubSuperAdminActions'), superAdminButtons);
}

export function renderHubGreeting() {
    var user = Portal.getUser();
    var greetingEl = document.getElementById('hubGreeting');
    var infoEl = document.getElementById('hubUserInfo');
    var name = [user.firstName, user.lastName].filter(Boolean).join(' ');
    greetingEl.innerHTML = 'שלום' + (name ? ', ' + escapeHtml(name) : '') +
        '<button type="button" class="hub-edit-pencil" id="hubEditPencil" title="עריכת פרטים">✏️</button>';
    document.getElementById('hubEditPencil').addEventListener('click', openProfileModal);
    infoEl.textContent = [user.role, branchName(user.branchNumber)].filter(Boolean).join(' | ');
}

// ── HUB DASHBOARD ──────
var dashboardOpenTickets = [];
var dashAllUserRequests = []; // ALL user-creation requests (every status) — the "משימות" tab needs חדש/בטיפול/הושלם, not just pending
var dashFollowUps = []; // TicketFollowUps — lazy-loaded, same "משימות" tab
var dashFollowUpsLoaded = false;
var dashProcurementTasks = []; // ProcurementTasks (new-computer orders) — 3rd task kind, same "משימות" tab
var dashboardClosedTickets = null; // null = not fetched yet (lazy, behind the "סגורות" cube)
var dashboardRefreshTimer = null;
var dashStatusFilter = null; // null = open+in-progress (default) | 'פתוחה' | 'בטיפול' | 'סגורה' — set by clicking a cube
var dashViewMode = 'tickets'; // 'tickets' | 'tasks' — the 4th cube switches the whole table to a different data source
var dashTaskStatusFilter = null; // null = show all statuses (default) | 'חדש' | 'בטיפול' | 'הושלם'
var dashSortBy = 'urgency'; // 'urgency' | 'date' | 'branch'
var dashDisplayLimit = 30; // pagination — "הצג עוד" adds 30 more, client-side only
var openDashboardTicketNumber = null; // survives re-renders; the reused DOM node keeps its content untouched
var openDashboardRow = null; // { cardEl, detailEl } of the currently-expanded row
var dashRowElements = {}; // ticketNumber -> { wrap, card, detail } — reused across refreshes so an open row never gets torn down
var dashTicketsByNumber = {}; // ticketNumber -> latest ticket object, so click handlers never act on stale data
var dashFocusedTicketNumber = null; // isolates the table on one ticket right after taking it
var dashComputersByName = {}; // computerName -> live Computers row — AnyDesk tag reads from here, not the ticket's own (possibly stale) snapshot

export function isHubActive() { return document.getElementById('view-hub').classList.contains('active'); }

export async function loadHubDashboard() {
    var block = document.getElementById('hubTicketsDashboard');
    if (!Portal.isITAdmin()) { block.style.display = 'none'; return; }
    block.style.display = 'block';

    var listRes = await apiGet('tickets', 'list', {});
    dashboardOpenTickets = listRes.ok ? listRes.data : [];
    var countRes = await apiGet('tickets', 'closedCount', {});
    var closedCount = countRes.ok ? countRes.data.count : 0;
    var reqRes = await apiGet('userRequests', 'list', {});
    dashAllUserRequests = reqRes.ok ? reqRes.data : [];
    // Always loaded now — the default ticket view merges in
    // open/in-progress tasks too, not just whenever the dedicated tasks tab is open.
    var followUpsRes = await apiGet('tickets', 'listFollowUps', {});
    dashFollowUps = followUpsRes.ok ? followUpsRes.data : [];
    dashFollowUpsLoaded = true;
    // Best-effort — empty (not an error banner) on a DB that hasn't run the
    // ProcurementTasks migration yet (infra/schema.sql).
    var procRes = await apiGet('procurementTasks', 'list', {});
    dashProcurementTasks = procRes.ok ? procRes.data : [];
    // Live computer records — a ticket's own AnyDeskId
    // is only a creation-time snapshot; if the computer's AnyDesk ID was added or
    // changed afterward, the ticket's copy stays stale. The AnyDesk tag reads the
    // CURRENT value from here instead.
    var dashComputersRes = await apiGet('computers', 'list', {});
    dashComputersByName = {};
    if (dashComputersRes.ok) {
        dashComputersRes.data.forEach(function (c) { dashComputersByName[c.computerName] = c; });
    }
    var pendingRequests = dashAllUserRequests.filter(function (r) { return r.status !== 'הוקם'; }).length;
    var openFollowUps = dashFollowUps.filter(function (f) { return f.status !== 'הושלם'; }).length;
    var openProcurements = dashProcurementTasks.filter(function (p) { return p.status !== 'הושלם'; }).length;
    document.getElementById('dashFollowupsCount').textContent = pendingRequests + openFollowUps + openProcurements;

    renderDashboardCounts(closedCount);
    renderDashboardUserFilter();
    renderDashboardBranchFilter();
    renderDashboardUrgencyFilter();
    if (dashViewMode === 'tasks') renderDashboardTaskTypeFilter();
    renderDashboardCharts();
    updateDashCubeActiveClasses();
    if (dashViewMode === 'tasks') renderDashboardTasksList(); else renderDashboardTicketsList();
}

function renderDashboardCounts(closedCount) {
    var openCount = dashboardOpenTickets.filter(function (t) { return t.status === 'פתוחה'; }).length;
    var progressCount = dashboardOpenTickets.filter(function (t) { return t.status === 'בטיפול'; }).length;
    document.getElementById('dashOpenCount').textContent = openCount;
    document.getElementById('dashProgressCount').textContent = progressCount;
    document.getElementById('dashClosedCount').textContent = closedCount;
}

// Whichever status-cube is active (or none = open+in-progress) — the base array
// everything else (charts, popover counts, the table) is derived from.
function getStatusFilteredSource() {
    if (dashStatusFilter === 'סגורה') return dashboardClosedTickets || [];
    // dashboardOpenTickets is the server's non-closed set at last fetch, but an
    // optimistic status patch can flip one of its own tickets to סגורה
    // in place — always exclude those from the open/in-progress view regardless.
    return dashboardOpenTickets.filter(function (t) {
        if (t.status === 'סגורה') return false;
        return dashStatusFilter === null || t.status === dashStatusFilter;
    });
}

function msBetween(a, b) { return new Date(b) - new Date(a); }

function formatDuration(ms) {
    if (ms == null || isNaN(ms) || ms < 0) return '';
    var mins = Math.floor(ms / 60000);
    if (mins < 1) return 'פחות מדקה';
    if (mins < 60) return mins + ' ד׳';
    var hours = Math.floor(mins / 60);
    var remMins = mins % 60;
    if (hours < 24) return hours + ' ש׳' + (remMins ? ' ' + remMins + ' ד׳' : '');
    var days = Math.floor(hours / 24);
    var remHours = hours % 24;
    return days + ' י׳' + (remHours ? ' ' + remHours + ' ש׳' : '');
}

// Per-row elapsed-time breakdown: what's shown depends
// on the ticket's own status, not the current cube filter, so it stays correct even
// when tickets from more than one status share the table.
function dashboardElapsedHtml(t) {
    var now = new Date();
    var opened = new Date(t.timestamp);
    if (t.status === 'פתוחה') return 'פתוחה ' + formatDuration(now - opened);
    if (t.status === 'בטיפול') {
        var taken = t.takenAt ? new Date(t.takenAt) : null;
        var parts = [];
        if (taken) parts.push('המתנה לטיפול: ' + formatDuration(taken - opened));
        parts.push('בטיפול: ' + formatDuration(now - (taken || opened)));
        return parts.join(' · ');
    }
    var taken2 = t.takenAt ? new Date(t.takenAt) : null;
    var closed = t.closedAt ? new Date(t.closedAt) : null;
    var parts2 = [];
    if (taken2) parts2.push('המתנה: ' + formatDuration(taken2 - opened));
    if (taken2 && closed) parts2.push('טיפול: ' + formatDuration(closed - taken2));
    if (closed) parts2.push('סה"כ: ' + formatDuration(closed - opened));
    return parts2.join(' · ');
}

// Charts hidden for now — the product owner didn't
// like the average-handling-time line and wants to redesign what goes here; keeping
// the container + this hook so new charts can be dropped back in later.
function renderDashboardCharts() {
    document.getElementById('dashboardCharts').style.display = 'none';
}

// "משתמש"/"סניף" are pill buttons that open a multi-select checkbox
// popover (like the folder pickers elsewhere). Counts shown next to each option are
// scoped to whichever status-cube is currently active.
var dashUserFilterSelection = [];
var dashBranchFilterSelection = [];
var dashUrgencyFilterSelection = []; // urgency-level ("דרגה") names — same popover pattern as user/branch
var dashTaskTypeFilterSelection = []; // 'request' | 'followup' — tasks-mode filter (item 5)

function updateDashFilterButtonLabel(btnId, base, count) {
    document.getElementById(btnId).textContent = base + (count ? ' (' + count + ')' : '');
}

// While the popover is open the user may be mid-click on a checkbox — a
// background refresh (auto-refresh timer or any other reload) must never rebuild
// its contents out from under them. It picks up fresh data next time it's reopened.
function renderDashboardUserFilter() {
    var popover = document.getElementById('dashUserFilterPopover');
    if (popover.style.display !== 'none') return;
    var counts = {};
    getStatusFilteredSource().forEach(function (t) {
        var u = t.userName || t.userEmail;
        counts[u] = (counts[u] || 0) + 1;
    });
    var users = Object.keys(counts).sort();
    dashUserFilterSelection = dashUserFilterSelection.filter(function (u) { return users.indexOf(u) !== -1; });
    popover.innerHTML = users.length
        ? users.map(function (v) {
            var checked = dashUserFilterSelection.indexOf(v) !== -1 ? ' checked' : '';
            return '<label><input type="checkbox" value="' + escapeHtml(v) + '"' + checked + '>' + escapeHtml(v) + ' (' + counts[v] + ')</label>';
        }).join('')
        : '<span style="color:var(--muted);font-size:12px">אין נתונים</span>';
    updateDashFilterButtonLabel('dashUserFilterBtn', 'משתמש', dashUserFilterSelection.length);
}

function renderDashboardBranchFilter() {
    var popover = document.getElementById('dashBranchFilterPopover');
    if (popover.style.display !== 'none') return;
    var counts = {};
    getStatusFilteredSource().forEach(function (t) {
        var b = t.branch || 'ללא סניף';
        counts[b] = (counts[b] || 0) + 1;
    });
    var branches = Object.keys(counts).sort();
    dashBranchFilterSelection = dashBranchFilterSelection.filter(function (b) { return branches.indexOf(b) !== -1; });
    popover.innerHTML = branches.length
        ? branches.map(function (b) {
            var checked = dashBranchFilterSelection.indexOf(b) !== -1 ? ' checked' : '';
            return '<label><input type="checkbox" value="' + escapeHtml(b) + '"' + checked + '>' + escapeHtml(b) + ' (' + counts[b] + ')</label>';
        }).join('')
        : '<span style="color:var(--muted);font-size:12px">אין נתונים</span>';
    updateDashFilterButtonLabel('dashBranchFilterBtn', 'סניף', dashBranchFilterSelection.length);
}

// Same multi-select popover as user/branch, one entry per urgency
// ("דרגה") level actually present in the current status-scoped source, most urgent first.
function renderDashboardUrgencyFilter() {
    var popover = document.getElementById('dashUrgencyFilterPopover');
    if (popover.style.display !== 'none') return;
    var counts = {};
    getStatusFilteredSource().forEach(function (t) {
        counts[t.urgency] = (counts[t.urgency] || 0) + 1;
    });
    var urgencies = Object.keys(counts).sort(function (a, b) { return (URGENCY_SEVERITY[b] || 0) - (URGENCY_SEVERITY[a] || 0); });
    dashUrgencyFilterSelection = dashUrgencyFilterSelection.filter(function (u) { return urgencies.indexOf(u) !== -1; });
    popover.innerHTML = urgencies.length
        ? urgencies.map(function (u) {
            var checked = dashUrgencyFilterSelection.indexOf(u) !== -1 ? ' checked' : '';
            return '<label><input type="checkbox" value="' + escapeHtml(u) + '"' + checked + '>' + escapeHtml(u) + ' (' + counts[u] + ')</label>';
        }).join('')
        : '<span style="color:var(--muted);font-size:12px">אין נתונים</span>';
    updateDashFilterButtonLabel('dashUrgencyFilterBtn', 'דרגה', dashUrgencyFilterSelection.length);
}

var TASK_KIND_LABELS = { request: 'הקמת משתמש', followup: 'משימת המשך', procurement: 'רכש' };
var TASK_KIND_COLOR = { request: '#4f46e5', followup: '#0aa1a3', procurement: '#f59e0b' };

// User/branch aren't meaningful filters for the tasks tab —
// replaced with a filter by task type, counted against whichever status sub-filter
// is currently active (same "counts scoped to the active status" pattern as the
// ticket table's own user/branch popovers).
function getStatusFilteredTasksSource() {
    return getAllTasks().filter(function (task) {
        return !dashTaskStatusFilter || task.statusNorm === dashTaskStatusFilter;
    });
}

function renderDashboardTaskTypeFilter() {
    var popover = document.getElementById('dashTaskTypeFilterPopover');
    if (popover.style.display !== 'none') return;
    var counts = {};
    getStatusFilteredTasksSource().forEach(function (task) {
        counts[task.kind] = (counts[task.kind] || 0) + 1;
    });
    var kinds = Object.keys(counts);
    dashTaskTypeFilterSelection = dashTaskTypeFilterSelection.filter(function (k) { return kinds.indexOf(k) !== -1; });
    popover.innerHTML = kinds.length
        ? kinds.map(function (k) {
            var checked = dashTaskTypeFilterSelection.indexOf(k) !== -1 ? ' checked' : '';
            return '<label><input type="checkbox" value="' + escapeHtml(k) + '"' + checked + '>' + escapeHtml(TASK_KIND_LABELS[k] || k) + ' (' + counts[k] + ')</label>';
        }).join('')
        : '<span style="color:var(--muted);font-size:12px">אין נתונים</span>';
    updateDashFilterButtonLabel('dashTaskTypeFilterBtn', 'סוג משימה', dashTaskTypeFilterSelection.length);
}

// Single source of truth for what the table below shows: the status-cube source,
// then user/branch selections filter it, then the active sort button orders it.
// A "focused" ticket (set right after taking one, off a busy queue) bypasses
// all of that and shows just itself, regardless of status/filters.
function getFilteredSortedTickets() {
    if (dashFocusedTicketNumber) {
        var focused = dashTicketsByNumber[dashFocusedTicketNumber];
        return focused ? [focused] : [];
    }
    var list = getStatusFilteredSource().filter(function (t) {
        var userOk = !dashUserFilterSelection.length || dashUserFilterSelection.indexOf(t.userName || t.userEmail) !== -1;
        var branchOk = !dashBranchFilterSelection.length || dashBranchFilterSelection.indexOf(t.branch || 'ללא סניף') !== -1;
        var urgencyOk = !dashUrgencyFilterSelection.length || dashUrgencyFilterSelection.indexOf(t.urgency) !== -1;
        return userOk && branchOk && urgencyOk;
    });

    return list.slice().sort(function (a, b) {
        if (dashSortBy === 'date') return new Date(b.timestamp) - new Date(a.timestamp);
        if (dashSortBy === 'branch') return String(a.branch || '').localeCompare(String(b.branch || ''), 'he');
        var diff = (URGENCY_SEVERITY[b.urgency] || 0) - (URGENCY_SEVERITY[a.urgency] || 0);
        return diff !== 0 ? diff : new Date(a.timestamp) - new Date(b.timestamp);
    });
}

// Reuses each row's existing DOM node across refreshes (keyed by ticket number) —
// an expanded row's detail panel (description/timeline/note box) is never touched
// by this function, so auto-refresh never closes it or interrupts what you're doing
// . Only the header (status/urgency/elapsed time) is
// refreshed in place.
function renderDashboardTicketsList() {
    var container = document.getElementById('dashTicketsList');

    var tickets = getFilteredSortedTickets();
    tickets.forEach(function (t) { dashTicketsByNumber[t.ticketNumber] = t; });
    var visibleTickets = tickets.slice(0, dashDisplayLimit);
    var mergedTasks = getMergedDefaultTasks();

    if (!visibleTickets.length && !mergedTasks.length) {
        container.innerHTML = '<p style="color:var(--muted);font-size:13px">אין קריאות להצגה.</p>';
        document.getElementById('dashLoadMoreBtn').style.display = 'none';
        if (openDashboardTicketNumber) closeDashboardDetail();
        dashRowElements = {};
        return;
    }

    var visibleNumbers = {};
    var ticketNodes = visibleTickets.map(function (t) {
        visibleNumbers[t.ticketNumber] = true;
        var existing = dashRowElements[t.ticketNumber];
        if (existing) {
            updateDashboardTicketRow(existing, t);
            return existing.wrap;
        }
        var built = buildDashboardTicketRow(t);
        dashRowElements[t.ticketNumber] = built;
        return built.wrap;
    });

    Object.keys(dashRowElements).forEach(function (num) {
        if (!visibleNumbers[num]) {
            if (num === openDashboardTicketNumber) closeDashboardDetail();
            delete dashRowElements[num];
        }
    });

    container.innerHTML = '';
    ticketNodes.forEach(function (n) { container.appendChild(n); });
    mergedTasks.forEach(function (task) { container.appendChild(buildTaskCard(task)); });
    document.getElementById('dashLoadMoreBtn').style.display = tickets.length > dashDisplayLimit ? 'block' : 'none';
}

// "משימות" tab — user-creation requests + follow-up
// tasks, normalized into one shape so they share a single חדש/בטיפול/הושלם filter,
// the same user/branch popovers, and the same date sort. No status-cube/urgency
// concept applies here, so it's a separate render path from the tickets table.
function normalizeTask(kind, raw) {
    if (kind === 'request') {
        var name = [raw.firstNameHe, raw.lastNameHe].filter(Boolean).join(' ');
        var statusNorm = raw.status === 'ממתינה' ? 'חדש' : (raw.status === 'בטיפול' ? 'בטיפול' : 'הושלם');
        return {
            kind: 'request', raw: raw, id: raw.requestId,
            title: 'הקמת משתמש: ' + (name || raw.suggestedEmail),
            statusNorm: statusNorm, timestamp: raw.timestamp,
            userName: raw.requesterName, branch: branchName(raw.branchNumber),
        };
    }
    if (kind === 'procurement') {
        var reqName = [raw.firstNameHe, raw.lastNameHe].filter(Boolean).join(' ');
        return {
            kind: 'procurement', raw: raw, id: raw.id,
            title: 'רכש מחשב ' + raw.computerType + ' - ' + (reqName || raw.suggestedEmail),
            statusNorm: raw.status === 'הושלם' ? 'הושלם' : (raw.status === 'בטיפול' ? 'בטיפול' : 'חדש'),
            timestamp: raw.createdAt, userName: raw.requestNumber, branch: branchName(raw.branchNumber),
        };
    }
    return {
        kind: 'followup', raw: raw, id: raw.id,
        title: 'משימת המשך: קריאה ' + raw.ticketNumber,
        statusNorm: raw.status === 'הושלם' ? 'הושלם' : (raw.status === 'בטיפול' ? 'בטיפול' : 'חדש'),
        timestamp: raw.createdAt, userName: raw.createdByName, branch: null,
    };
}

function getAllTasks() {
    return dashAllUserRequests.map(function (r) { return normalizeTask('request', r); })
        .concat(dashFollowUps.map(function (f) { return normalizeTask('followup', f); }))
        .concat(dashProcurementTasks.map(function (p) { return normalizeTask('procurement', p); }));
}

function getFilteredTasks() {
    return getAllTasks().filter(function (task) {
        var statusOk = !dashTaskStatusFilter || task.statusNorm === dashTaskStatusFilter;
        var typeOk = !dashTaskTypeFilterSelection.length || dashTaskTypeFilterSelection.indexOf(task.kind) !== -1;
        return statusOk && typeOk;
    }).sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
}

function buildTaskCard(task) {
    var card = document.createElement('div');
    card.className = 'dash-task-card';
    card.style.borderRightWidth = '4px';
    card.style.borderRightStyle = 'solid';
    card.style.borderRightColor = TASK_KIND_COLOR[task.kind] || '#999';
    var statusClass = task.statusNorm === 'הושלם' ? 'status-closed' : (task.statusNorm === 'בטיפול' ? 'status-progress' : 'status-open');
    card.innerHTML =
        '<div class="ticket-card-header"><strong>' + escapeHtml(task.title) + '</strong>' +
        '<span class="status-badge ' + statusClass + '">' + escapeHtml(task.statusNorm) + '</span></div>' +
        '<div class="dash-task-meta">' + formatDateTime(task.timestamp) +
        (task.userName ? ' | ' + escapeHtml(task.userName) : '') + (task.branch ? ' | ' + escapeHtml(task.branch) : '') + '</div>';
    if (task.kind === 'request') {
        card.addEventListener('click', function () { openUserRequestDetail(task.raw); });
    } else if (task.kind === 'procurement' && task.statusNorm !== 'הושלם') {
        card.addEventListener('click', function () { openProcurementTaskComputerModal(task.raw); });
    }
    return card;
}

// Clicking an open "רכש" task lets IT register the computer that arrived, reusing
// the same computer-admin create modal — on save it links back to both the task and
// the originating request (see procurementTasks.linkComputer), unblocking markCompleted.
function openProcurementTaskComputerModal(procTask) {
    openComputerAdminModal(null, {
        prefillType: procTask.computerType,
        prefillBranchNumber: procTask.branchNumber,
        onSaved: async function (computerName) {
            showLoading(true);
            var linkRes = await apiPost('procurementTasks', 'linkComputer', { taskId: procTask.id, computerName: computerName });
            showLoading(false);
            if (!linkRes.ok) { alert(linkRes.error || 'שגיאה בשיוך המחשב למשימה'); return; }
            if (isHubActive()) loadHubDashboard();
        },
    });
}

// The default (unfiltered) ticket view also shows
// open/in-progress tasks mixed in, each colored by kind so they read apart from
// tickets at a glance — only when nothing narrows the view to a specific status.
function getMergedDefaultTasks() {
    if (dashFocusedTicketNumber || dashStatusFilter !== null) return [];
    return getAllTasks().filter(function (task) { return task.statusNorm !== 'הושלם'; })
        .sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
}

function renderDashboardTasksList() {
    var container = document.getElementById('dashTicketsList');
    var tasks = getFilteredTasks();
    document.getElementById('dashLoadMoreBtn').style.display = 'none';
    if (!tasks.length) {
        container.innerHTML = '<p style="color:var(--muted);font-size:13px">אין משימות בסטטוס הזה.</p>';
        return;
    }
    container.innerHTML = '';
    tasks.forEach(function (task) { container.appendChild(buildTaskCard(task)); });
}

// Header shows category | subcategory (if any) | ticket number, employee/branch
// above (employee name is a link), and date/urgency (colored by urgency)/
// elapsed-time below. The plain status tag was replaced by a real dropdown
// showing the current status, changeable to any of the three; an in-
// progress ticket with an AnyDesk ID also gets a quick-connect button,
// grouped with the dropdown so both sit on the row's left side.
var DASHBOARD_STATUS_OPTIONS = ['פתוחה', 'בטיפול', 'סגורה'];
var WHATSAPP_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="#25D366">' +
    '<path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.35 5.09L2 22l4.91-1.35C8.42 21.5 10.15 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm5.2 14.3c-.2.6-1.2 1.15-1.7 1.2-.44.05-1 .07-1.6-.1-.37-.1-.85-.28-1.46-.55-2.58-1.12-4.26-3.75-4.4-3.93-.13-.18-1.05-1.4-1.05-2.67 0-1.26.66-1.88.9-2.14.23-.25.5-.32.67-.32h.48c.15 0 .36-.03.55.42.2.48.68 1.65.74 1.77.06.13.1.28.02.45-.08.17-.13.28-.25.43-.13.15-.27.34-.38.46-.13.13-.26.27-.11.53.15.27.66 1.1 1.42 1.78.98.87 1.8 1.14 2.07 1.27.27.13.42.11.58-.07.16-.18.68-.79.86-1.06.18-.27.36-.22.6-.13.25.09 1.56.74 1.83.87.27.13.45.2.52.32.07.11.07.63-.13 1.23z"/></svg>';

function normalizePhoneForWhatsapp(phone) {
    var digits = String(phone || '').replace(/\D/g, '');
    if (digits.charAt(0) === '0') digits = '972' + digits.slice(1);
    return digits;
}

function dashboardCardInnerHtml(t) {
    var titleParts = [escapeHtml(t.category)];
    if (t.subcategory) titleParts.push(escapeHtml(t.subcategory));
    titleParts.push(escapeHtml(t.ticketNumber));

    // "פתוחה" shows a plain take-ticket button (not the dropdown) — clicking it both
    // takes the ticket AND isolates the table on just this one row, so a
    // busy queue doesn't get confusing right when you've committed to handling it.
    // The dropdown (uncolored) only appears once the ticket has an actual
    // in-progress/closed state to move between.
    var statusControlHtml = t.status === 'פתוחה'
        ? '<button type="button" class="dash-quick-tag dash-take-btn" data-take-and-focus>קח קריאה ←</button>'
        : '<select class="dash-quick-tag status-select" data-status-select>' +
            DASHBOARD_STATUS_OPTIONS.map(function (s) {
                return '<option value="' + s + '"' + (s === t.status ? ' selected' : '') + '>' + s + '</option>';
            }).join('') + '</select>';
    // AnyDesk quick-connect: shown permanently whenever there's a computer tag,
    // same as the computer tag itself — regardless of status or whether the ticket
    // is also flagged as a printer ticket. If the AnyDeskId snapshot is missing,
    // still show the tag — clicking it opens the computer's record to set one,
    // instead of just disappearing with no way to fix it.
    var liveAnyDeskId = t.computerName && dashComputersByName[t.computerName]
        ? dashComputersByName[t.computerName].anyDeskId
        : t.anyDeskId;
    var anydeskHtml = t.computerName
        ? (liveAnyDeskId
            ? '<a class="dash-anydesk-btn" href="anydesk:' + encodeURIComponent(liveAnyDeskId) + '" title="התחברות למחשב דרך AnyDesk" data-stop>🖥️</a>'
            : '<button type="button" class="dash-anydesk-btn" data-assign-anydesk title="אין AnyDesk מוגדר - לחץ להוספה" data-stop>🖥️ אין AnyDesk</button>')
        : '';
    // Printer only shows up as its own tag when the ticket actually WAS a printer
    // ticket — Tickets.Printer alone is ambiguous (a regular computer
    // ticket also records the computer's default printer there for context). Even
    // without a printer name set yet, the tag still shows so it can be assigned —
    // same "always there, click to fix" behavior as the computer tag below.
    var computerTagHtml = t.computerName
        ? '<button type="button" class="dash-quick-tag" data-open-computer title="פרטי המחשב">💻 ' + escapeHtml(t.computerName) + '</button>'
        : '';
    var printerTagHtml = t.isPrinterTicket
        ? (t.printer
            ? '<button type="button" class="dash-quick-tag" data-open-printer title="פרטי המדפסת">🖨️ ' + escapeHtml(t.printer) + '</button>'
            : '<button type="button" class="dash-quick-tag" data-assign-printer title="לא נבחרה מדפסת - לחץ לעריכה">🖨️ לא נבחרה מדפסת</button>')
        : '';

    var rgb = hexToRgb(URGENCY_COLOR[t.urgency] || '#cccccc');
    var urgencyBg = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.2)';

    var phoneHtml = t.phone
        ? ' | <a href="tel:' + escapeHtml(t.phone) + '" class="dash-link-field" data-stop>' + escapeHtml(t.phone) + '</a>' +
          ' | <a href="https://wa.me/' + normalizePhoneForWhatsapp(t.phone) + '" target="_blank" rel="noopener" class="dash-whatsapp-link" data-stop title="הודעת וואטסאפ">' + WHATSAPP_ICON_SVG + '</a>'
        : '';

    // "Handled by" tag: nothing on a fresh open ticket, "מטפל/ת" while in
    // progress, "טופל ע"י" once closed — reopening a ticket clears the assignment
    // server-side (and via the optimistic patch), so this naturally disappears again.
    var assignedTagHtml = '';
    if (t.status === 'בטיפול' && t.assignedToName) assignedTagHtml = '<div class="dash-assigned-tag">מטפל/ת: ' + escapeHtml(t.assignedToName) + '</div>';
    else if (t.status === 'סגורה' && t.assignedToName) assignedTagHtml = '<div class="dash-assigned-tag">טופל ע"י ' + escapeHtml(t.assignedToName) + '</div>';

    return '<div class="dash-ticket-meta-top"><span class="dash-link-field" data-open-user>' + escapeHtml(t.userName || t.userEmail) + '</span>' +
        (t.branch ? ' | ' + escapeHtml(t.branch) : '') + phoneHtml + '</div>' +
        '<div class="ticket-card-header"><strong class="dash-title-link" data-edit-fields title="לחץ לתיקון פרטי הקריאה">' + titleParts.join(' | ') + '</strong>' +
        '<span class="dash-header-right-group">' + computerTagHtml + printerTagHtml + anydeskHtml + statusControlHtml + '</span></div>' +
        '<div class="ticket-meta">' + formatDateTime(t.timestamp) + ' | <span class="dash-urgency-chip" style="background:' + urgencyBg + '">' + escapeHtml(t.urgency) + '</span></div>' +
        '<div class="dash-elapsed-row">' + escapeHtml(dashboardElapsedHtml(t)) + '</div>' +
        assignedTagHtml;
}

function applyDashboardCardStyle(card, t) {
    card.style.borderRightWidth = '';
    card.style.borderRightStyle = '';
    card.style.borderRightColor = '';
    card.classList.remove('urgency-blink');
    var color = URGENCY_COLOR[t.urgency];
    if (t.status !== 'סגורה' && color) applyOpenRowBlink(card, color);
}

function wireDashboardCardActions(card, t) {
    var select = card.querySelector('[data-status-select]');
    if (select) {
        select.addEventListener('click', function (e) { e.stopPropagation(); });
        select.addEventListener('change', function () {
            dashboardChangeStatus(dashTicketsByNumber[t.ticketNumber] || t, select.value);
        });
    }
    var takeBtn = card.querySelector('[data-take-and-focus]');
    if (takeBtn) {
        takeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            dashboardTakeAndFocus(dashTicketsByNumber[t.ticketNumber] || t);
        });
    }
    var editFieldsLink = card.querySelector('[data-edit-fields]');
    if (editFieldsLink) {
        editFieldsLink.addEventListener('click', function (e) {
            e.stopPropagation();
            openTicketEditFieldsModal(dashTicketsByNumber[t.ticketNumber] || t);
        });
    }
    card.querySelectorAll('[data-stop]').forEach(function (el) {
        el.addEventListener('click', function (e) { e.stopPropagation(); });
    });
    var userLink = card.querySelector('[data-open-user]');
    if (userLink) {
        userLink.addEventListener('click', function (e) {
            e.stopPropagation();
            openTicketUserDetail((dashTicketsByNumber[t.ticketNumber] || t).userEmail);
        });
    }
    var computerTag = card.querySelector('[data-open-computer]');
    if (computerTag) {
        computerTag.addEventListener('click', function (e) {
            e.stopPropagation();
            openTicketComputerDetail((dashTicketsByNumber[t.ticketNumber] || t).computerName);
        });
    }
    var printerTag = card.querySelector('[data-open-printer]');
    if (printerTag) {
        printerTag.addEventListener('click', function (e) {
            e.stopPropagation();
            openTicketPrinterDetail((dashTicketsByNumber[t.ticketNumber] || t).printer);
        });
    }
    // No printer/AnyDesk assigned yet — jump straight to the ticket's own field-edit
    // modal / the computer's record, since there's nothing to look up yet.
    var assignPrinterTag = card.querySelector('[data-assign-printer]');
    if (assignPrinterTag) {
        assignPrinterTag.addEventListener('click', function (e) {
            e.stopPropagation();
            openTicketEditFieldsModal(dashTicketsByNumber[t.ticketNumber] || t);
        });
    }
    var assignAnydeskTag = card.querySelector('[data-assign-anydesk]');
    if (assignAnydeskTag) {
        assignAnydeskTag.addEventListener('click', function (e) {
            e.stopPropagation();
            openTicketComputerDetail((dashTicketsByNumber[t.ticketNumber] || t).computerName);
        });
    }
}

// Refreshes an already-built row's header in place — never touches `.detail`, so an
// open row's expanded content survives every dashboard refresh untouched.
function updateDashboardTicketRow(row, t) {
    row.card.innerHTML = dashboardCardInnerHtml(t);
    applyDashboardCardStyle(row.card, t);
    wireDashboardCardActions(row.card, t);
}

function buildDashboardTicketRow(t) {
    var wrap = document.createElement('div');
    var card = document.createElement('div');
    card.className = 'ticket-card dash-ticket-card';
    card.innerHTML = dashboardCardInnerHtml(t);
    applyDashboardCardStyle(card, t);

    var detail = document.createElement('div');
    detail.className = 'dash-ticket-detail';
    detail.style.display = 'none';
    detail.addEventListener('click', function (e) { e.stopPropagation(); });

    card.addEventListener('click', function () {
        toggleDashboardTicketDetail(dashTicketsByNumber[t.ticketNumber] || t, card, detail);
    });

    wrap.appendChild(card);
    wrap.appendChild(detail);
    var row = { wrap: wrap, card: card, detail: detail };
    wireDashboardCardActions(card, t);
    return row;
}

// Clicking a ticket expands its description + a timeline history + an add-note row
// right inside its own row — no more popup modal. Only one row
// is ever open at a time — opening a new one always properly closes the previous
// one first (this used to be the root cause of a bug where a stray, never-closed
// detail panel from a PREVIOUS row still held a live event listener, so one click
// could fire actions against two different tickets at once).
function toggleDashboardTicketDetail(t, cardEl, detailEl) {
    if (openDashboardTicketNumber === t.ticketNumber) { closeDashboardDetail(); return; }
    if (openDashboardRow) closeDashboardDetail();
    openDashboardTicketNumber = t.ticketNumber;
    openDashboardRow = { cardEl: cardEl, detailEl: detailEl };
    loadDashboardTicketDetail(t, cardEl, detailEl);
}

function closeDashboardDetail() {
    if (openDashboardRow) {
        openDashboardRow.detailEl.style.display = 'none';
        openDashboardRow.detailEl.innerHTML = '';
        openDashboardRow.cardEl.classList.remove('expanded');
    }
    openDashboardTicketNumber = null;
    openDashboardRow = null;
}

export function refreshOpenDashboardDetail() {
    if (!openDashboardTicketNumber || !openDashboardRow) return;
    var latest = dashTicketsByNumber[openDashboardTicketNumber];
    if (latest) loadDashboardTicketDetail(latest, openDashboardRow.cardEl, openDashboardRow.detailEl);
}

// A status change used to trigger a full loadHubDashboard() — four
// sequential network round-trips plus a full list rebuild, which felt like the
// whole dashboard reloading. Since dashTicketsByNumber/dashboardOpenTickets hold the
// very same object references (renderDashboardTicketsList populates the map by
// reference, never by copy), patching the ticket in place is enough to update
// everything derived from it — no server round-trip beyond the one action itself.
export function patchDashboardTicket(ticketNumber, patch) {
    var t = dashTicketsByNumber[ticketNumber];
    if (!t) return;
    Object.assign(t, patch);
    renderDashboardCounts(document.getElementById('dashClosedCount').textContent);
    renderDashboardCharts();
    var row = dashRowElements[ticketNumber];
    if (!row) return;
    var stillVisible = getFilteredSortedTickets().indexOf(t) !== -1;
    if (stillVisible) updateDashboardTicketRow(row, t);
    else renderDashboardTicketsList();
}

// Aggregates the server computes (closed count, follow-up count) that a client-side
// patch can't derive — refreshed quietly in the background, without touching the
// ticket list/rows or any open popover.
async function refreshDashboardAggregatesOnly() {
    var countRes = await apiGet('tickets', 'closedCount', {});
    if (countRes.ok) document.getElementById('dashClosedCount').textContent = countRes.data.count;
    var followUpRes = await apiGet('tickets', 'followUpCount', {});
    if (followUpRes.ok) document.getElementById('dashFollowupsCount').textContent = followUpRes.data.count;
}

async function loadDashboardTicketDetail(t, cardEl, detailEl) {
    cardEl.classList.add('expanded');
    detailEl.style.display = 'block';
    detailEl.innerHTML = '<p style="color:var(--muted);font-size:13px">טוען...</p>';
    var res = await apiGet('tickets', 'get', { ticketNumber: t.ticketNumber });
    if (!res.ok) {
        detailEl.innerHTML = '<p style="color:var(--danger);font-size:13px">' + escapeHtml(res.error || 'שגיאה בטעינה') + '</p>';
        return;
    }
    renderDashboardTicketDetail(detailEl, res.data.ticket, res.data.log);
}

// Extra ticket fields (computer/phone/printer) shown above the description;
// the computer name is a link that opens the Computers admin modal.
function renderDashboardTicketDetail(el, t, log) {
    var isIT = Portal.isITAdmin();

    el.innerHTML =
        '<div class="dash-section-divider">תיאור הקריאה</div>' +
        '<div style="font-size:14px;white-space:pre-wrap;margin-bottom:10px">' + escapeHtml(t.description) + '</div>' +
        '<div class="dash-section-divider">היסטוריית הקריאה</div>' +
        '<div class="dash-timeline">' +
        (log.length ? log.map(function (entry) { return renderTimelineEntry(entry, t); }).join('') : '<span style="color:var(--muted);font-size:12px">אין רשומות</span>') +
        '</div>' +
        (isIT ? '<div class="field" style="margin:10px 0 0"><div style="display:flex;gap:8px">' +
            '<input data-dd-note-input type="text" style="flex:1" placeholder="הוסף הערה (Enter לשליחה)">' +
            '<button type="button" class="secondary-button" data-dd-add-note>הוסף</button></div></div>' : '');

    var noteInput = el.querySelector('[data-dd-note-input]');
    var addNoteBtn = el.querySelector('[data-dd-add-note]');
    function submitNote() {
        var note = noteInput.value.trim();
        if (note) dashboardAddNote(t, note);
    }
    if (addNoteBtn) addNoteBtn.addEventListener('click', submitNote);
    if (noteInput) {
        noteInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); submitNote(); }
        });
    }

    // Editable notes: clicking the dot of a note YOU authored lets you edit
    // it inline. System entries (status changes, assignment, "created") never get a
    // clickable dot — describeLogEntry/renderTimelineEntry only mark real 'note' rows.
    el.querySelectorAll('.dash-timeline-item[data-log-id]').forEach(function (item) {
        var dot = item.querySelector('.dash-timeline-dot');
        if (dot) dot.addEventListener('click', function () { openInlineNoteEdit(item, t); });
    });
}

function openInlineNoteEdit(item, t) {
    var textEl = item.querySelector('[data-log-text]');
    var logId = item.getAttribute('data-log-id');
    var currentText = textEl.textContent;
    item.innerHTML = '<div class="dash-note-edit-row">' +
        '<input type="text" value="' + escapeHtml(currentText) + '">' +
        '<button type="button" class="icon-button" data-save title="שמור">✔️</button>' +
        '<button type="button" class="icon-button" data-cancel title="ביטול">✖️</button></div>';
    var input = item.querySelector('input');
    input.focus();
    function cancel() { refreshOpenDashboardDetail(); }
    function save() {
        var newText = input.value.trim();
        if (newText) dashboardUpdateNote(logId, newText);
    }
    item.querySelector('[data-save]').addEventListener('click', save);
    item.querySelector('[data-cancel]').addEventListener('click', cancel);
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') cancel();
    });
}

async function dashboardUpdateNote(logId, message) {
    showLoading(true);
    var res = await apiPost('tickets', 'updateNote', { logId: logId, message: message });
    showLoading(false);
    if (res.ok) refreshOpenDashboardDetail(); else alert(res.error || 'שגיאה');
}

async function dashboardTakeTicket(t) {
    showLoading(true);
    var res = await apiPost('tickets', 'take', { ticketNumber: t.ticketNumber });
    showLoading(false);
    if (!res.ok) { alert(res.error || 'שגיאה'); return; }
    var user = Portal.getUser();
    patchDashboardTicket(t.ticketNumber, {
        status: 'בטיפול',
        assignedToEmail: user.email,
        assignedToName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
        takenAt: new Date().toISOString(),
    });
    refreshOpenDashboardDetail();
}

var closingTicket = null;
var ticketCloseTracker = makeDirtyTracker(document.getElementById('ticketCloseModalBackdrop'));

// Replaces the plain prompt() with a real closing form: resolution summary
// (shown to the requester), internal-only documentation, a "flag for later" toggle,
// and an optional follow-up task.
function dashboardCloseTicket(t) {
    closingTicket = t;
    var openedText = 'נפתחה: ' + formatDateTime(t.timestamp);
    var takenText = t.takenAt ? ' | התחילה: ' + formatDateTime(t.takenAt) : '';
    document.getElementById('ticketCloseTimingInfo').textContent = openedText + takenText;
    document.getElementById('tcmResolution').value = '';
    document.getElementById('tcmInternalNote').value = '';
    document.getElementById('tcmFlagged').checked = false;
    document.getElementById('tcmFollowUp').value = '';
    document.getElementById('ticketCloseModalError').style.display = 'none';
    document.getElementById('ticketCloseModalBackdrop').classList.add('visible');
    ticketCloseTracker.reset();
}
function closeTicketCloseModal() { document.getElementById('ticketCloseModalBackdrop').classList.remove('visible'); }

document.getElementById('ticketCloseCancelBtn').addEventListener('click', function () {
    if (!ticketCloseTracker.confirmDiscard()) return;
    closeTicketCloseModal();
    // The header <select> already flipped to "סגורה" visually when the user picked
    // it — revert that back since nothing was actually saved.
    var row = dashRowElements[closingTicket.ticketNumber];
    var latest = dashTicketsByNumber[closingTicket.ticketNumber];
    if (row && latest) updateDashboardTicketRow(row, latest);
});
document.getElementById('ticketCloseSaveBtn').addEventListener('click', async function () {
    var errEl = document.getElementById('ticketCloseModalError');
    var resolution = document.getElementById('tcmResolution').value.trim();
    if (!resolution) { errEl.textContent = 'יש למלא תיאור פתרון'; errEl.style.display = 'block'; return; }
    var payload = {
        ticketNumber: closingTicket.ticketNumber,
        resolutionDescription: resolution,
        internalNote: document.getElementById('tcmInternalNote').value.trim(),
        flagged: document.getElementById('tcmFlagged').checked,
        followUpDescription: document.getElementById('tcmFollowUp').value.trim(),
    };
    showLoading(true);
    var res = await apiPost('tickets', 'closeWithDetails', payload);
    showLoading(false);
    if (!res.ok) { errEl.textContent = res.error || 'שגיאה'; errEl.style.display = 'block'; return; }
    ticketCloseTracker.reset();
    closeTicketCloseModal();
    patchDashboardTicket(closingTicket.ticketNumber, {
        status: 'סגורה', flagged: payload.flagged, closedAt: new Date().toISOString(),
    });
    refreshDashboardAggregatesOnly();
    refreshOpenDashboardDetail();
});

async function dashboardAddNote(t, note) {
    showLoading(true);
    var res = await apiPost('tickets', 'updateStatus', { ticketNumber: t.ticketNumber, status: t.status, message: note });
    showLoading(false);
    if (res.ok) refreshOpenDashboardDetail(); else alert(res.error || 'שגיאה');
}

// The header status <select> drives all three transitions: פתוחה→בטיפול
// reuses the real "take" flow (assigns the ticket + sets TakenAt), →סגורה reuses the
// close flow (optional note, ClosedAt), any other change is a plain status update.
async function dashboardChangeStatus(t, newStatus) {
    if (newStatus === t.status) return;
    if (t.status === 'פתוחה' && newStatus === 'בטיפול') { await dashboardTakeTicket(t); return; }
    if (newStatus === 'סגורה') { dashboardCloseTicket(t); return; }
    showLoading(true);
    var res = await apiPost('tickets', 'updateStatus', { ticketNumber: t.ticketNumber, status: newStatus });
    showLoading(false);
    if (!res.ok) { alert(res.error || 'שגיאה'); return; }
    var patch = { status: newStatus };
    // Reopening (→ פתוחה) clears the assignment server-side — mirror it locally too.
    if (newStatus === 'פתוחה') { patch.assignedToEmail = null; patch.assignedToName = null; patch.takenAt = null; }
    patchDashboardTicket(t.ticketNumber, patch);
    refreshOpenDashboardDetail();
}

// Read-only quick-view first — an "ערוך" button drops into the same
// edit modal IT already knows from the Users/Computers/Printers admin screens.
function openQuickView(title, fieldsHtml, onEdit) {
    document.getElementById('quickViewTitle').textContent = title;
    document.getElementById('quickViewBody').innerHTML = fieldsHtml;
    document.getElementById('quickViewModalBackdrop').classList.add('visible');
    document.getElementById('quickViewEditBtn').onclick = function () {
        closeQuickView();
        onEdit();
    };
}
function closeQuickView() { document.getElementById('quickViewModalBackdrop').classList.remove('visible'); }
document.getElementById('quickViewCloseBtn').addEventListener('click', closeQuickView);

function quickViewFieldsHtml(rows) {
    return '<div style="display:flex;flex-direction:column;gap:7px;font-size:13px">' +
        rows.map(function (r) { return '<div><strong>' + escapeHtml(r[0]) + ':</strong> ' + escapeHtml(r[1] || '-') + '</div>'; }).join('') +
        '</div>';
}

async function openTicketUserDetail(email) {
    showLoading(true);
    var usersRes = await apiGet('users', 'list', {});
    var compRes = await apiGet('computers', 'list', {});
    showLoading(false);
    if (compRes.ok) setComputersCache(compRes.data);
    var user = usersRes.ok ? usersRes.data.filter(function (u) { return String(u.email).toLowerCase() === String(email).toLowerCase(); })[0] : null;
    if (!user) { alert('המשתמש לא נמצא'); return; }
    await ensureBranchesLoaded();
    var fieldsHtml = quickViewFieldsHtml([
        ['שם', [user.firstName, user.lastName].filter(Boolean).join(' ')],
        ['מייל', user.email],
        ['טלפון', user.phone],
        ['סניף', branchName(user.branchNumber)],
        ['תפקיד', user.role],
    ]);
    openQuickView('פרטי עובד', fieldsHtml, function () { openUserAdminModal(user); });
}

async function openTicketComputerDetail(computerName) {
    showLoading(true);
    var res = await apiGet('computers', 'list', {});
    showLoading(false);
    var comp = res.ok ? res.data.filter(function (c) { return c.computerName === computerName; })[0] : null;
    if (!comp) { alert('המחשב לא נמצא'); return; }
    await ensureBranchesLoaded();
    var fieldsHtml = quickViewFieldsHtml([
        ['שם מחשב', comp.computerName],
        ['סוג', comp.type],
        ['זיכרון', comp.ram],
        ['מדפסת ברירת מחדל', comp.defaultPrinterName],
        ['סניף', branchName(comp.branchNumber)],
        ['הערות', comp.notes],
    ]);
    openQuickView('פרטי מחשב', fieldsHtml, function () { openComputerAdminModal(comp); });
}

async function openTicketPrinterDetail(printerName) {
    await ensurePrintersLoaded();
    var p = (printersCache || []).filter(function (x) { return x.printerName === printerName; })[0];
    if (!p) { alert('המדפסת לא נמצאה'); return; }
    await ensureBranchesLoaded();
    var fieldsHtml = quickViewFieldsHtml([
        ['שם מדפסת', p.printerName],
        ['IP', p.ip],
        ['סניף', branchName(p.branchNumber)],
        ['הערות', p.notes],
    ]);
    openQuickView('פרטי מדפסת', fieldsHtml, function () { openPrinterAdminModal(p); });
}

var DASH_FILTER_POPOVER_IDS = ['dashUserFilterPopover', 'dashBranchFilterPopover', 'dashUrgencyFilterPopover', 'dashTaskTypeFilterPopover'];

function toggleFilterPopover(popoverId) {
    var pop = document.getElementById(popoverId);
    var wasOpen = pop.style.display !== 'none';
    DASH_FILTER_POPOVER_IDS.forEach(function (id) { document.getElementById(id).style.display = 'none'; });
    pop.style.display = wasOpen ? 'none' : 'block';
}
document.getElementById('dashUserFilterBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    toggleFilterPopover('dashUserFilterPopover');
});
document.getElementById('dashBranchFilterBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    toggleFilterPopover('dashBranchFilterPopover');
});
document.getElementById('dashUrgencyFilterBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    toggleFilterPopover('dashUrgencyFilterPopover');
});
document.addEventListener('click', function () {
    DASH_FILTER_POPOVER_IDS.forEach(function (id) { document.getElementById(id).style.display = 'none'; });
});
document.getElementById('dashUserFilterPopover').addEventListener('click', function (e) { e.stopPropagation(); });
document.getElementById('dashBranchFilterPopover').addEventListener('click', function (e) { e.stopPropagation(); });
document.getElementById('dashUrgencyFilterPopover').addEventListener('click', function (e) { e.stopPropagation(); });

document.getElementById('dashUserFilterPopover').addEventListener('change', function (e) {
    if (e.target.type !== 'checkbox') return;
    var v = e.target.value;
    dashUserFilterSelection = e.target.checked
        ? dashUserFilterSelection.concat([v])
        : dashUserFilterSelection.filter(function (x) { return x !== v; });
    updateDashFilterButtonLabel('dashUserFilterBtn', 'משתמש', dashUserFilterSelection.length);
    dashDisplayLimit = 30;
    renderDashboardCharts();
    renderDashboardCurrentList();
});
document.getElementById('dashBranchFilterPopover').addEventListener('change', function (e) {
    if (e.target.type !== 'checkbox') return;
    var v = e.target.value;
    dashBranchFilterSelection = e.target.checked
        ? dashBranchFilterSelection.concat([v])
        : dashBranchFilterSelection.filter(function (x) { return x !== v; });
    updateDashFilterButtonLabel('dashBranchFilterBtn', 'סניף', dashBranchFilterSelection.length);
    dashDisplayLimit = 30;
    renderDashboardCharts();
    renderDashboardCurrentList();
});
document.getElementById('dashUrgencyFilterPopover').addEventListener('change', function (e) {
    if (e.target.type !== 'checkbox') return;
    var v = e.target.value;
    dashUrgencyFilterSelection = e.target.checked
        ? dashUrgencyFilterSelection.concat([v])
        : dashUrgencyFilterSelection.filter(function (x) { return x !== v; });
    updateDashFilterButtonLabel('dashUrgencyFilterBtn', 'דרגה', dashUrgencyFilterSelection.length);
    dashDisplayLimit = 30;
    renderDashboardCharts();
    renderDashboardCurrentList();
});

// Clicking a stat cube filters the table by that status (click again to clear back
// to the default open+in-progress view) — replaces the old separate "closed
// tickets"/"all tickets" buttons. Switching it also
// recomputes the popover counts and charts.
function renderDashboardCurrentList() {
    if (dashViewMode === 'tasks') renderDashboardTasksList(); else renderDashboardTicketsList();
}

function updateDashCubeActiveClasses() {
    document.getElementById('dashCubeOpen').classList.toggle('dc-active', dashViewMode === 'tickets' && dashStatusFilter === 'פתוחה');
    document.getElementById('dashCubeProgress').classList.toggle('dc-active', dashViewMode === 'tickets' && dashStatusFilter === 'בטיפול');
    document.getElementById('dashCubeClosed').classList.toggle('dc-active', dashViewMode === 'tickets' && dashStatusFilter === 'סגורה');
    document.getElementById('dashCubeTasks').classList.toggle('dc-active', dashViewMode === 'tasks');
}

// Toolbar layout swaps by mode: tickets mode shows the משתמש/סניף
// filters + urgency/date/branch sort tags; tasks mode replaces them with a single
// "סוג משימה" filter + the חדש/בטיפול/הושלם status filter, in the very same slots.
function setDashToolbarMode(mode) {
    var tasksMode = mode === 'tasks';
    document.getElementById('dashUserFilterWrap').style.display = tasksMode ? 'none' : '';
    document.getElementById('dashBranchFilterWrap').style.display = tasksMode ? 'none' : '';
    document.getElementById('dashUrgencyFilterWrap').style.display = tasksMode ? 'none' : '';
    document.getElementById('dashTaskTypeFilterWrap').style.display = tasksMode ? '' : 'none';
    document.getElementById('dashSortGroup').style.display = tasksMode ? 'none' : 'flex';
    document.getElementById('dashTaskStatusRow').style.display = tasksMode ? 'flex' : 'none';
}

function setDashStatusFilter(status) {
    dashViewMode = 'tickets';
    dashFocusedTicketNumber = null;
    renderDashFocusTag();
    setDashToolbarMode('tickets');
    dashStatusFilter = (dashStatusFilter === status) ? null : status;
    dashDisplayLimit = 30;
    updateDashCubeActiveClasses();
    renderDashboardUserFilter();
    renderDashboardBranchFilter();
    renderDashboardUrgencyFilter();
    renderDashboardCharts();
    renderDashboardTicketsList();
}

document.getElementById('dashCubeOpen').addEventListener('click', function () { setDashStatusFilter('פתוחה'); });
document.getElementById('dashCubeProgress').addEventListener('click', function () { setDashStatusFilter('בטיפול'); });
document.getElementById('dashCubeClosed').addEventListener('click', async function () {
    if (dashStatusFilter !== 'סגורה' && dashboardClosedTickets === null) {
        showLoading(true);
        var res = await apiGet('tickets', 'listClosed', {});
        showLoading(false);
        dashboardClosedTickets = res.ok ? res.data : [];
    }
    setDashStatusFilter('סגורה');
});

// "משימות" is a MODE, not a status filter — clicking it again returns to
// the normal tickets view (mirrors how the other three cubes toggle off). Default
// status sub-filter is "show all" — no button starts active.
document.getElementById('dashCubeTasks').addEventListener('click', async function () {
    if (dashViewMode === 'tasks') { setDashStatusFilter(null); return; }
    dashViewMode = 'tasks';
    dashFocusedTicketNumber = null;
    renderDashFocusTag();
    dashDisplayLimit = 30;
    if (!dashFollowUpsLoaded) {
        showLoading(true);
        var res = await apiGet('tickets', 'listFollowUps', {});
        dashFollowUps = res.ok ? res.data : [];
        dashFollowUpsLoaded = true;
        showLoading(false);
    }
    updateDashCubeActiveClasses();
    setDashToolbarMode('tasks');
    renderDashboardCharts();
    renderDashboardTaskTypeFilter();
    renderDashboardTasksList();
});

function setDashTaskStatusFilter(status) {
    dashTaskStatusFilter = (dashTaskStatusFilter === status) ? null : status;
    ['dashTaskStatusNew', 'dashTaskStatusProgress', 'dashTaskStatusDone'].forEach(function (id) {
        var btn = document.getElementById(id);
        btn.classList.toggle('active', btn.getAttribute('data-task-status') === dashTaskStatusFilter);
    });
    renderDashboardTaskTypeFilter();
    renderDashboardTasksList();
}
document.getElementById('dashTaskStatusNew').addEventListener('click', function () { setDashTaskStatusFilter('חדש'); });
document.getElementById('dashTaskStatusProgress').addEventListener('click', function () { setDashTaskStatusFilter('בטיפול'); });
document.getElementById('dashTaskStatusDone').addEventListener('click', function () { setDashTaskStatusFilter('הושלם'); });

document.getElementById('dashTaskTypeFilterBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    toggleFilterPopover('dashTaskTypeFilterPopover');
});
document.getElementById('dashTaskTypeFilterPopover').addEventListener('click', function (e) { e.stopPropagation(); });
document.getElementById('dashTaskTypeFilterPopover').addEventListener('change', function (e) {
    if (e.target.type !== 'checkbox') return;
    var v = e.target.value;
    dashTaskTypeFilterSelection = e.target.checked
        ? dashTaskTypeFilterSelection.concat([v])
        : dashTaskTypeFilterSelection.filter(function (x) { return x !== v; });
    updateDashFilterButtonLabel('dashTaskTypeFilterBtn', 'סוג משימה', dashTaskTypeFilterSelection.length);
    renderDashboardTasksList();
});

function setDashSortBy(sortBy) {
    dashSortBy = sortBy;
    dashDisplayLimit = 30;
    ['dashSortUrgency', 'dashSortDate', 'dashSortBranch'].forEach(function (id) {
        var btn = document.getElementById(id);
        btn.classList.toggle('active', btn.getAttribute('data-sort') === sortBy);
    });
    if (dashViewMode === 'tickets') renderDashboardTicketsList();
}
document.getElementById('dashSortUrgency').addEventListener('click', function () { setDashSortBy('urgency'); });
document.getElementById('dashSortDate').addEventListener('click', function () { setDashSortBy('date'); });
document.getElementById('dashSortBranch').addEventListener('click', function () { setDashSortBy('branch'); });

document.getElementById('dashLoadMoreBtn').addEventListener('click', function () {
    dashDisplayLimit += 30;
    renderDashboardTicketsList();
});

// The tag that appears under the cubes once you're focused on a single
// ticket, with an X to drop back to the normal filtered view.
function renderDashFocusTag() {
    var container = document.getElementById('dashFocusTagContainer');
    if (!dashFocusedTicketNumber) { container.style.display = 'none'; container.innerHTML = ''; return; }
    container.style.display = 'block';
    container.innerHTML = '<span class="dash-focus-tag">קריאה: ' + escapeHtml(dashFocusedTicketNumber) +
        '<button type="button" data-clear-focus title="חזרה לרשימה המלאה">✖</button></span>';
    container.querySelector('[data-clear-focus]').addEventListener('click', function () {
        dashFocusedTicketNumber = null;
        renderDashFocusTag();
        renderDashboardTicketsList();
    });
}

async function dashboardTakeAndFocus(t) {
    await dashboardTakeTicket(t);
    dashFocusedTicketNumber = t.ticketNumber;
    renderDashFocusTag();
    renderDashboardTicketsList();
}

export function stopDashboardAutoRefresh() {
    if (dashboardRefreshTimer) { clearInterval(dashboardRefreshTimer); dashboardRefreshTimer = null; }
}

export function startDashboardAutoRefresh() {
    stopDashboardAutoRefresh();
    dashboardRefreshTimer = setInterval(function () {
        if (isHubActive() && Portal.isITAdmin()) loadHubDashboard();
        else stopDashboardAutoRefresh();
    }, 25000);
}
