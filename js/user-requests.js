import { openComputerAdminModal } from './admin-computers.js';
import { Portal, apiGet, apiPost } from './api-client.js';
import { ORDER_NEW_COMPUTER_VALUE, collapseFolderPicker, copyToClipboard, ensureBranchesLoaded, ensureSharedFoldersLoaded, getSelectedFolderIds, getToggleValue, initFolderCollapse, initToggleGroup, loadComputersByBranch, makeDirtyTracker, populateBranchComputerSelect, populateBranchSelect, refreshFolderCollapseSummary, renderFolderCheckboxes, setToggleValue, showLoading } from './common-ui.js';
import { isHubActive, loadHubDashboard } from './hub.js';
import { showView } from './nav.js';

// ── USER REQUEST FORM ───────────────────
function urAccessType() {
    return getToggleValue('urAccessType');
}

function refreshUrComputerBlockVisibility() {
    document.getElementById('urComputerBlock').style.display = urAccessType() === 'מחשב' ? 'block' : 'none';
}

function refreshUrNewComputerTypeVisibility() {
    var isOrderNew = document.getElementById('urComputerSelect').value === ORDER_NEW_COMPUTER_VALUE;
    document.getElementById('urNewComputerTypeField').style.display = isOrderNew ? 'block' : 'none';
}

export async function loadUserRequestFormPage() {
    document.getElementById('userRequestFormContainer').style.display = 'block';
    document.getElementById('userRequestConfirmation').style.display = 'none';
    document.getElementById('userRequestSubmitError').style.display = 'none';
    ['urFirstNameHe', 'urLastNameHe', 'urFirstNameEn', 'urLastNameEn', 'urRole'].forEach(function (id) {
        document.getElementById(id).value = '';
    });
    // Nothing pre-selected on a brand-new form — the computer
    // block only appears once the employee actually clicks "עמדת מחשב".
    setToggleValue('urAccessType', null);
    setToggleValue('urNewComputerType', null);
    showLoading(true);
    await ensureBranchesLoaded();
    populateBranchSelect(document.getElementById('urBranch'), '');
    populateBranchComputerSelect(document.getElementById('urComputerSelect'), [], '');
    await ensureSharedFoldersLoaded();
    renderFolderCheckboxes(document.getElementById('urFolders'), []);
    collapseFolderPicker('ur');
    refreshFolderCollapseSummary('ur');
    showLoading(false);
    refreshUrComputerBlockVisibility();
    refreshUrNewComputerTypeVisibility();
}

initToggleGroup('urAccessType', refreshUrComputerBlockVisibility);
initToggleGroup('urNewComputerType', function () {});
initFolderCollapse('ur');

document.getElementById('urComputerSelect').addEventListener('change', refreshUrNewComputerTypeVisibility);

document.getElementById('urBranch').addEventListener('change', async function () {
    var branchNumber = this.value;
    showLoading(true);
    var list = await loadComputersByBranch(branchNumber);
    showLoading(false);
    populateBranchComputerSelect(document.getElementById('urComputerSelect'), list, '');
    refreshUrNewComputerTypeVisibility();
});

document.getElementById('userRequestSubmitBtn').addEventListener('click', async function () {
    var errEl = document.getElementById('userRequestSubmitError');
    var accessType = urAccessType();
    var computerSelectValue = document.getElementById('urComputerSelect').value;
    var payload = {
        firstNameHe: document.getElementById('urFirstNameHe').value.trim(),
        lastNameHe: document.getElementById('urLastNameHe').value.trim(),
        firstNameEn: document.getElementById('urFirstNameEn').value.trim(),
        lastNameEn: document.getElementById('urLastNameEn').value.trim(),
        branchNumber: document.getElementById('urBranch').value,
        role: document.getElementById('urRole').value.trim(),
        accessType: accessType,
    };
    if (accessType === 'מחשב') {
        if (computerSelectValue === ORDER_NEW_COMPUTER_VALUE) {
            payload.newComputerType = getToggleValue('urNewComputerType');
        } else {
            payload.assignedComputerName = computerSelectValue;
        }
        payload.folderIds = getSelectedFolderIds(document.getElementById('urFolders'));
    }
    // Every field is required except shared folders.
    if (!payload.firstNameHe || !payload.lastNameHe || !payload.firstNameEn || !payload.lastNameEn) {
        errEl.textContent = 'יש למלא שם פרטי ומשפחה בעברית ובאנגלית';
        errEl.style.display = 'block';
        return;
    }
    if (!payload.branchNumber) {
        errEl.textContent = 'יש לבחור סניף';
        errEl.style.display = 'block';
        return;
    }
    if (!payload.role) {
        errEl.textContent = 'יש למלא תפקיד';
        errEl.style.display = 'block';
        return;
    }
    if (!accessType) {
        errEl.textContent = 'יש לבחור סוג גישה';
        errEl.style.display = 'block';
        return;
    }
    if (accessType === 'מחשב' && !payload.assignedComputerName && !payload.newComputerType) {
        errEl.textContent = 'יש לבחור עמדת מחשב קיימת או להזמין מחשב חדש';
        errEl.style.display = 'block';
        return;
    }
    showLoading(true);
    var res = await apiPost('userRequests', 'create', payload);
    showLoading(false);
    if (res.ok) {
        document.getElementById('confirmUserRequestNumber').textContent = res.data.requestNumber;
        document.getElementById('userRequestFormContainer').style.display = 'none';
        document.getElementById('userRequestConfirmation').style.display = 'block';
    } else {
        errEl.textContent = res.error || 'שגיאה בשליחת הבקשה';
        errEl.style.display = 'block';
    }
});

document.getElementById('userRequestHomeBtn').addEventListener('click', function () { showView('hub'); });

// Requests now surface only via the dashboard's unified tasks tab (see getAllTasks) —
// there's no separate admin queue page anymore; openUserRequestId still tracks which
// request the review wizard below is open for.
var openUserRequestId = null;

// The review modal is a wizard (פרטי עובד → סקריפט → [הרשאות פורטל] →
// שליחה) instead of one long flat form. The permissions step is SuperAdmin-only, same
// sequence-skip pattern as the users-admin wizard (uaStepSequence).
var userRequestDetailTracker = makeDirtyTracker(document.getElementById('userRequestDetailBackdrop'));
var currentUserRequestFull = null;
var urdCurrentStep = 1;
var urdStepSequence = [1, 2, 4];
var urdScriptPasswordManuallyEdited = false;

var URD_STEP_LABELS = { 1: 'פרטי עובד', 2: 'סקריפט', 3: 'הרשאות פורטל', 4: 'שליחה' };

function urdComputeStepSequence() {
    return Portal.isSuperAdmin() ? [1, 2, 3, 4] : [1, 2, 4];
}

function renderUrdWizardDots() {
    var seq = urdStepSequence;
    var idx = seq.indexOf(urdCurrentStep);
    var html = '';
    seq.forEach(function (step, i) {
        html += '<div class="wizard-step' + (i === idx ? ' active' : (i < idx ? ' done' : '')) + '"><span>' + (i + 1) + '</span><label>' + URD_STEP_LABELS[step] + '</label></div>';
        if (i < seq.length - 1) html += '<div class="wizard-step-line' + (i < idx ? ' done' : '') + '"></div>';
    });
    document.getElementById('urdWizardSteps').innerHTML = html;
}

function setUrdStep(step) {
    urdCurrentStep = step;
    [1, 2, 3, 4].forEach(function (n) {
        document.getElementById('urdStep' + n).style.display = n === step ? 'block' : 'none';
    });
    renderUrdWizardDots();
    var idx = urdStepSequence.indexOf(step);
    var isLast = idx === urdStepSequence.length - 1;
    var isCompleted = currentUserRequestFull && currentUserRequestFull.status === 'הוקם';
    document.getElementById('urdBackBtn').style.display = idx > 0 ? 'inline-block' : 'none';
    document.getElementById('urdNextBtn').style.display = (!isLast && !isCompleted) ? 'inline-block' : 'none';
    document.getElementById('urdMarkCompletedBtn').style.display = (isLast && !isCompleted) ? 'inline-block' : 'none';
}

function urdAccessType() {
    return getToggleValue('urdAccessType');
}

function refreshUrdComputerBlockVisibility() {
    document.getElementById('urdComputerBlock').style.display = urdAccessType() === 'מחשב' ? 'block' : 'none';
}

function refreshUrdNewComputerTypeVisibility() {
    var isOrderNew = document.getElementById('urdComputerSelect').value === ORDER_NEW_COMPUTER_VALUE;
    document.getElementById('urdNewComputerTypeField').style.display = isOrderNew ? 'block' : 'none';
}

// Shows the "רשום מחשב שהתקבל" banner only while the request is waiting on an
// ordered-but-not-yet-registered computer (see markCompleted's gate on the server).
function refreshUrdProcurementStatus(req) {
    var needsComputer = req && req.accessType === 'מחשב' && req.newComputerType && !req.assignedComputerName;
    document.getElementById('urdProcurementStatus').style.display = needsComputer ? 'block' : 'none';
    if (needsComputer) {
        document.getElementById('urdProcurementStatusText').textContent =
            'הוזמן מחשב ' + req.newComputerType + ' חדש - יש לרשום אותו במערכת לפני שניתן יהיה להשלים את הבקשה.';
    }
}

function currentUserRequestFieldPayload() {
    var accessType = urdAccessType();
    var computerSelectValue = document.getElementById('urdComputerSelect').value;
    var payload = {
        requestId: openUserRequestId,
        firstNameHe: document.getElementById('urdFirstNameHe').value.trim(),
        lastNameHe: document.getElementById('urdLastNameHe').value.trim(),
        firstNameEn: document.getElementById('urdFirstNameEn').value.trim(),
        lastNameEn: document.getElementById('urdLastNameEn').value.trim(),
        branchNumber: document.getElementById('urdBranch').value,
        role: document.getElementById('urdRole').value.trim(),
        accessType: accessType,
    };
    if (accessType === 'מחשב') {
        if (computerSelectValue === ORDER_NEW_COMPUTER_VALUE) {
            payload.newComputerType = getToggleValue('urdNewComputerType');
        } else {
            payload.assignedComputerName = computerSelectValue;
        }
        payload.folderIds = getSelectedFolderIds(document.getElementById('urdFolders'));
    } else {
        payload.folderIds = [];
    }
    if (urdScriptPasswordManuallyEdited) payload.tempPassword = document.getElementById('urdScriptPassword').value;
    return payload;
}

async function refreshUserRequestScriptPreview() {
    var res = await apiPost('userRequests', 'previewScript', currentUserRequestFieldPayload());
    if (res.ok) {
        document.getElementById('urdSuggestedEmail').value = res.data.suggestedEmail;
        document.getElementById('urdScriptPassword').value = res.data.tempPassword;
        document.getElementById('urdScript').value = res.data.script;
    }
}

function buildWelcomeMessage(req) {
    return 'שלום ' + req.firstNameHe + ',\n\n' +
        'המשתמש שלך במערכות החברה הוקם.\n' +
        'שם משתמש: ' + req.suggestedEmail + '\n' +
        'סיסמה זמנית: ' + req.tempPassword + '\n\n' +
        'בכניסה הראשונה תתבקש/י לבחור סיסמה חדשה.';
}

export async function openUserRequestDetail(r) {
    openUserRequestId = r.requestId;
    urdScriptPasswordManuallyEdited = false;
    document.getElementById('userRequestDetailTitle').textContent = r.requestNumber;
    document.getElementById('userRequestDetailError').style.display = 'none';
    document.getElementById('userRequestDetailBackdrop').classList.add('visible');
    // The request itself never stores portal-permission flags —
    // they're chosen fresh each review, same starting point as adding a plain user.
    document.getElementById('urdIsITAdmin').checked = false;
    document.getElementById('urdIsProceduresAdmin').checked = false;
    document.getElementById('urdIsUserRequestSubmitter').checked = false;
    urdStepSequence = urdComputeStepSequence();
    setUrdStep(1);

    showLoading(true);
    // Opening a still-pending request IS how IT "takes" it — a claim
    // by someone else in the meantime just surfaces as a normal load error below.
    if (r.status === 'ממתינה') await apiPost('userRequests', 'take', { requestId: r.requestId }).catch(function () {});
    var res = await apiGet('userRequests', 'get', { requestId: r.requestId });
    showLoading(false);
    if (!res.ok) {
        document.getElementById('userRequestDetailError').textContent = res.error || 'שגיאה בטעינה';
        document.getElementById('userRequestDetailError').style.display = 'block';
        return;
    }
    var req = res.data.request;
    currentUserRequestFull = req;
    currentUserRequestFull.procurementTaskId = res.data.procurementTaskId || null;
    document.getElementById('urdFirstNameHe').value = req.firstNameHe;
    document.getElementById('urdLastNameHe').value = req.lastNameHe;
    document.getElementById('urdFirstNameEn').value = req.firstNameEn;
    document.getElementById('urdLastNameEn').value = req.lastNameEn;
    await ensureBranchesLoaded();
    populateBranchSelect(document.getElementById('urdBranch'), req.branchNumber);
    document.getElementById('urdRole').value = req.role;
    await ensureSharedFoldersLoaded();
    renderFolderCheckboxes(document.getElementById('urdFolders'), res.data.folders.map(function (f) { return f.id; }));
    refreshFolderCollapseSummary('urd');
    collapseFolderPicker('urd');
    document.getElementById('urdRequesterEmailNote').textContent = req.requesterEmail || '';

    setToggleValue('urdAccessType', req.accessType || 'מחשב');
    var branchComputers = await loadComputersByBranch(req.branchNumber);
    var computerSelectValue = req.assignedComputerName || (req.newComputerType ? ORDER_NEW_COMPUTER_VALUE : '');
    populateBranchComputerSelect(document.getElementById('urdComputerSelect'), branchComputers, computerSelectValue);
    setToggleValue('urdNewComputerType', req.newComputerType || null);
    refreshUrdComputerBlockVisibility();
    refreshUrdNewComputerTypeVisibility();
    refreshUrdProcurementStatus(req);

    if (req.status === 'הוקם') {
        document.getElementById('urdSuggestedEmail').value = req.suggestedEmail;
        document.getElementById('urdScriptPassword').value = req.tempPassword;
        document.getElementById('urdWelcomeMessage').value = buildWelcomeMessage(req);
        setUrdStep(urdStepSequence[urdStepSequence.length - 1]);
    }
    userRequestDetailTracker.reset();
}

function closeUserRequestDetail() { document.getElementById('userRequestDetailBackdrop').classList.remove('visible'); }

document.getElementById('urdCancelBtn').addEventListener('click', function () {
    if (userRequestDetailTracker.confirmDiscard()) closeUserRequestDetail();
});
document.getElementById('urdCopyScriptBtn').addEventListener('click', function () {
    copyToClipboard(document.getElementById('urdScript').value, this);
});
document.getElementById('urdCopyPasswordBtn').addEventListener('click', function () {
    copyToClipboard(document.getElementById('urdScriptPassword').value, this);
});
document.getElementById('urdCopyWelcomeBtn').addEventListener('click', function () {
    copyToClipboard(document.getElementById('urdWelcomeMessage').value, this);
});
document.getElementById('urdScriptPassword').addEventListener('input', function () { urdScriptPasswordManuallyEdited = true; });
document.getElementById('urdScriptPassword').addEventListener('change', refreshUserRequestScriptPreview);

initToggleGroup('urdAccessType', refreshUrdComputerBlockVisibility);
initToggleGroup('urdNewComputerType', function () {});
initFolderCollapse('urd');
document.getElementById('urdComputerSelect').addEventListener('change', refreshUrdNewComputerTypeVisibility);
document.getElementById('urdBranch').addEventListener('change', async function () {
    var list = await loadComputersByBranch(this.value);
    populateBranchComputerSelect(document.getElementById('urdComputerSelect'), list, '');
    refreshUrdNewComputerTypeVisibility();
});

document.getElementById('urdCreateComputerBtn').addEventListener('click', function () {
    openComputerAdminModal(null, {
        prefillType: currentUserRequestFull ? currentUserRequestFull.newComputerType : 'נייח',
        prefillBranchNumber: document.getElementById('urdBranch').value,
        onSaved: async function (computerName) {
            if (currentUserRequestFull && currentUserRequestFull.procurementTaskId) {
                showLoading(true);
                var linkRes = await apiPost('procurementTasks', 'linkComputer', {
                    taskId: currentUserRequestFull.procurementTaskId, computerName: computerName,
                });
                showLoading(false);
                if (!linkRes.ok) { alert(linkRes.error || 'שגיאה בשיוך המחשב לבקשה'); return; }
            }
            var res = await apiGet('userRequests', 'get', { requestId: openUserRequestId });
            if (res.ok) {
                currentUserRequestFull = res.data.request;
                currentUserRequestFull.procurementTaskId = res.data.procurementTaskId || null;
                var branchComputers = await loadComputersByBranch(currentUserRequestFull.branchNumber);
                populateBranchComputerSelect(document.getElementById('urdComputerSelect'), branchComputers, currentUserRequestFull.assignedComputerName);
                refreshUrdNewComputerTypeVisibility();
                refreshUrdProcurementStatus(currentUserRequestFull);
            }
        },
    });
});

document.getElementById('urdBackBtn').addEventListener('click', function () {
    var idx = urdStepSequence.indexOf(urdCurrentStep);
    if (idx > 0) setUrdStep(urdStepSequence[idx - 1]);
});

document.getElementById('urdNextBtn').addEventListener('click', async function () {
    var errEl = document.getElementById('userRequestDetailError');
    errEl.style.display = 'none';

    if (urdCurrentStep === 1) {
        var payload = currentUserRequestFieldPayload();
        if (!payload.firstNameHe || !payload.lastNameHe || !payload.firstNameEn || !payload.lastNameEn) {
            errEl.textContent = 'יש למלא שם פרטי ומשפחה בעברית ובאנגלית';
            errEl.style.display = 'block';
            return;
        }
        if (!payload.branchNumber) {
            errEl.textContent = 'יש לבחור סניף';
            errEl.style.display = 'block';
            return;
        }
        if (!payload.role) {
            errEl.textContent = 'יש למלא תפקיד';
            errEl.style.display = 'block';
            return;
        }
        if (!payload.accessType) {
            errEl.textContent = 'יש לבחור סוג גישה';
            errEl.style.display = 'block';
            return;
        }
        if (payload.accessType === 'מחשב' && !payload.assignedComputerName && !payload.newComputerType) {
            errEl.textContent = 'יש לבחור עמדת מחשב קיימת או להזמין מחשב חדש';
            errEl.style.display = 'block';
            return;
        }
        showLoading(true);
        var res = await apiPost('userRequests', 'update', payload);
        if (res.ok) await refreshUserRequestScriptPreview();
        showLoading(false);
        if (!res.ok) { errEl.textContent = res.error || 'שגיאה בשמירה'; errEl.style.display = 'block'; return; }
        userRequestDetailTracker.reset();
        setUrdStep(urdStepSequence[urdStepSequence.indexOf(1) + 1]);
    } else if (urdCurrentStep === 2) {
        document.getElementById('urdWelcomeMessage').value = buildWelcomeMessage({
            firstNameHe: document.getElementById('urdFirstNameHe').value.trim(),
            suggestedEmail: document.getElementById('urdSuggestedEmail').value,
            tempPassword: document.getElementById('urdScriptPassword').value,
        });
        setUrdStep(urdStepSequence[urdStepSequence.indexOf(2) + 1]);
    } else if (urdCurrentStep === 3) {
        setUrdStep(urdStepSequence[urdStepSequence.indexOf(3) + 1]);
    }
});

document.getElementById('urdMarkCompletedBtn').addEventListener('click', async function () {
    if (!confirm('לסמן את הבקשה כהוקמה? ודא/י שהרצת את הסקריפט בפועל קודם. הפעולה תקים את המשתמש בפורטל ותשלח מייל אוטומטי למגיש הבקשה עם פרטי ההתחברות.')) return;
    showLoading(true);
    var res = await apiPost('userRequests', 'markCompleted', {
        requestId: openUserRequestId,
        isITAdmin: document.getElementById('urdIsITAdmin').checked,
        isProceduresAdmin: document.getElementById('urdIsProceduresAdmin').checked,
        isUserRequestSubmitter: document.getElementById('urdIsUserRequestSubmitter').checked,
    });
    showLoading(false);
    if (res.ok) {
        userRequestDetailTracker.reset();
        closeUserRequestDetail();
        if (isHubActive() && Portal.isITAdmin()) loadHubDashboard();
    } else {
        document.getElementById('userRequestDetailError').textContent = res.error || 'שגיאה';
        document.getElementById('userRequestDetailError').style.display = 'block';
    }
});
