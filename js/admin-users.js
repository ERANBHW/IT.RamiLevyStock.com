import { openComputerAdminModal } from './admin-computers.js';
import { Portal, apiGet, apiPost } from './api-client.js';
import { ORDER_NEW_COMPUTER_VALUE, branchName, collapseFolderPicker, copyToClipboard, ensureBranchesLoaded, ensureSharedFoldersLoaded, escapeHtml, getSelectedFolderIds, getToggleValue, initFolderCollapse, initToggleGroup, loadComputersByBranch, makeDirtyTracker, maskPhoneInput, populateBranchComputerSelect, populateBranchSelect, refreshFolderCollapseSummary, renderFolderCheckboxes, restrictToEnglishLetters, restrictToHebrewLetters, setToggleValue, showLoading } from './common-ui.js';

// ── ADMIN: USERS ──────────────────────────────────────────
var editingUserEmail = null;
export var computersCache = [];
var usersCache = [];

export async function loadUsersAdminPage() {
    showLoading(true);
    await ensureBranchesLoaded();
    var usersRes = await apiGet('users', 'list', {});
    var compRes = await apiGet('computers', 'list', {});
    showLoading(false);
    computersCache = compRes.ok ? compRes.data : [];
    usersCache = usersRes.ok ? usersRes.data : [];
    renderUsersTable(usersCache);
}

function computerAssignedTo(email) {
    return computersCache.find(function (c) { return String(c.assignedUserEmail).toLowerCase() === String(email).toLowerCase(); });
}

// Clicking a sortable column header sorts a-to-z (Hebrew collation),
// toggling direction on repeated clicks of the same column — shared helper for both the
// users table and the computers table.
export function makeSortableTable(theadSelector, sortState, valueFns, onSort) {
    document.querySelectorAll(theadSelector + ' th.sortable').forEach(function (th) {
        th.addEventListener('click', function () {
            var key = th.getAttribute('data-sort');
            if (sortState.key === key) sortState.dir *= -1; else { sortState.key = key; sortState.dir = 1; }
            onSort();
        });
    });
}

export function applySortState(list, sortState, valueFns) {
    if (!sortState.key || !valueFns[sortState.key]) return list;
    var getValue = valueFns[sortState.key];
    return list.slice().sort(function (a, b) {
        return String(getValue(a)).localeCompare(String(getValue(b)), 'he') * sortState.dir;
    });
}

export function renderSortArrows(theadSelector, sortState) {
    document.querySelectorAll(theadSelector + ' th.sortable').forEach(function (th) {
        var existing = th.querySelector('.sort-arrow');
        if (existing) existing.remove();
        if (th.getAttribute('data-sort') === sortState.key) {
            var arrow = document.createElement('span');
            arrow.className = 'sort-arrow';
            arrow.textContent = sortState.dir === 1 ? '▲' : '▼';
            th.appendChild(arrow);
        }
    });
}

var usersSortState = { key: null, dir: 1 };

var usersSortValueFns = {
    email: function (u) { return u.email || ''; },
    name: function (u) { return [u.firstName, u.lastName].filter(Boolean).join(' '); },
    branch: function (u) { return branchName(u.branchNumber); },
    role: function (u) { return u.role || ''; },
    computer: function (u) { var c = computerAssignedTo(u.email); return c ? c.computerName : ''; },
};

makeSortableTable('#usersTable thead', usersSortState, usersSortValueFns, function () {
    renderUsersTable(usersCache);
});

function renderUsersTable(users) {
    renderSortArrows('#usersTable thead', usersSortState);
    var body = document.getElementById('usersTableBody');
    body.innerHTML = '';
    applySortState(users, usersSortState, usersSortValueFns).forEach(function (u) {
        var tr = document.createElement('tr');
        var badges = '';
        if (u.isSuperAdmin) badges += '<span class="role-badge">מנהל-על</span>';
        if (u.isITAdmin) badges += '<span class="role-badge">IT</span>';
        if (u.isProceduresAdmin) badges += '<span class="role-badge">נהלים</span>';
        var comp = computerAssignedTo(u.email);
        // Only a SuperAdmin may touch other admins — matches server-side enforcement.
        var targetIsAdmin = u.isSuperAdmin || u.isITAdmin || u.isProceduresAdmin;
        var canManage = Portal.isSuperAdmin() || !targetIsAdmin;

        tr.innerHTML =
            '<td dir="ltr">' + escapeHtml(u.email) + '</td>' +
            '<td>' + escapeHtml([u.firstName, u.lastName].filter(Boolean).join(' ')) + '</td>' +
            '<td>' + escapeHtml(branchName(u.branchNumber)) + '</td>' +
            '<td>' + escapeHtml(u.role) + '</td>' +
            '<td>' + (badges || '-') + '</td>' +
            '<td>' + escapeHtml(comp ? comp.computerName : '-') + '</td>';

        // No per-row icons — the whole row opens the
        // edit wizard (which itself gates admin-on-admin edits server-side); rows for
        // an admin the current user isn't allowed to manage stay read-only (no click).
        if (canManage) {
            tr.classList.add('admin-row-clickable');
            tr.addEventListener('click', function () { openUserAdminModal(u); });
        }
        body.appendChild(tr);
    });
}

// Branch-scoped, with an "order new" sentinel — same picker used by the user-request
// form and its review wizard.
async function populateUaComputerSelect(branchNumber, selectedName) {
    var list = await loadComputersByBranch(branchNumber);
    populateBranchComputerSelect(document.getElementById('uaComputer'), list, selectedName || '');
}

function uaAccessType() {
    return getToggleValue('uaAccessType');
}

function refreshUaComputerBlockVisibility() {
    document.getElementById('uaComputerBlock').style.display = uaAccessType() === 'מחשב' ? 'block' : 'none';
}

function refreshUaNewComputerTypeVisibility() {
    var isOrderNew = document.getElementById('uaComputer').value === ORDER_NEW_COMPUTER_VALUE;
    document.getElementById('uaNewComputerTypeField').style.display = isOrderNew ? 'block' : 'none';
}

document.getElementById('uaComputer').addEventListener('change', refreshUaNewComputerTypeVisibility);

// The נייח/נייד buttons start unselected — the create-computer
// modal only opens once one is actually clicked, never automatically.
initToggleGroup('uaNewComputerType', function (value) {
    var branchNumber = document.getElementById('uaBranch').value;
    openComputerAdminModal(null, {
        prefillType: value,
        prefillBranchNumber: branchNumber,
        onSaved: async function (computerName) {
            await populateUaComputerSelect(branchNumber, computerName);
            refreshUaNewComputerTypeVisibility();
        },
    });
});

initToggleGroup('uaAccessType', refreshUaComputerBlockVisibility);
initFolderCollapse('ua');

document.getElementById('uaBranch').addEventListener('change', function () {
    populateUaComputerSelect(this.value, '');
});

var userAdminTracker = makeDirtyTracker(document.getElementById('userAdminModalBackdrop'));
maskPhoneInput(document.getElementById('uaPhone'));

// Hebrew-name fields reject anything but Hebrew
// letters, English-name fields reject anything but English letters — across all
// three forms that collect a name (submission form, review wizard, users admin).
['urFirstNameHe', 'urLastNameHe', 'urdFirstNameHe', 'urdLastNameHe', 'uaFirstName', 'uaLastName'].forEach(function (id) {
    restrictToHebrewLetters(document.getElementById(id));
});
['urFirstNameEn', 'urLastNameEn', 'urdFirstNameEn', 'urdLastNameEn', 'uaFirstNameEn', 'uaLastNameEn'].forEach(function (id) {
    restrictToEnglishLetters(document.getElementById(id));
});

// Same formula as the server (userRequests.js computeSuggestedEmail) — kept in sync
// manually since this is just a live preview; the server always recomputes for real.
function computeUsernameFromEnglishName(firstNameEn, lastNameEn) {
    var first = String(firstNameEn || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    var last = String(lastNameEn || '').trim().toLowerCase().replace(/[^a-z]/g, '').slice(0, 2);
    if (!first || !last) return '';
    return first + '.' + last;
}

var uaUsernameManuallyEdited = false;
document.getElementById('uaUsername').addEventListener('input', function () { uaUsernameManuallyEdited = true; });

function autoFillUsernameFromEnglishName() {
    if (editingUserEmail || uaUsernameManuallyEdited) return;
    var computed = computeUsernameFromEnglishName(document.getElementById('uaFirstNameEn').value, document.getElementById('uaLastNameEn').value);
    if (computed) document.getElementById('uaUsername').value = computed;
}
document.getElementById('uaFirstNameEn').addEventListener('input', autoFillUsernameFromEnglishName);
document.getElementById('uaLastNameEn').addEventListener('input', autoFillUsernameFromEnglishName);

// ── Wizard navigation — same steps as the request review wizard, plus a SuperAdmin-only
// "הרשאות פורטל" permissions step, and a final summary/save step.
var uaCurrentStep = 1;
var uaStepSequence = [1, 2, 4];
var currentUaEditingUser = null;

var UA_STEP_LABELS = { 1: 'פרטי עובד', 2: 'סקריפט', 3: 'הרשאות פורטל', 4: 'סיכום' };

// Editing an existing user skips the "סקריפט" step entirely — the
// Entra account already exists, there's nothing left to run a creation script for.
function uaComputeStepSequence() {
    var seq = [1];
    if (!editingUserEmail) seq.push(2);
    if (Portal.isSuperAdmin()) seq.push(3);
    seq.push(4);
    return seq;
}

// The step dots are clickable — jumping forward past step 1 still
// runs its validation (same guard as the "הבא" button), jumping back never needs to.
function goToUaStep(step) {
    if (uaStepSequence.indexOf(step) === -1 || step === uaCurrentStep) return;
    if (uaCurrentStep === 1 && step !== 1 && !uaValidateStep1()) return;
    setUaStep(step);
}

function renderUaWizardDots() {
    var seq = uaStepSequence;
    var idx = seq.indexOf(uaCurrentStep);
    var html = '';
    seq.forEach(function (step, i) {
        html += '<div class="wizard-step' + (i === idx ? ' active' : (i < idx ? ' done' : '')) +
            '" data-step="' + step + '" style="cursor:pointer">' +
            '<span>' + (i + 1) + '</span><label>' + UA_STEP_LABELS[step] + '</label></div>';
        if (i < seq.length - 1) html += '<div class="wizard-step-line' + (i < idx ? ' done' : '') + '"></div>';
    });
    var container = document.getElementById('uaWizardSteps');
    container.innerHTML = html;
    container.querySelectorAll('[data-step]').forEach(function (dot) {
        dot.addEventListener('click', function () { goToUaStep(Number(dot.getAttribute('data-step'))); });
    });
}

function buildUaSummaryHtml() {
    var accessType = uaAccessType();
    var email = editingUserEmail || (document.getElementById('uaUsername').value.trim().toLowerCase() + '@rami-levy-stock.co.il');
    var lines = [
        '<div><strong>שם: </strong>' + escapeHtml(document.getElementById('uaFirstName').value.trim() + ' ' + document.getElementById('uaLastName').value.trim()) + '</div>',
        '<div><strong>מייל: </strong><span dir="ltr">' + escapeHtml(email) + '</span></div>',
        '<div><strong>סניף: </strong>' + escapeHtml(branchName(document.getElementById('uaBranch').value)) + '</div>',
        '<div><strong>תפקיד: </strong>' + escapeHtml(document.getElementById('uaRole').value.trim()) + '</div>',
        '<div><strong>סוג גישה: </strong>' + escapeHtml(accessType || '') + '</div>',
    ];
    if (accessType === 'מחשב') {
        lines.push('<div><strong>עמדת מחשב: </strong>' + escapeHtml(document.getElementById('uaComputer').value || '-') + '</div>');
    }
    if (Portal.isSuperAdmin()) {
        var flags = [];
        if (document.getElementById('uaIsITAdmin').checked) flags.push('IT');
        if (document.getElementById('uaIsProceduresAdmin').checked) flags.push('נהלים');
        if (document.getElementById('uaIsUserRequestSubmitter').checked) flags.push('בקשת הקמת משתמש');
        lines.push('<div><strong>הרשאות פורטל: </strong>' + (flags.length ? escapeHtml(flags.join(', ')) : 'ללא') + '</div>');
    }
    return lines.join('');
}

function setUaStep(step) {
    uaCurrentStep = step;
    [1, 2, 3, 4].forEach(function (n) {
        document.getElementById('uaStep' + n).style.display = n === step ? 'block' : 'none';
    });
    if (step === 4) document.getElementById('uaSummary').innerHTML = buildUaSummaryHtml();
    renderUaWizardDots();
    var idx = uaStepSequence.indexOf(step);
    var isLast = idx === uaStepSequence.length - 1;
    document.getElementById('uaBackBtn').style.display = idx > 0 ? 'inline-block' : 'none';
    document.getElementById('uaNextBtn').style.display = isLast ? 'none' : 'inline-block';
    document.getElementById('userAdminSaveBtn').style.display = isLast ? 'inline-block' : 'none';
    // Never offered for a SuperAdmin target (server-side rule mirrored here too).
    document.getElementById('uaDeleteBtn').style.display =
        (editingUserEmail && currentUaEditingUser && !currentUaEditingUser.isSuperAdmin) ? 'inline-block' : 'none';
}

// Every field required except shared folders.
function uaValidateStep1() {
    var errEl = document.getElementById('userAdminModalError');
    errEl.style.display = 'none';
    if (!editingUserEmail && !document.getElementById('uaUsername').value.trim()) {
        errEl.textContent = 'יש למלא מייל'; errEl.style.display = 'block'; return false;
    }
    var firstNameHe = document.getElementById('uaFirstName').value.trim();
    var lastNameHe = document.getElementById('uaLastName').value.trim();
    var firstNameEn = document.getElementById('uaFirstNameEn').value.trim();
    var lastNameEn = document.getElementById('uaLastNameEn').value.trim();
    if (!firstNameHe || !lastNameHe || !firstNameEn || !lastNameEn) {
        errEl.textContent = 'יש למלא שם פרטי ומשפחה בעברית ובאנגלית'; errEl.style.display = 'block'; return false;
    }
    if (!document.getElementById('uaBranch').value) {
        errEl.textContent = 'יש לבחור סניף'; errEl.style.display = 'block'; return false;
    }
    if (!document.getElementById('uaRole').value.trim()) {
        errEl.textContent = 'יש למלא תפקיד'; errEl.style.display = 'block'; return false;
    }
    var accessType = uaAccessType();
    if (!accessType) {
        errEl.textContent = 'יש לבחור סוג גישה'; errEl.style.display = 'block'; return false;
    }
    if (accessType === 'מחשב') {
        var computerSelectValue = document.getElementById('uaComputer').value;
        if (!computerSelectValue || computerSelectValue === ORDER_NEW_COMPUTER_VALUE) {
            errEl.textContent = 'יש לבחור עמדת מחשב קיימת או לסיים את רישום המחשב החדש'; errEl.style.display = 'block'; return false;
        }
    }
    return true;
}

document.getElementById('uaNextBtn').addEventListener('click', function () {
    var idx = uaStepSequence.indexOf(uaCurrentStep);
    goToUaStep(uaStepSequence[idx + 1]);
});

document.getElementById('uaBackBtn').addEventListener('click', function () {
    var idx = uaStepSequence.indexOf(uaCurrentStep);
    setUaStep(uaStepSequence[idx - 1]);
});

export async function openUserAdminModal(user) {
    editingUserEmail = user ? user.email : null;
    currentUaEditingUser = user || null;
    uaUsernameManuallyEdited = false;
    uaScriptPasswordManuallyEdited = false;
    document.getElementById('userAdminModalTitle').textContent = user ? 'עריכת משתמש' : 'משתמש חדש';
    document.getElementById('uaUsername').value = user ? user.email.split('@')[0] : '';
    document.getElementById('uaUsername').disabled = !!user;
    document.getElementById('uaFirstName').value = user ? user.firstName : '';
    document.getElementById('uaLastName').value = user ? user.lastName : '';
    document.getElementById('uaFirstNameEn').value = user ? (user.firstNameEn || '') : '';
    document.getElementById('uaLastNameEn').value = user ? (user.lastNameEn || '') : '';
    document.getElementById('uaPhone').value = user ? user.phone : '';
    await ensureBranchesLoaded();
    populateBranchSelect(document.getElementById('uaBranch'), user ? user.branchNumber : '');
    await ensureSharedFoldersLoaded();
    renderFolderCheckboxes(document.getElementById('uaFolders'), []);
    refreshFolderCollapseSummary('ua');
    collapseFolderPicker('ua');
    document.getElementById('uaScriptResult').style.display = 'none';
    document.getElementById('uaRole').value = user ? user.role : '';
    document.getElementById('uaIsITAdmin').checked = !!(user && user.isITAdmin);
    document.getElementById('uaIsProceduresAdmin').checked = !!(user && user.isProceduresAdmin);
    document.getElementById('uaIsUserRequestSubmitter').checked = !!(user && user.isUserRequestSubmitter);
    var assignedComp = user ? computerAssignedTo(user.email) : null;
    // A brand-new user starts with nothing selected; editing an
    // existing user reflects their real current state, which isn't a "default".
    setToggleValue('uaAccessType', user ? (assignedComp ? 'מחשב' : 'מייל') : null);
    setToggleValue('uaNewComputerType', null);
    await populateUaComputerSelect(user ? user.branchNumber : '', assignedComp ? assignedComp.computerName : '');
    refreshUaComputerBlockVisibility();
    refreshUaNewComputerTypeVisibility();
    document.getElementById('userAdminModalError').style.display = 'none';
    document.getElementById('userAdminModalBackdrop').classList.add('visible');
    uaStepSequence = uaComputeStepSequence();
    setUaStep(1);
    userAdminTracker.reset();
}

function closeUserAdminModal() { document.getElementById('userAdminModalBackdrop').classList.remove('visible'); }

document.getElementById('userAdminAddBtn').addEventListener('click', function () { openUserAdminModal(null); });
document.getElementById('userAdminCancelBtn').addEventListener('click', function () {
    if (userAdminTracker.confirmDiscard()) closeUserAdminModal();
});

document.getElementById('userAdminSaveBtn').addEventListener('click', async function () {
    var errEl = document.getElementById('userAdminModalError');
    var isComputerAccess = uaAccessType() === 'מחשב';
    var computerSelectValue = document.getElementById('uaComputer').value;
    if (isComputerAccess && computerSelectValue === ORDER_NEW_COMPUTER_VALUE) {
        errEl.textContent = 'יש לסיים את יצירת המחשב החדש (או לבחור עמדה קיימת) לפני השמירה';
        errEl.style.display = 'block';
        return;
    }
    var payload = {
        firstName: document.getElementById('uaFirstName').value.trim(),
        lastName: document.getElementById('uaLastName').value.trim(),
        firstNameEn: document.getElementById('uaFirstNameEn').value.trim(),
        lastNameEn: document.getElementById('uaLastNameEn').value.trim(),
        phone: document.getElementById('uaPhone').value.trim(),
        branchNumber: document.getElementById('uaBranch').value,
        role: document.getElementById('uaRole').value.trim(),
        isITAdmin: document.getElementById('uaIsITAdmin').checked,
        isProceduresAdmin: document.getElementById('uaIsProceduresAdmin').checked,
        isUserRequestSubmitter: document.getElementById('uaIsUserRequestSubmitter').checked,
        assignedComputerName: isComputerAccess ? computerSelectValue : '',
    };
    if (editingUserEmail) {
        payload.email = editingUserEmail;
    } else {
        payload.username = document.getElementById('uaUsername').value.trim().toLowerCase();
        if (!payload.username) { errEl.textContent = 'יש למלא מייל'; errEl.style.display = 'block'; return; }
    }

    showLoading(true);
    var res = await apiPost('users', editingUserEmail ? 'adminUpdate' : 'create', payload);
    showLoading(false);
    if (res.ok) { userAdminTracker.reset(); closeUserAdminModal(); loadUsersAdminPage(); }
    else { errEl.textContent = res.error || 'שגיאה בשמירה'; errEl.style.display = 'block'; }
});

var uaScriptPasswordManuallyEdited = false;
document.getElementById('uaScriptPassword').addEventListener('input', function () { uaScriptPasswordManuallyEdited = true; });

async function generateUaScript() {
    var errEl = document.getElementById('userAdminModalError');
    var scriptPayload = {
        firstNameHe: document.getElementById('uaFirstName').value.trim(),
        lastNameHe: document.getElementById('uaLastName').value.trim(),
        firstNameEn: document.getElementById('uaFirstNameEn').value.trim(),
        lastNameEn: document.getElementById('uaLastNameEn').value.trim(),
        role: document.getElementById('uaRole').value.trim(),
        branchNumber: document.getElementById('uaBranch').value,
        folderIds: uaAccessType() === 'מחשב' ? getSelectedFolderIds(document.getElementById('uaFolders')) : [],
    };
    if (uaScriptPasswordManuallyEdited) scriptPayload.tempPassword = document.getElementById('uaScriptPassword').value;
    if (!scriptPayload.firstNameHe || !scriptPayload.lastNameHe || !scriptPayload.firstNameEn || !scriptPayload.lastNameEn) {
        errEl.textContent = 'יש למלא שם פרטי ומשפחה בעברית ובאנגלית כדי להכין סקריפט';
        errEl.style.display = 'block';
        return;
    }
    showLoading(true);
    var res = await apiPost('userRequests', 'previewScript', scriptPayload);
    showLoading(false);
    if (res.ok) {
        document.getElementById('uaScriptEmail').value = res.data.suggestedEmail;
        document.getElementById('uaScriptPassword').value = res.data.tempPassword;
        document.getElementById('uaScriptBox').value = res.data.script;
        document.getElementById('uaScriptResult').style.display = 'block';
    } else {
        errEl.textContent = res.error || 'שגיאה בהכנת הסקריפט';
        errEl.style.display = 'block';
    }
}

document.getElementById('uaGenerateScriptBtn').addEventListener('click', function () {
    uaScriptPasswordManuallyEdited = false;
    generateUaScript();
});
document.getElementById('uaScriptPassword').addEventListener('change', generateUaScript);

document.getElementById('uaCopyScriptBtn').addEventListener('click', function () {
    copyToClipboard(document.getElementById('uaScriptBox').value, this);
});
document.getElementById('uaCopyPasswordBtn').addEventListener('click', function () {
    copyToClipboard(document.getElementById('uaScriptPassword').value, this);
});
document.getElementById('uaCopyCredentialsBtn').addEventListener('click', function () {
    var text = 'כתובת מייל: ' + document.getElementById('uaScriptEmail').value +
        '\nסיסמת התחברות: ' + document.getElementById('uaScriptPassword').value;
    copyToClipboard(text, this);
});

// A red delete button lives inside the edit wizard itself — never
// offered when adding a new user (nothing to delete yet) or for a SuperAdmin target.
async function deleteAdminUser(user) {
    if (!confirm('למחוק את המשתמש ' + user.email + '? פעולה זו אינה הפיכה.')) return;
    showLoading(true);
    var res = await apiPost('users', 'delete', { email: user.email });
    showLoading(false);
    if (res.ok) { closeUserAdminModal(); loadUsersAdminPage(); }
    else {
        var errEl = document.getElementById('userAdminModalError');
        errEl.textContent = res.error || 'שגיאה במחיקה';
        errEl.style.display = 'block';
    }
}

document.getElementById('uaDeleteBtn').addEventListener('click', function () {
    if (currentUaEditingUser) deleteAdminUser(currentUaEditingUser);
});


export function setComputersCache(list) { computersCache = list; }
