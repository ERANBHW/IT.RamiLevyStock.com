import { Portal, apiPost } from './api-client.js';
import { ensureBranchesLoaded, makeDirtyTracker, maskPhoneInput, populateBranchSelect, showLoading } from './common-ui.js';
import { renderHubGreeting } from './hub.js';

// ── PROFILE EDIT MODAL ────────────────────────────────────
var profileModal = document.getElementById('profileModalBackdrop');
var profileError = document.getElementById('profileModalError');
var profileTracker = makeDirtyTracker(profileModal);
maskPhoneInput(document.getElementById('pfPhone'));

export async function openProfileModal() {
    var user = Portal.getUser();
    document.getElementById('pfFirstName').value = user.firstName || '';
    document.getElementById('pfLastName').value = user.lastName || '';
    document.getElementById('pfPhone').value = user.phone || '';
    await ensureBranchesLoaded();
    populateBranchSelect(document.getElementById('pfBranch'), user.branchNumber);
    document.getElementById('pfRole').value = user.role || '';
    profileError.style.display = 'none';
    profileModal.classList.add('visible');
    profileTracker.reset();
}

function closeProfileModal() { profileModal.classList.remove('visible'); }

document.getElementById('hubUserIcon').addEventListener('click', openProfileModal);
document.getElementById('profileCancelBtn').addEventListener('click', function () {
    if (profileTracker.confirmDiscard()) closeProfileModal();
});

document.getElementById('profileSaveBtn').addEventListener('click', async function () {
    var payload = {
        firstName: document.getElementById('pfFirstName').value.trim(),
        lastName: document.getElementById('pfLastName').value.trim(),
        phone: document.getElementById('pfPhone').value.trim(),
        branchNumber: document.getElementById('pfBranch').value,
        role: document.getElementById('pfRole').value.trim(),
    };
    showLoading(true);
    try {
        var res = await apiPost('users', 'updateProfile', payload);
        showLoading(false);
        if (res.ok) {
            Portal.setUser(res.data);
            renderHubGreeting();
            profileTracker.reset();
            closeProfileModal();
        } else {
            profileError.textContent = res.error || 'שגיאה בשמירה';
            profileError.style.display = 'block';
        }
    } catch (e) {
        showLoading(false);
        profileError.textContent = 'שגיאה בחיבור לשרת';
        profileError.style.display = 'block';
    }
});
