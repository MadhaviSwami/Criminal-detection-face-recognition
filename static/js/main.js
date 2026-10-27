/**
 * FaceVault AI — Main JavaScript (Single Page Application)
 * Handles tab switching, API calls, results rendering, and all UI interactions.
 */

// ══════════════════════════════════════════════════════════════
//  TAB NAVIGATION
// ══════════════════════════════════════════════════════════════

function switchTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

    // Show selected tab
    const tab = document.getElementById('tab-' + tabName);
    if (tab) tab.classList.add('active');

    const link = document.querySelector(`.nav-link[data-tab="${tabName}"]`);
    if (link) link.classList.add('active');

    // Close mobile nav
    document.getElementById('navLinks')?.classList.remove('open');

    // Turn the webcam off when leaving the Live Scan tab
    if (tabName !== 'live' && liveRunning) stopLiveScan();

    // Load data for the tab
    if (tabName === 'dashboard') loadDashboard();
    if (tabName === 'identities') loadIdentities();
    if (tabName === 'logs') loadLogs();
}

// ══════════════════════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ══════════════════════════════════════════════════════════════

function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${message}`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.transition = 'opacity 0.3s, transform 0.3s';
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(50px)';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function showSpinner(text = 'Processing...') {
    document.getElementById('spinnerText').textContent = text;
    document.getElementById('spinnerOverlay').classList.add('active');
}

function hideSpinner() {
    document.getElementById('spinnerOverlay').classList.remove('active');
}

// ══════════════════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════════════════

async function loadDashboard() {
    try {
        const [statsRes, logsRes] = await Promise.all([
            fetch('/api/stats'),
            fetch('/api/logs')
        ]);
        const stats = await statsRes.json();
        const logsData = await logsRes.json();

        // Animate stat counters
        animateValue('statIdentities', stats.total_identities);
        animateValue('statEmbeddings', stats.total_embeddings);
        animateValue('statScans', stats.total_scans);
        animateValue('statMatches', stats.total_matches);

        // Render recent logs
        const logsDiv = document.getElementById('dashboardLogs');
        const logs = logsData.logs || [];

        if (logs.length === 0) {
            logsDiv.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                    <h3>No Activity Yet</h3>
                    <p>Add identities and run recognition scans to see activity here.</p>
                </div>`;
            return;
        }

        let html = `<div class="table-container"><table class="data-table">
            <thead><tr><th>Time</th><th>Type</th><th>Faces</th><th>Matches</th><th>Status</th><th>Details</th></tr></thead><tbody>`;
        for (const log of logs.slice(0, 10)) {
            const status = log.matches_found > 0
                ? '<span style="color:var(--success)">● Match Found</span>'
                : '<span style="color:var(--text-muted)">○ No Match</span>';
            html += `<tr>
                <td class="mono">${log.created_at}</td>
                <td>${scanTypeBadge(log.scan_type)}</td>
                <td><span class="results-badge badge-faces">${log.faces_detected}</span></td>
                <td><span class="results-badge badge-matches">${log.matches_found}</span></td>
                <td>${status}</td>
                <td>${viewLink(log.id)}</td>
            </tr>`;
        }
        html += '</tbody></table></div>';
        logsDiv.innerHTML = html;
    } catch (e) {
        console.error('Dashboard load error:', e);
    }
}

function animateValue(elementId, target) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const start = parseInt(el.textContent) || 0;
    if (start === target) { el.textContent = target; return; }
    const duration = 600;
    const startTime = performance.now();
    function update(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(start + (target - start) * eased);
        if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}

async function deleteAllData() {
    if (!confirm('⚠️ Delete ALL identities, embeddings, and logs? This cannot be undone.')) return;
    if (!confirm('Confirm again to proceed.')) return;
    try {
        const res = await fetch('/api/delete-all-data', { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            loadDashboard();
        } else {
            showToast(data.error || 'Failed', 'error');
        }
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════
//  FACE RECOGNITION
// ══════════════════════════════════════════════════════════════

let selectedFile = null;

document.addEventListener('DOMContentLoaded', () => {
    const uploadZone = document.getElementById('uploadZone');
    const imageInput = document.getElementById('imageInput');

    uploadZone?.addEventListener('click', () => imageInput.click());

    uploadZone?.addEventListener('dragover', e => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });
    uploadZone?.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
    uploadZone?.addEventListener('drop', e => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });

    imageInput?.addEventListener('change', e => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    document.getElementById('analyzeBtn')?.addEventListener('click', analyzeFaces);

    // Mobile nav toggle
    document.getElementById('navToggle')?.addEventListener('click', () => {
        document.getElementById('navLinks')?.classList.toggle('open');
    });

    // Identity form
    document.getElementById('addIdentityForm')?.addEventListener('submit', submitIdentity);

    // Extra photo input
    document.getElementById('extraPhotoInput')?.addEventListener('change', submitExtraPhoto);

    // Initial data load
    loadDashboard();
});

function handleFile(file) {
    if (!file.type.startsWith('image/')) {
        showToast('Please select a valid image file.', 'error');
        return;
    }
    selectedFile = file;
    const reader = new FileReader();
    reader.onload = e => {
        document.getElementById('uploadPreview').src = e.target.result;
        document.getElementById('uploadPreview').style.display = 'block';
        document.getElementById('uploadIcon').style.display = 'none';
        document.getElementById('uploadText').textContent = file.name;
        document.getElementById('uploadZone').classList.add('has-file');
        document.getElementById('analyzeBtn').disabled = false;
    };
    reader.readAsDataURL(file);
}

async function analyzeFaces() {
    if (!selectedFile) return;

    showSpinner('Analyzing faces... This may take a moment.');
    document.getElementById('analyzeBtn').disabled = true;
    document.getElementById('resultsContainer').innerHTML = '';

    const formData = new FormData();
    formData.append('image', selectedFile);

    try {
        const res = await fetch('/api/recognize', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.error) {
            showToast(data.error, 'error');
        } else {
            renderResults(data);
            showToast(`Detected ${data.faces_detected} face(s), ${data.total_matches || 0} match(es)`, 'success');
        }
    } catch (e) {
        showToast('Recognition failed: ' + e.message, 'error');
    } finally {
        hideSpinner();
        document.getElementById('analyzeBtn').disabled = false;
    }
}

function renderResults(data) {
    const container = document.getElementById('resultsContainer');

    if (data.faces_detected === 0) {
        container.innerHTML = `
            <div class="card results-container">
                <div class="empty-state">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 15s1.5-2 4-2 4 2 4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                    <h3>No Faces Detected</h3>
                    <p>Try a different image with clearly visible faces.</p>
                </div>
            </div>`;
        return;
    }

    let html = `<div class="results-container">
        <div class="results-header">
            <h2 class="card-title">Recognition Results</h2>
            <span class="results-badge badge-faces">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
                ${data.faces_detected} Face${data.faces_detected > 1 ? 's' : ''} Detected
            </span>
            <span class="results-badge badge-matches">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                ${data.total_matches} Match${data.total_matches !== 1 ? 'es' : ''}
            </span>
        </div>`;

    if (data.annotated_image) {
        html += `<div class="image-compare">
            <div><p class="image-label">Original Upload</p><img src="${data.uploaded_image}" alt="Original"></div>
            <div><p class="image-label">Detected Faces</p><img src="${data.annotated_image}" alt="Detected"></div>
        </div>`;
    }

    for (const result of data.results) {
        html += `<div class="face-result">
            <div class="face-result-header">
                <img src="${result.crop_image}" class="face-crop" alt="Face ${result.face_index}">
                <div class="face-info">
                    <h3>Face #${result.face_index}</h3>
                    <p>Detection confidence: ${(result.detection_confidence * 100).toFixed(1)}%</p>
                </div>
            </div>`;

        if (result.matches.length > 0) {
            html += '<div class="matches-grid">';
            for (const m of result.matches) {
                const pct = (m.similarity * 100).toFixed(1);
                const cls = m.similarity >= 0.55 ? 'similarity-high' : m.similarity >= 0.40 ? 'similarity-medium' : 'similarity-low';
                const clr = m.similarity >= 0.55 ? 'var(--success)' : m.similarity >= 0.40 ? 'var(--warning)' : 'var(--danger)';
                html += `<div class="match-card">
                    ${m.photo_path ? `<img src="${m.photo_path}" class="match-photo" alt="${m.name}">` : '<div class="match-photo-placeholder">👤</div>'}
                    <div class="match-details">
                        <h4>${m.name}</h4>
                        ${m.alias ? `<div class="match-alias">aka "${m.alias}"</div>` : ''}
                        <div class="match-similarity ${cls}">
                            ${pct}% match
                            <div class="similarity-bar"><div class="similarity-bar-fill" style="width:${pct}%;background:${clr}"></div></div>
                        </div>
                        ${m.description ? `<p style="font-size:0.8rem;color:var(--text-muted);margin-top:6px">${m.description}</p>` : ''}
                    </div>
                </div>`;
            }
            html += '</div>';
        } else {
            html += `<div class="no-matches">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                <p>No matching identities found in the database for this face.</p>
            </div>`;
        }
        html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════
//  IDENTITIES
// ══════════════════════════════════════════════════════════════

async function loadIdentities() {
    try {
        const res = await fetch('/api/identities');
        const data = await res.json();
        const grid = document.getElementById('identitiesGrid');
        const empty = document.getElementById('identitiesEmpty');
        const identities = data.identities || [];

        if (identities.length === 0) {
            grid.innerHTML = '';
            grid.style.display = 'none';
            empty.style.display = 'block';
            return;
        }

        grid.style.display = '';
        empty.style.display = 'none';

        grid.innerHTML = identities.map(id => `
            <div class="identity-card fade-in-up" id="idCard${id.id}">
                <div class="identity-photo-container">
                    ${id.photo_path
                        ? `<img src="${id.photo_path}" class="identity-photo" alt="${id.name}">`
                        : '<div class="identity-photo-placeholder">👤</div>'
                    }
                </div>
                <div class="identity-details">
                    <div class="identity-name">${id.name}</div>
                    ${id.alias ? `<div class="identity-alias">aka "${id.alias}"</div>` : ''}
                    ${id.description ? `<p class="identity-description">${id.description}</p>` : ''}
                    <div class="identity-meta">
                        <span class="embedding-badge">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
                            ${id.embedding_count} embedding${id.embedding_count !== 1 ? 's' : ''}
                        </span>
                        <div class="identity-actions">
                            <button class="btn btn-secondary btn-sm" onclick="addPhotoToIdentity(${id.id},'${id.name.replace(/'/g, "\\'")}')" title="Add more photos">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                            </button>
                            <button class="btn btn-danger btn-sm" onclick="deleteIdentity(${id.id},'${id.name.replace(/'/g, "\\'")}')" title="Delete">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');

    } catch (e) {
        console.error('Load identities error:', e);
    }
}

function openAddModal() {
    document.getElementById('addModal').classList.add('active');
}

function closeAddModal() {
    document.getElementById('addModal').classList.remove('active');
    document.getElementById('addIdentityForm').reset();
}

// Close modal on overlay click
document.addEventListener('click', e => {
    if (e.target.id === 'addModal') closeAddModal();
    if (e.target.id === 'scanModal') closeScanDetails();
});

async function submitIdentity(e) {
    e.preventDefault();
    const btn = document.getElementById('submitIdentityBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    showSpinner('Adding identity & generating embeddings...');

    const formData = new FormData(e.target);

    try {
        const res = await fetch('/api/identities', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            closeAddModal();
            loadIdentities();
            loadDashboard();
        } else {
            showToast(data.error || 'Failed to add identity.', 'error');
        }
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        hideSpinner();
        btn.disabled = false;
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Save Identity';
    }
}

async function deleteIdentity(id, name) {
    if (!confirm(`Delete "${name}" and all associated facial data?`)) return;

    try {
        const res = await fetch(`/api/identities/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            const card = document.getElementById(`idCard${id}`);
            if (card) {
                card.style.transition = 'opacity 0.3s, transform 0.3s';
                card.style.opacity = '0';
                card.style.transform = 'scale(0.9)';
                setTimeout(() => { card.remove(); loadIdentities(); }, 300);
            }
            loadDashboard();
        } else {
            showToast(data.error || 'Delete failed.', 'error');
        }
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

let currentPhotoIdentityId = null;

function addPhotoToIdentity(id, name) {
    currentPhotoIdentityId = id;
    document.getElementById('extraPhotoInput').click();
}

async function submitExtraPhoto(e) {
    if (!e.target.files.length || !currentPhotoIdentityId) return;

    showSpinner('Generating face embeddings...');
    const formData = new FormData();
    formData.append('photo', e.target.files[0]);

    try {
        const res = await fetch(`/api/identities/${currentPhotoIdentityId}/add-photo`, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            loadIdentities();
            loadDashboard();
        } else {
            showToast(data.error || 'Failed to add photo.', 'error');
        }
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        hideSpinner();
        e.target.value = '';
        currentPhotoIdentityId = null;
    }
}

// ══════════════════════════════════════════════════════════════
//  LIVE SCAN (webcam)
// ══════════════════════════════════════════════════════════════

const LIVE_CAPTURE_WIDTH = 640;      // frames are downscaled to this width before upload
const LIVE_MIN_INTERVAL_MS = 100;    // at most ~10 frames per second
const LIVE_MAX_FAILURES = 5;         // stop after this many failed requests in a row

let liveStream = null;
let liveRunning = false;
let liveTimer = null;
let liveSessionId = 0;               // bumps on every stop, so late responses are ignored
let liveFailures = 0;
let livePeopleKey = '';
let liveLastFrameAt = 0;
let liveFps = 0;
const liveCaptureCanvas = document.createElement('canvas');

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setLiveStatus(text, isError = false) {
    const el = document.getElementById('liveStatus');
    el.textContent = text;
    el.classList.toggle('error', isError);
}

function cameraErrorMessage(err) {
    switch (err && err.name) {
        case 'NotAllowedError': return 'Camera permission was denied. Allow camera access in your browser (icon in the address bar) and try again.';
        case 'NotFoundError': return 'No camera was found on this device.';
        case 'NotReadableError': return 'The camera is being used by another app (e.g. Zoom/Teams). Close it and try again.';
        case 'OverconstrainedError': return 'The selected camera is not available.';
        default: return 'Could not start camera: ' + (err && err.message ? err.message : err);
    }
}

async function startLiveScan(deviceId) {
    if (liveRunning) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Camera is not available here. Open the app at http://127.0.0.1:5000 — browsers only allow cameras on localhost or HTTPS.', 'error', 8000);
        return;
    }

    const session = ++liveSessionId;
    const startBtn = document.getElementById('liveStartBtn');
    startBtn.disabled = true;
    setLiveStatus('Starting camera…');

    let stream;
    try {
        const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
        stream = await navigator.mediaDevices.getUserMedia({
            video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: 'user', ...size },
            audio: false
        });
    } catch (err) {
        if (session === liveSessionId) {
            showToast(cameraErrorMessage(err), 'error', 7000);
            setLiveStatus('Camera error', true);
            startBtn.disabled = false;
        }
        return;
    }

    // User left the tab or pressed Stop while the permission prompt was open
    if (session !== liveSessionId) {
        stream.getTracks().forEach(t => t.stop());
        return;
    }

    const video = document.getElementById('liveVideo');
    liveStream = stream;
    video.srcObject = stream;
    try { await video.play(); } catch (_) { /* autoplay is allowed for muted video */ }
    if (!video.videoWidth) {
        await new Promise(resolve => video.addEventListener('loadedmetadata', resolve, { once: true }));
    }
    if (session !== liveSessionId) return;

    const overlay = document.getElementById('liveOverlay');
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
    document.getElementById('liveStage').style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;

    document.getElementById('livePlaceholder').style.display = 'none';
    document.getElementById('liveBadge').style.display = '';
    document.getElementById('liveStopBtn').disabled = false;

    const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId;
    populateCameraList(activeId);

    liveRunning = true;
    liveFailures = 0;
    liveLastFrameAt = 0;
    liveFps = 0;
    setLiveStatus('Scanning…');
    liveTick();
}

function stopLiveScan(saveBest = true) {
    // Save this session's best match to the Dashboard/Logs (once)
    if (saveBest && liveBest && !liveBest.saved) saveBestMatch();

    liveRunning = false;
    liveSessionId++;
    clearTimeout(liveTimer);

    if (liveStream) {
        liveStream.getTracks().forEach(t => t.stop());
        liveStream = null;
    }
    const video = document.getElementById('liveVideo');
    video.srcObject = null;

    const overlay = document.getElementById('liveOverlay');
    overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);

    document.getElementById('livePlaceholder').style.display = '';
    document.getElementById('liveBadge').style.display = 'none';
    document.getElementById('liveStartBtn').disabled = false;
    document.getElementById('liveStopBtn').disabled = true;
    document.getElementById('liveFaceCount').textContent = '0 faces';
    document.getElementById('livePeople').innerHTML =
        '<div class="empty-state live-empty"><p>Recognized people will appear here while the camera is running.</p></div>';
    livePeopleKey = '';
    setLiveStatus('Idle');
}

async function populateCameraList(activeId) {
    const select = document.getElementById('liveCameraSelect');
    try {
        const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
        if (cams.length < 2) { select.style.display = 'none'; return; }
        select.innerHTML = cams.map((c, i) =>
            `<option value="${escapeHtml(c.deviceId)}">${escapeHtml(c.label || 'Camera ' + (i + 1))}</option>`).join('');
        if (activeId) select.value = activeId;
        select.style.display = '';
        select.onchange = () => {
            const id = select.value;
            stopLiveScan(false);   // switching camera continues the same session
            startLiveScan(id);
        };
    } catch (_) {
        select.style.display = 'none';
    }
}

async function liveTick() {
    if (!liveRunning) return;
    const session = liveSessionId;
    const started = performance.now();
    const video = document.getElementById('liveVideo');

    if (video.videoWidth) {
        // Downscale the frame to keep uploads small and fast
        const scale = Math.min(1, LIVE_CAPTURE_WIDTH / video.videoWidth);
        const cw = Math.round(video.videoWidth * scale);
        const ch = Math.round(video.videoHeight * scale);
        liveCaptureCanvas.width = cw;
        liveCaptureCanvas.height = ch;
        liveCaptureCanvas.getContext('2d').drawImage(video, 0, 0, cw, ch);
        const frame = liveCaptureCanvas.toDataURL('image/jpeg', 0.7);

        try {
            const res = await fetch('/api/process-frame', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ frame })
            });
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
            if (session !== liveSessionId) return;   // stopped while waiting

            liveFailures = 0;
            const results = data.results || [];
            drawLiveOverlay(results, video.videoWidth / cw);
            renderLivePeople(results);
            updateBestMatch(results, cw, ch);   // liveCaptureCanvas still holds this exact frame

            const now = performance.now();
            if (liveLastFrameAt) {
                const instant = 1000 / (now - liveLastFrameAt);
                liveFps = liveFps ? liveFps * 0.8 + instant * 0.2 : instant;
            }
            liveLastFrameAt = now;
            const n = data.faces_detected || 0;
            setLiveStatus(`${n} face${n !== 1 ? 's' : ''} · ${data.process_time_ms} ms · ${liveFps.toFixed(1)} fps`);
        } catch (err) {
            if (session !== liveSessionId) return;
            liveFailures++;
            setLiveStatus('Server not responding…', true);
            if (liveFailures >= LIVE_MAX_FAILURES) {
                stopLiveScan();
                showToast('Live scan stopped: ' + err.message, 'error', 6000);
                return;
            }
        }
    }

    if (!liveRunning || session !== liveSessionId) return;
    const elapsed = performance.now() - started;
    liveTimer = setTimeout(liveTick, Math.max(0, LIVE_MIN_INTERVAL_MS - elapsed));
}

function drawLiveOverlay(results, scale) {
    const canvas = document.getElementById('liveOverlay');
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    ctx.clearRect(0, 0, W, canvas.height);

    const lineWidth = Math.max(2, W / 320);
    const fontSize = Math.max(14, Math.round(W / 42));
    ctx.font = `600 ${fontSize}px Inter, sans-serif`;
    ctx.textBaseline = 'middle';

    for (const r of results) {
        const [bx, by, bw, bh] = r.bbox.map(v => v * scale);
        const x = W - (bx + bw);   // mirror to match the mirrored video
        const top = r.matches && r.matches[0];
        const color = top ? '#00d2a0' : '#ff5252';
        const label = top ? `${top.name}  ${(top.similarity * 100).toFixed(0)}%` : 'Unknown';

        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.strokeRect(x, by, bw, bh);

        const padX = fontSize * 0.5;
        const labelH = fontSize * 1.6;
        const labelW = ctx.measureText(label).width + padX * 2;
        const labelY = by - labelH >= 0 ? by - labelH : by;   // keep the label on screen
        ctx.fillStyle = color;
        ctx.fillRect(x - lineWidth / 2, labelY, labelW, labelH);
        ctx.fillStyle = top ? '#0a0a0f' : '#ffffff';
        ctx.fillText(label, x - lineWidth / 2 + padX, labelY + labelH / 2);
    }
}

function renderLivePeople(results) {
    const n = results.length;
    document.getElementById('liveFaceCount').textContent = `${n} face${n !== 1 ? 's' : ''}`;

    // One row per recognized identity (best score), plus unknown faces
    const best = new Map();
    let unknown = 0;
    for (const r of results) {
        const top = r.matches && r.matches[0];
        if (!top) { unknown++; continue; }
        const prev = best.get(top.identity_id);
        if (!prev || top.similarity > prev.similarity) best.set(top.identity_id, top);
    }
    const people = [...best.values()].sort((a, b) => b.similarity - a.similarity);

    // Only re-render when something visible changed (avoids photo flicker)
    const key = people.map(p => `${p.identity_id}:${Math.round(p.similarity * 100)}`).join('|') + `|u${unknown}`;
    if (key === livePeopleKey) return;
    livePeopleKey = key;

    const container = document.getElementById('livePeople');
    if (n === 0) {
        container.innerHTML = '<div class="empty-state live-empty"><p>No faces in view.</p></div>';
        return;
    }

    let html = people.map(p => `
        <div class="live-person">
            ${p.photo_path
                ? `<img src="${escapeHtml(p.photo_path)}" class="live-person-photo" alt="${escapeHtml(p.name)}">`
                : '<div class="live-person-photo">👤</div>'}
            <div class="live-person-info">
                <div class="live-person-name">${escapeHtml(p.name)}</div>
                ${p.alias ? `<div class="live-person-alias">aka "${escapeHtml(p.alias)}"</div>` : ''}
            </div>
            <div class="live-person-score">${(p.similarity * 100).toFixed(0)}%</div>
        </div>`).join('');

    if (unknown > 0) {
        html += `
        <div class="live-person unknown">
            <div class="live-person-photo">?</div>
            <div class="live-person-info">
                <div class="live-person-name">Unknown</div>
                <div class="live-person-alias">Not in the identity database</div>
            </div>
            <div class="live-person-score">×${unknown}</div>
        </div>`;
    }
    container.innerHTML = html;
}

// ── Best Match snapshot ───────────────────────────────────────
// Keeps the frame with the highest match % seen during the scan session.

let liveBest = null;   // { match, faceIndex, image (data URL), time (Date) }

function updateBestMatch(results, cw, ch) {
    // Find this frame's single highest-scoring match
    let top = null, topFace = -1;
    results.forEach((r, i) => {
        const m = r.matches && r.matches[0];
        if (m && (!top || m.similarity > top.similarity)) { top = m; topFace = i; }
    });
    if (!top || (liveBest && top.similarity <= liveBest.match.similarity)) return;

    const time = new Date();
    liveBest = {
        match: top,
        image: buildSnapshot(results, topFace, top, time, cw, ch),
        time,
        facesDetected: results.length,
        saved: false
    };
    renderBestMatch();
}

async function saveBestMatch() {
    const best = liveBest;
    if (!best || best.saved) return;
    best.saved = true;   // mark first so a double Stop can't save twice
    try {
        const res = await fetch('/api/live-snapshot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: best.image,
                identity_id: best.match.identity_id,
                similarity: best.match.similarity,
                faces_detected: best.facesDetected
            })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
        showToast(data.message, 'success');
        loadDashboard();
    } catch (err) {
        best.saved = false;
        showToast('Could not save best match: ' + err.message, 'error', 6000);
    }
}

function buildSnapshot(results, bestIndex, best, time, cw, ch) {
    const bannerH = Math.max(40, Math.round(ch * 0.09));
    const snap = document.createElement('canvas');
    snap.width = cw;
    snap.height = ch + bannerH;
    const ctx = snap.getContext('2d');

    // Frame, mirrored to match what was shown on screen
    ctx.save();
    ctx.translate(cw, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(liveCaptureCanvas, 0, 0, cw, ch);
    ctx.restore();

    // Face boxes (best face thicker)
    const fontSize = Math.max(13, Math.round(cw / 40));
    ctx.font = `600 ${fontSize}px Inter, sans-serif`;
    ctx.textBaseline = 'middle';
    results.forEach((r, i) => {
        const [bx, by, bw, bh] = r.bbox;
        const x = cw - (bx + bw);
        const m = r.matches && r.matches[0];
        const color = m ? '#00d2a0' : '#ff5252';
        ctx.strokeStyle = color;
        ctx.lineWidth = i === bestIndex ? 4 : 2;
        ctx.strokeRect(x, by, bw, bh);

        const label = m ? `${m.name}  ${(m.similarity * 100).toFixed(1)}%` : 'Unknown';
        const labelH = fontSize * 1.6;
        const labelW = ctx.measureText(label).width + fontSize;
        const labelY = by - labelH >= 0 ? by - labelH : by;
        ctx.fillStyle = color;
        ctx.fillRect(x, labelY, labelW, labelH);
        ctx.fillStyle = m ? '#0a0a0f' : '#ffffff';
        ctx.fillText(label, x + fontSize / 2, labelY + labelH / 2);
    });

    // Bottom banner: best match + percentage + time
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, ch, cw, bannerH);
    const bannerFont = Math.round(bannerH * 0.42);
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${bannerFont}px Inter, sans-serif`;
    ctx.fillStyle = '#00d2a0';
    ctx.textAlign = 'left';
    ctx.fillText(`BEST MATCH: ${best.name} — ${(best.similarity * 100).toFixed(1)}%`, bannerH * 0.3, ch + bannerH / 2);
    ctx.font = `500 ${Math.round(bannerFont * 0.8)}px "JetBrains Mono", monospace`;
    ctx.fillStyle = '#8888a0';
    ctx.textAlign = 'right';
    ctx.fillText(formatSnapshotTime(time), cw - bannerH * 0.3, ch + bannerH / 2);
    ctx.textAlign = 'left';

    return snap.toDataURL('image/jpeg', 0.92);
}

function formatSnapshotTime(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function renderBestMatch() {
    const has = !!liveBest;
    document.getElementById('bestMatchEmpty').style.display = has ? 'none' : '';
    document.getElementById('bestMatchResult').style.display = has ? '' : 'none';
    document.getElementById('bestMatchBadge').style.display = has ? '' : 'none';
    if (!has) return;

    const m = liveBest.match;
    const pctEl = document.getElementById('bestMatchPct');
    document.getElementById('bestMatchImg').src = liveBest.image;
    document.getElementById('bestMatchName').textContent = m.name;
    document.getElementById('bestMatchAlias').textContent = m.alias ? `aka "${m.alias}"` : '';
    document.getElementById('bestMatchTime').textContent = 'Captured ' + formatSnapshotTime(liveBest.time);
    pctEl.textContent = (m.similarity * 100).toFixed(1) + '%';
    pctEl.className = 'best-match-pct' + (m.similarity >= 0.55 ? '' : m.similarity >= 0.40 ? ' medium' : ' low');
}

function resetBestMatch() {
    liveBest = null;
    renderBestMatch();
}

function downloadBestMatch() {
    if (!liveBest) return;
    const t = formatSnapshotTime(liveBest.time).replace(/[-: ]/g, '');
    const name = liveBest.match.name.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'match';
    const pct = Math.round(liveBest.match.similarity * 100);
    const a = document.createElement('a');
    a.href = liveBest.image;
    a.download = `best-match_${name}_${pct}pct_${t}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

// ══════════════════════════════════════════════════════════════
//  SCAN DETAILS (View link → modal)
// ══════════════════════════════════════════════════════════════

function scanTypeBadge(type) {
    return type === 'live'
        ? '<span class="scan-type live">LIVE</span>'
        : '<span class="scan-type">UPLOAD</span>';
}

function viewLink(logId) {
    return `<a href="#" class="view-link" onclick="openScanDetails(${Number(logId)}); return false;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        View</a>`;
}

function closeScanDetails() {
    document.getElementById('scanModal').classList.remove('active');
}

async function openScanDetails(logId) {
    const modal = document.getElementById('scanModal');
    const body = document.getElementById('scanModalBody');
    document.getElementById('scanModalTitle').textContent = `Scan #${logId}`;
    body.innerHTML = '<div class="empty-state"><div class="spinner" style="margin:0 auto"></div></div>';
    modal.classList.add('active');

    try {
        const res = await fetch(`/api/logs/${logId}`);
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
        body.innerHTML = renderScanDetails(data);
    } catch (err) {
        body.innerHTML = `<div class="empty-state"><h3>Could not load scan</h3><p>${escapeHtml(err.message)}</p></div>`;
    }
}

function renderScanDetails(scan) {
    const image = scan.annotated_image || scan.uploaded_image;
    const isLive = scan.scan_type === 'live';

    let html = image
        ? `<img src="${escapeHtml(image)}" class="scan-image" alt="Scan image"
               onerror="this.replaceWith(Object.assign(document.createElement('p'), {textContent: 'Image file is no longer available.', style: 'color:var(--text-muted);margin-bottom:16px'}))">`
        : '';

    html += `<div class="scan-meta">
        <div><span>Scanned at</span><strong class="mono">${escapeHtml(scan.created_at)}</strong></div>
        <div><span>Type</span><strong>${isLive ? 'Live webcam' : 'Image upload'}</strong></div>
        <div><span>Faces</span><strong>${Number(scan.faces_detected)}</strong></div>
        <div><span>Matches</span><strong>${Number(scan.matches_found)}</strong></div>
    </div>`;

    const faces = scan.faces || [];
    html += `<h3 class="scan-section-title">${isLive ? 'Best match' : 'Faces'}</h3>`;

    if (faces.length === 0) {
        html += `<p style="color:var(--text-muted)">${scan.faces_detected > 0
            ? 'No per-face details were recorded for this scan.'
            : 'No faces were detected in this scan.'}</p>`;
        return html;
    }

    for (const f of faces) {
        const id = f.identity;
        const sim = typeof f.similarity === 'number' ? f.similarity : null;
        const pctClass = sim === null ? '' : sim >= 0.55 ? '' : sim >= 0.40 ? ' medium' : ' low';
        const pct = sim === null ? '—' : (sim * 100).toFixed(1) + '%';

        if (!f.matched_name) {
            html += `<div class="scan-face nomatch">
                <div class="scan-face-photo">?</div>
                <div class="scan-face-info">
                    <div class="scan-face-name">Face #${Number(f.face_index)} — No match</div>
                    <p style="font-size:0.82rem;color:var(--text-muted);margin-top:4px">This face is not in the identity database.</p>
                </div>
                <div class="scan-face-pct">—</div>
            </div>`;
            continue;
        }

        const photo = id && id.photo_path
            ? `<img src="${escapeHtml(id.photo_path)}" class="scan-face-photo" alt="${escapeHtml(id.name)}">`
            : '<div class="scan-face-photo">👤</div>';

        const fields = id ? `
            <dt>Code / Alias</dt><dd>${id.alias ? escapeHtml(id.alias) : '—'}</dd>
            <dt>Description</dt><dd>${id.description ? escapeHtml(id.description) : '—'}</dd>
            <dt>Identity ID</dt><dd class="mono">#${Number(id.id)}</dd>
            <dt>Added on</dt><dd class="mono">${escapeHtml(id.created_at)}</dd>
            <dt>Face</dt><dd>#${Number(f.face_index)} in this scan</dd>`
            : `<dt>Note</dt><dd>This identity has since been deleted.</dd>`;

        html += `<div class="scan-face">
            ${photo}
            <div class="scan-face-info">
                <div class="scan-face-name">${escapeHtml(id ? id.name : f.matched_name)}</div>
                <dl class="scan-face-fields">${fields}</dl>
            </div>
            <div class="scan-face-pct${pctClass}">${pct}</div>
        </div>`;
    }
    return html;
}

// ══════════════════════════════════════════════════════════════
//  LOGS
// ══════════════════════════════════════════════════════════════

async function loadLogs() {
    try {
        const res = await fetch('/api/logs');
        const data = await res.json();
        const logs = data.logs || [];
        const container = document.getElementById('logsTable');

        if (logs.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                    <h3>No Recognition Logs</h3>
                    <p>Run a face recognition scan to see activity here.</p>
                    <button class="btn btn-primary" onclick="switchTab('recognize')" style="margin-top:var(--space-lg)">Start Scanning</button>
                </div>`;
            return;
        }

        let html = `<div class="card-header"><h2 class="card-title">Scan History</h2>
            <span class="results-badge badge-faces">${logs.length} record${logs.length !== 1 ? 's' : ''}</span></div>
            <div class="table-container"><table class="data-table">
            <thead><tr><th>#</th><th>Timestamp</th><th>Type</th><th>Faces</th><th>Matches</th><th>Status</th><th>Details</th></tr></thead><tbody>`;

        for (const log of logs) {
            let status;
            if (log.matches_found > 0) status = '<span style="color:var(--success);font-weight:600">● MATCH</span>';
            else if (log.faces_detected > 0) status = '<span style="color:var(--warning);font-weight:600">○ NO MATCH</span>';
            else status = '<span style="color:var(--text-muted)">— NO FACE</span>';

            html += `<tr>
                <td class="mono">${log.id}</td>
                <td class="mono">${log.created_at}</td>
                <td>${scanTypeBadge(log.scan_type)}</td>
                <td><span class="results-badge badge-faces">${log.faces_detected}</span></td>
                <td><span class="results-badge badge-matches">${log.matches_found}</span></td>
                <td>${status}</td>
                <td>${viewLink(log.id)}</td>
            </tr>`;
        }
        html += '</tbody></table></div>';
        container.innerHTML = html;
    } catch (e) {
        console.error('Load logs error:', e);
    }
}

// ══════════════════════════════════════════════════════════════
//  NAVBAR SCROLL EFFECT
// ══════════════════════════════════════════════════════════════

window.addEventListener('scroll', () => {
    const navbar = document.getElementById('navbar');
    if (!navbar) return;
    navbar.style.boxShadow = window.pageYOffset > 50 ? '0 4px 20px rgba(0,0,0,0.3)' : 'none';
});

// ══════════════════════════════════════════════════════════════
//  FADE-IN ANIMATION OBSERVER
// ══════════════════════════════════════════════════════════════

if (typeof IntersectionObserver !== 'undefined') {
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, { threshold: 0.1 });

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('.fade-in-up').forEach(el => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(20px)';
            el.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
            observer.observe(el);
        });
    });
}
