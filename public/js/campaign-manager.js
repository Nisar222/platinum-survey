/**
 * Campaign Manager Frontend
 * Handles campaign upload, display, funnel charts, and real-time progress updates
 */

document.addEventListener('DOMContentLoaded', () => {
  console.log('📦 Campaign Manager initialized');
  initializeCampaignManager();
});

function initializeCampaignManager() {
  const batchUploadForm = document.getElementById('batchUploadForm');
  const excelFileInput = document.getElementById('excelFile');
  const fileNameDisplay = document.getElementById('fileName');
  const uploadBatchBtn = document.getElementById('uploadBatchBtn');
  const uploadBtnText = document.getElementById('uploadBtnText');
  const uploadBtnLoader = document.getElementById('uploadBtnLoader');
  const uploadStatus = document.getElementById('uploadStatus');
  const batchList = document.getElementById('batchList');
  const refreshBtn = document.getElementById('refreshCampaignsBtn');

  // Track chart instances to destroy before re-render
  const chartInstances = {};

  // File input change handler
  excelFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    fileNameDisplay.textContent = file ? `Selected: ${file.name}` : '';
  });

  // Form submit handler
  batchUploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await uploadCampaign();
  });

  // Refresh button
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadCampaigns();
      updateDashboardStatistics();
    });
  }

  // Callback queue button
  const callbackQueueBtn = document.getElementById('callbackQueueBtn');
  const callbackQueuePanel = document.getElementById('callbackQueuePanel');
  const closeCallbackQueueBtn = document.getElementById('closeCallbackQueueBtn');
  const processRetriesNowBtn = document.getElementById('processRetriesNowBtn');

  if (callbackQueueBtn) {
    callbackQueueBtn.addEventListener('click', () => {
      callbackQueuePanel.classList.toggle('hidden');
      if (!callbackQueuePanel.classList.contains('hidden')) {
        loadCallbackQueue();
        callbackQueuePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  if (closeCallbackQueueBtn) {
    closeCallbackQueueBtn.addEventListener('click', () => {
      callbackQueuePanel.classList.add('hidden');
    });
  }

  if (processRetriesNowBtn) {
    processRetriesNowBtn.addEventListener('click', async () => {
      processRetriesNowBtn.disabled = true;
      processRetriesNowBtn.textContent = 'Processing...';
      try {
        await fetch('/api/campaigns/callbacks/process-now', { method: 'POST' });
        setTimeout(() => { loadCallbackQueue(); loadCampaigns(); updateDashboardStatistics(); }, 1500);
      } catch (error) {
        console.error('Error triggering retry processing:', error);
      } finally {
        processRetriesNowBtn.disabled = false;
        processRetriesNowBtn.innerHTML = `<svg class="w-3.5 h-3.5 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/></svg>Process Now`;
      }
    });
  }

  // Upload campaign
  async function uploadCampaign() {
    const campaignName = document.getElementById('batchName').value.trim();
    const file = excelFileInput.files[0];

    if (!file) {
      showUploadStatus('error', 'Please select an Excel file');
      return;
    }

    uploadBatchBtn.disabled = true;
    uploadBtnText.classList.add('hidden');
    uploadBtnLoader.classList.remove('hidden');

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (campaignName) formData.append('batchName', campaignName);
      const scheduleId = document.getElementById('campaignScheduleId')?.value;
      if (scheduleId) formData.append('scheduleId', scheduleId);

      const response = await fetch('/api/campaigns/upload', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (response.ok && result.success) {
        const name = result.campaign?.name || result.batch?.name;
        const total = result.campaign?.total_contacts || result.batch?.total_contacts;
        showUploadStatus('success', `Campaign "${name}" created with ${total} contacts!`);

        if (result.validation?.errors?.length > 0) {
          const warn = document.createElement('div');
          warn.className = 'mt-2 text-xs text-yellow-700';
          warn.innerHTML = `<strong>⚠️ ${result.validation.invalid} rows skipped:</strong> ${result.validation.errors.slice(0, 3).map(e => `Row ${e.row}: ${e.error}`).join(', ')}${result.validation.errors.length > 3 ? '...' : ''}`;
          uploadStatus.appendChild(warn);
        }

        batchUploadForm.reset();
        fileNameDisplay.textContent = '';
        setTimeout(() => { loadCampaigns(); updateDashboardStatistics(); }, 800);
      } else {
        showUploadStatus('error', result.error || 'Upload failed');
        if (result.validation?.errors) {
          const errList = document.createElement('div');
          errList.className = 'mt-2 text-xs text-red-700';
          errList.innerHTML = `<strong>Validation errors:</strong><br>${result.validation.errors.slice(0, 5).map(e => `• Row ${e.row}: ${e.error}`).join('<br>')}${result.validation.errors.length > 5 ? '<br>...and more' : ''}`;
          uploadStatus.appendChild(errList);
        }
      }
    } catch (error) {
      showUploadStatus('error', `Upload failed: ${error.message}`);
    } finally {
      uploadBatchBtn.disabled = false;
      uploadBtnText.classList.remove('hidden');
      uploadBtnLoader.classList.add('hidden');
    }
  }

  function showUploadStatus(type, message) {
    uploadStatus.classList.remove('hidden');
    const isSuccess = type === 'success';
    uploadStatus.innerHTML = `
      <div class="p-3 ${isSuccess ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500'} rounded-xl border-l-4">
        <div class="flex items-start gap-2">
          <div class="${isSuccess ? 'text-green-600' : 'text-red-600'} text-sm font-medium">${message}</div>
        </div>
      </div>
    `;
    if (isSuccess) setTimeout(() => uploadStatus.classList.add('hidden'), 5000);
  }

  // Active filter state
  let currentFilter = 'all';
  let campaignsExpanded = false;
  const CAMPAIGNS_PREVIEW_COUNT = 3;

  // Filter tab click handlers
  document.querySelectorAll('.campaign-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.campaign-filter-btn').forEach(b => {
        b.classList.remove('active', 'bg-white', 'text-gray-800', 'shadow-sm');
        b.classList.add('text-gray-500');
      });
      btn.classList.add('active', 'bg-white', 'text-gray-800', 'shadow-sm');
      btn.classList.remove('text-gray-500');
      currentFilter = btn.dataset.filter;
      campaignsExpanded = false;
      loadCampaigns();
    });
  });

  // Show more / collapse button
  const showMoreRow = document.getElementById('campaignShowMoreRow');
  const showMoreBtn = document.getElementById('campaignShowMoreBtn');
  if (showMoreBtn) {
    showMoreBtn.addEventListener('click', () => {
      campaignsExpanded = !campaignsExpanded;
      loadCampaigns();
    });
  }

  // Load campaigns from API
  async function loadCampaigns() {
    try {
      const response = await fetch(`/api/campaigns?filter=${currentFilter}`);
      const data = await response.json();
      const campaigns = data.campaigns || data.batches || [];

      if (campaigns.length > 0) {
        displayCampaigns(campaigns);
      } else {
        Object.values(chartInstances).forEach(chart => chart.destroy());
        Object.keys(chartInstances).forEach(k => delete chartInstances[k]);
        batchList.innerHTML = `
          <div class="text-center py-10 text-gray-400">
            <svg class="w-12 h-12 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            <p class="text-sm">No campaigns found.</p>
          </div>
        `;
        if (showMoreRow) showMoreRow.classList.add('hidden');
      }
    } catch (error) {
      console.error('Error loading campaigns:', error);
      batchList.innerHTML = `<div class="text-center py-8 text-red-400"><p class="text-sm">Error loading campaigns. Please try again.</p></div>`;
    }
  }

  function displayCampaigns(campaigns) {
    Object.values(chartInstances).forEach(chart => chart.destroy());
    Object.keys(chartInstances).forEach(k => delete chartInstances[k]);

    const visible = campaignsExpanded ? campaigns : campaigns.slice(0, CAMPAIGNS_PREVIEW_COUNT);
    const hidden = campaigns.length - CAMPAIGNS_PREVIEW_COUNT;

    batchList.innerHTML = '';
    visible.forEach(campaign => {
      const card = createCampaignCard(campaign);
      batchList.appendChild(card);
    });

    // Show/hide the expand button
    if (showMoreRow) {
      if (campaigns.length > CAMPAIGNS_PREVIEW_COUNT) {
        showMoreRow.classList.remove('hidden');
        showMoreBtn.textContent = campaignsExpanded
          ? '▲ Show less'
          : `▼ Show ${hidden} more campaign${hidden !== 1 ? 's' : ''}`;
      } else {
        showMoreRow.classList.add('hidden');
      }
    }

    visible.forEach(campaign => renderFunnelChart(campaign));
  }

  function createCampaignCard(campaign) {
    const card = document.createElement('div');
    card.className = 'bg-white border border-gray-200 rounded-2xl p-5 hover:shadow-md transition-all';
    card.dataset.batchId = campaign.id;

    const statusBadge = getStatusBadge(campaign.status);
    const progressPercent = campaign.total_contacts > 0
      ? Math.round((campaign.completed_contacts / campaign.total_contacts) * 100)
      : 0;

    const attempted = campaign.attempted || 0;
    const connected = campaign.connected || 0;
    const completed = campaign.completed || campaign.successful_calls || 0;

    card.innerHTML = `
      <div class="flex justify-between items-start mb-3">
        <div class="flex-1 min-w-0 mr-3">
          <h3 class="text-base font-bold text-gray-900 truncate">${campaign.name}</h3>
          <p class="text-xs text-gray-400 mt-0.5">${new Date(campaign.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
        </div>
        ${statusBadge}
      </div>

      <!-- Funnel visualization -->
      <div class="mb-3">
        <div class="flex justify-between text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
          <span>Attempted</span>
          <span>Connected</span>
          <span>Completed</span>
        </div>
        <div style="height: 48px; position: relative;">
          <canvas id="funnel-${campaign.id}"></canvas>
        </div>
        <div class="flex justify-between text-sm font-bold mt-1">
          <span class="text-blue-600">${attempted}</span>
          <span class="text-green-600">${connected}</span>
          <span class="text-purple-600">${completed}</span>
        </div>
      </div>

      <!-- Call Outcomes -->
      <div class="flex justify-between mb-3 px-1">
        <div class="text-center">
          <div class="text-sm font-bold text-green-600">${campaign.display_completed || 0}</div>
          <div class="text-[10px] text-gray-400 uppercase tracking-wide">Completed</div>
        </div>
        <div class="text-center">
          <div class="text-sm font-bold text-yellow-600">${campaign.display_rescheduled || 0}</div>
          <div class="text-[10px] text-gray-400 uppercase tracking-wide">Rescheduled</div>
        </div>
        <div class="text-center">
          <div class="text-sm font-bold text-red-600">${campaign.display_failed || 0}</div>
          <div class="text-[10px] text-gray-400 uppercase tracking-wide">Failed</div>
        </div>
      </div>

      <!-- Progress bar -->
      <div class="mb-3">
        <div class="flex justify-between text-xs text-gray-500 mb-1">
          <span>Progress</span>
          <span>${progressPercent}%</span>
        </div>
        <div class="w-full bg-gray-100 rounded-full h-1.5">
          <div class="bg-gradient-to-r from-blue-500 to-indigo-500 h-1.5 rounded-full transition-all duration-500" style="width: ${progressPercent}%"></div>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex gap-2">
        ${getCampaignActions(campaign)}
      </div>
    `;

    addCampaignActionListeners(card, campaign);
    return card;
  }

  function renderFunnelChart(campaign) {
    const canvas = document.getElementById(`funnel-${campaign.id}`);
    if (!canvas) return;

    // Destroy existing chart
    if (chartInstances[campaign.id]) {
      chartInstances[campaign.id].destroy();
    }

    const attempted = campaign.attempted || 0;
    const connected = campaign.connected || 0;
    const completed = campaign.completed || campaign.successful_calls || 0;
    const maxVal = Math.max(attempted, 1);

    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ['Attempted', 'Connected', 'Completed'],
        datasets: [{
          data: [attempted, connected, completed],
          backgroundColor: [
            'rgba(59, 130, 246, 0.75)',
            'rgba(34, 197, 94, 0.75)',
            'rgba(168, 85, 247, 0.75)'
          ],
          borderRadius: 4,
          borderWidth: 0,
          barThickness: 14
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false, beginAtZero: true, max: maxVal },
          y: { display: false }
        },
        animation: { duration: 400 }
      }
    });

    chartInstances[campaign.id] = chart;
  }

  function getStatusBadge(status) {
    const badges = {
      pending:   '<span class="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-semibold rounded-full whitespace-nowrap">Pending</span>',
      running:   '<span class="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full animate-pulse whitespace-nowrap">● Running</span>',
      paused:    '<span class="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs font-semibold rounded-full whitespace-nowrap">⏸ Paused</span>',
      completed: '<span class="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-semibold rounded-full whitespace-nowrap">✓ Completed</span>',
      cancelled: '<span class="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-semibold rounded-full whitespace-nowrap">✕ Cancelled</span>',
      archived:  '<span class="px-2 py-0.5 bg-gray-200 text-gray-500 text-xs font-semibold rounded-full whitespace-nowrap">📦 Archived</span>'
    };
    return badges[status] || badges.pending;
  }

  /**
   * Map internal contact/call status to customer-facing display status
   */
  function getDisplayStatus(status) {
    switch (status) {
      case 'completed': return 'Completed';
      case 'no_answer':
      case 'callback_requested':
      case 'calling':
      case 'pending': return 'Rescheduled';
      case 'max_attempts':
      case 'failed': return 'Failed';
      default: return status || '—';
    }
  }

  function getDisplayStatusBadge(status) {
    const display = getDisplayStatus(status);
    const styles = {
      'Completed': 'bg-green-100 text-green-700',
      'Rescheduled': 'bg-yellow-100 text-yellow-700',
      'Failed': 'bg-red-100 text-red-700'
    };
    const cls = styles[display] || 'bg-gray-100 text-gray-600';
    return `<span class="px-1.5 py-0.5 rounded text-xs font-medium ${cls}">${display}</span>`;
  }

  function getCampaignActions(campaign) {
    switch (campaign.status) {
      case 'pending':
        return '<button class="action-start flex-1 px-3 py-2 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold rounded-lg transition-all">▶ Start</button>';
      case 'running':
        return `
          <button class="action-pause flex-1 px-3 py-2 bg-yellow-500 hover:bg-yellow-600 text-white text-xs font-semibold rounded-lg transition-all">⏸ Pause</button>
          <button class="action-view-queue px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold rounded-lg transition-all">👁 Queue</button>
        `;
      case 'paused':
        return `
          <button class="action-resume flex-1 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold rounded-lg transition-all">▶ Resume</button>
          <button class="action-cancel px-3 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold rounded-lg transition-all">✕ End</button>
        `;
      case 'archived':
        return `
          <button class="action-export flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            Export
          </button>
          <button class="action-unarchive px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-semibold rounded-lg transition-all">Restore</button>
          <button class="action-delete px-3 py-2 bg-red-100 hover:bg-red-200 text-red-600 text-xs font-semibold rounded-lg transition-all" title="Permanently delete this campaign">🗑</button>
        `;
      case 'completed':
      case 'cancelled':
        return `
          <button class="action-export flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            Export
          </button>
          <button class="action-archive px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-600 text-xs font-semibold rounded-lg transition-all" title="Archive this campaign">📦</button>
          <button class="action-delete px-3 py-2 bg-red-100 hover:bg-red-200 text-red-600 text-xs font-semibold rounded-lg transition-all" title="Permanently delete this campaign">🗑</button>
        `;
      default:
        return '';
    }
  }

  function addCampaignActionListeners(card, campaign) {
    const startBtn = card.querySelector('.action-start');
    const pauseBtn = card.querySelector('.action-pause');
    const resumeBtn = card.querySelector('.action-resume');
    const cancelBtn = card.querySelector('.action-cancel');
    const viewQueueBtn = card.querySelector('.action-view-queue');
    const exportBtn = card.querySelector('.action-export');
    const archiveBtn = card.querySelector('.action-archive');
    const unarchiveBtn = card.querySelector('.action-unarchive');
    const deleteBtn = card.querySelector('.action-delete');

    if (startBtn) startBtn.addEventListener('click', () => campaignAction(campaign.id, 'start'));
    if (pauseBtn) pauseBtn.addEventListener('click', () => campaignAction(campaign.id, 'pause'));
    if (resumeBtn) resumeBtn.addEventListener('click', () => campaignAction(campaign.id, 'resume'));
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      if (confirm(`End campaign "${campaign.name}"?`)) campaignAction(campaign.id, 'cancel');
    });
    if (viewQueueBtn) viewQueueBtn.addEventListener('click', () => showQueueProgress(campaign.id));
    if (exportBtn) exportBtn.addEventListener('click', () => {
      window.open(`/api/campaigns/${campaign.id}/export`, '_blank');
    });
    if (archiveBtn) archiveBtn.addEventListener('click', () => {
      campaignAction(campaign.id, 'archive');
    });
    if (unarchiveBtn) unarchiveBtn.addEventListener('click', () => {
      campaignAction(campaign.id, 'unarchive');
    });
    if (deleteBtn) deleteBtn.addEventListener('click', () => {
      if (confirm(`Permanently delete campaign "${campaign.name}" and all its data?\n\nThis cannot be undone.`)) {
        deleteCampaign(campaign.id);
      }
    });
  }

  async function deleteCampaign(campaignId) {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, { method: 'DELETE' });
      const result = await response.json();
      if (response.ok && result.success) {
        setTimeout(() => { loadCampaigns(); updateDashboardStatistics(); }, 300);
      } else {
        alert(`Failed to delete campaign: ${result.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  }

  async function campaignAction(campaignId, action) {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/${action}`, { method: 'POST' });
      const result = await response.json();

      if (response.ok && result.success) {
        setTimeout(() => { loadCampaigns(); updateDashboardStatistics(); }, 500);
      } else {
        alert(`Failed to ${action} campaign: ${result.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  }

  // Dashboard statistics
  async function updateDashboardStatistics() {
    try {
      const [campaignsRes, queueRes] = await Promise.all([
        fetch('/api/campaigns'),
        fetch('/api/queue/status')
      ]);

      const campaignData = await campaignsRes.json();
      const queueData = await queueRes.json();

      const campaigns = campaignData.campaigns || campaignData.batches || [];

      let totalAttempted = 0, totalConnected = 0, totalCompleted = 0;
      let activeCampaigns = 0, pausedCampaigns = 0, endedCampaigns = 0;

      campaigns.forEach(c => {
        totalAttempted += c.attempted || 0;
        totalConnected += c.connected || 0;
        totalCompleted += c.completed || c.successful_calls || 0;

        if (c.status === 'running') activeCampaigns++;
        else if (c.status === 'paused') pausedCampaigns++;
        else if (c.status === 'completed' || c.status === 'cancelled') endedCampaigns++;
      });

      const currentlyCallingCount = queueData.currentlyCalling?.length || 0;
      const connectionRate = totalAttempted > 0 ? ((totalConnected / totalAttempted) * 100).toFixed(1) : '0.0';
      const completionRate = totalAttempted > 0 ? ((totalCompleted / totalAttempted) * 100).toFixed(1) : '0.0';

      document.getElementById('totalAttempted').textContent = totalAttempted;
      document.getElementById('currentlyConnected').textContent = currentlyCallingCount;
      document.getElementById('connectionRate').textContent = `${connectionRate}%`;
      document.getElementById('completedCalls').textContent = totalCompleted;
      document.getElementById('completionRate').textContent = `${completionRate}%`;
      document.getElementById('activeCampaigns').textContent = activeCampaigns;
      document.getElementById('pausedCampaigns').textContent = pausedCampaigns;
      document.getElementById('endedCampaigns').textContent = endedCampaigns;

    } catch (error) {
      console.error('Error updating dashboard statistics:', error);
    }
  }

  // ============================================================================
  // CALLBACK QUEUE
  // ============================================================================

  async function loadCallbackQueue() {
    try {
      const [pendingRes, summaryRes] = await Promise.all([
        fetch('/api/campaigns/callbacks/pending'),
        fetch('/api/campaigns/callbacks/summary')
      ]);

      const pendingData = await pendingRes.json();
      const summaryData = await summaryRes.json();

      const callbacks = pendingData.callbacks || [];
      const summary = summaryData.summary || [];

      // Update badge count
      const totalDue = summary.reduce((sum, s) => sum + (s.due_now || 0), 0);
      const badge = document.getElementById('callbackQueueBadge');
      if (badge) {
        badge.textContent = totalDue;
        badge.classList.toggle('hidden', totalDue === 0);
      }

      const list = document.getElementById('callbackQueueList');
      if (!list) return;

      if (callbacks.length === 0) {
        list.innerHTML = `
          <div class="text-center py-8 text-gray-400">
            <svg class="w-10 h-10 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <p class="text-sm">No pending callbacks</p>
          </div>
        `;
        return;
      }

      list.innerHTML = '';
      callbacks.forEach(cb => {
        const card = document.createElement('div');
        const isDue = cb.next_retry_at && new Date(cb.next_retry_at) <= new Date();
        const retryTime = cb.next_retry_at
          ? new Date(cb.next_retry_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
          : 'ASAP';

        card.className = `p-3 rounded-xl border ${isDue ? 'bg-yellow-50 border-yellow-300' : 'bg-gray-50 border-gray-200'}`;
        card.innerHTML = `
          <div class="flex justify-between items-start">
            <div>
              <div class="text-sm font-semibold text-gray-800">${cb.customer_name}</div>
              <div class="text-xs text-gray-500">${cb.phone_number}</div>
              <div class="text-xs text-gray-400 mt-0.5">${cb.campaign_name || ''}</div>
            </div>
            <div class="text-right">
              <div class="text-xs font-semibold ${isDue ? 'text-yellow-700' : 'text-gray-500'}">${isDue ? '⚡ Due Now' : retryTime}</div>
              <div class="text-xs text-gray-400 mt-0.5">Attempt ${cb.attempt_count}/${cb.max_attempts}</div>
              <div class="text-xs mt-0.5 ${cb.status === 'callback_requested' ? 'text-blue-600' : 'text-gray-400'}">${cb.status === 'callback_requested' ? '📞 Callback' : '🔄 No Answer'}</div>
            </div>
          </div>
        `;
        list.appendChild(card);
      });

    } catch (error) {
      console.error('Error loading callback queue:', error);
    }
  }

  // ============================================================================
  // QUEUE MANAGEMENT
  // ============================================================================

  let currentCampaignId = null;
  let durationTimer = null;

  async function showQueueProgress(campaignId) {
    currentCampaignId = campaignId;
    const queueSection = document.getElementById('queueProgressSection');
    queueSection.classList.remove('hidden');
    queueSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    await updateQueuePanel(campaignId);

    if (window.queueRefreshInterval) clearInterval(window.queueRefreshInterval);
    window.queueRefreshInterval = setInterval(() => {
      updateQueuePanel(campaignId);
      updateCallConcurrencyStatus();
    }, 10000);

    updateCallConcurrencyStatus();

    document.getElementById('closeQueueBtn').addEventListener('click', () => {
      queueSection.classList.add('hidden');
      if (window.queueRefreshInterval) clearInterval(window.queueRefreshInterval);
      stopDurationTimer();
    });
  }

  async function updateQueuePanel(campaignId) {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/queue-details`);
      const data = await response.json();

      if (data.currentContact) {
        updateCurrentlyCallingCard(data.currentContact);
      } else {
        clearCurrentlyCallingCard();
      }

      const queueList = document.getElementById('queueList');
      queueList.innerHTML = '';

      if (data.queueDetails?.length > 0) {
        data.queueDetails.forEach(contact => queueList.appendChild(createQueueContactCard(contact)));
      } else {
        queueList.innerHTML = `<div class="text-center py-6 text-gray-400"><p class="text-sm">No contacts in queue</p></div>`;
      }

      // Update call stats from campaign data
      if (data.campaign || data.batch) {
        const campaign = data.campaign || data.batch;
        const successRate = campaign.total_contacts > 0
          ? Math.round((campaign.successful_calls / campaign.total_contacts) * 100) : 0;
        document.getElementById('successRate').textContent = `${successRate}%`;
        document.getElementById('avgDuration').textContent = `${Math.round((campaign.avg_call_duration_seconds || 0) / 60)}m`;
        document.getElementById('callbacksCount').textContent = campaign.callbacks_pending || 0;
      }
    } catch (error) {
      console.error('Error updating queue panel:', error);
    }
  }

  function createQueueContactCard(contact) {
    const card = document.createElement('div');
    card.className = 'p-3 bg-gray-50 border border-gray-100 rounded-lg';
    const waitMinutes = Math.ceil(contact.estimatedWaitSeconds / 60);
    const startTime = new Date(contact.estimatedStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    card.innerHTML = `
      <div class="flex justify-between items-center">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-gray-400">#${contact.queuePosition}</span>
            <span class="text-sm font-semibold text-gray-800">${contact.customer_name}</span>
          </div>
          <div class="text-xs text-gray-400">${contact.phone_number}</div>
        </div>
        <div class="text-right">
          <div class="text-xs text-gray-500">~${waitMinutes} min</div>
          <div class="text-xs text-gray-400">${startTime}</div>
        </div>
      </div>
      ${contact.attempt_count > 0 ? `<div class="mt-1 text-xs text-yellow-600">Retry ${contact.attempt_count}/${contact.max_attempts}</div>` : ''}
    `;
    return card;
  }

  function updateCurrentlyCallingCard(contact) {
    document.getElementById('currentContactInfo').innerHTML = `
      <div class="font-semibold text-gray-800">${contact.customerName || contact.customer_name}</div>
      <div class="text-xs text-gray-500 mt-0.5">${contact.phoneNumber || contact.phone_number}</div>
      <div class="text-xs text-gray-500 mt-0.5">
        Attempt ${contact.attemptNumber || contact.attempt_count}/${contact.maxAttempts || contact.max_attempts}
        <span id="callDuration" class="ml-1 font-mono text-blue-600"></span>
      </div>
    `;
  }

  function clearCurrentlyCallingCard() {
    document.getElementById('currentContactInfo').innerHTML = 'No active call';
    stopDurationTimer();
  }

  function startDurationTimer(contactId, callStartedAt) {
    stopDurationTimer();
    const startTime = callStartedAt ? new Date(callStartedAt) : new Date();
    durationTimer = setInterval(() => {
      const elapsed = Math.floor((new Date() - startTime) / 1000);
      const el = document.getElementById('callDuration');
      if (el) el.textContent = `• ${formatDuration(elapsed)}`;
    }, 1000);
  }

  function stopDurationTimer() {
    if (durationTimer) { clearInterval(durationTimer); durationTimer = null; }
  }

  function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  async function updateCallConcurrencyStatus() {
    try {
      const response = await fetch('/api/calls/concurrency-status');
      const data = await response.json();

      const statusText = document.getElementById('concurrencyStatusText');
      const barsContainer = document.getElementById('concurrencyBars');

      statusText.textContent = `${data.availableSlots}/${data.maxCalls} available`;
      statusText.className = data.availableSlots > 0
        ? 'text-sm text-green-600 font-semibold'
        : 'text-sm text-red-600 font-semibold';

      barsContainer.innerHTML = '';
      for (let i = 0; i < data.maxCalls; i++) {
        const bar = document.createElement('div');
        bar.className = `flex-1 rounded-full h-2 ${i < data.activeCallCount ? 'bg-red-400' : 'bg-green-400'}`;
        barsContainer.appendChild(bar);
      }
    } catch (error) {
      console.error('Error updating call concurrency status:', error);
    }
  }

  function updateConcurrencyStatus(data) {
    const statusText = document.getElementById('concurrencyStatusText');
    if (statusText) {
      statusText.textContent = `Waiting... (${data.activeCallCount}/${data.maxCalls} active)`;
      statusText.className = 'text-sm text-yellow-600 font-semibold';
    }
  }

  // Real-time progress update for a campaign card
  function updateCampaignProgress(data) {
    const card = document.querySelector(`[data-batch-id="${data.campaignId || data.batchId}"]`);
    if (!card) return;

    const total = data.total || 0;
    const completed = data.completed || 0;
    const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

    const progressBar = card.querySelector('.bg-gradient-to-r.from-blue-500');
    if (progressBar) progressBar.style.width = `${progressPercent}%`;

    const progressTexts = card.querySelectorAll('.flex.justify-between.text-xs.text-gray-500 span');
    if (progressTexts[1]) progressTexts[1].textContent = `${progressPercent}%`;
  }

  // ============================================================================
  // SOCKET.IO REAL-TIME LISTENERS
  // ============================================================================
  if (typeof io !== 'undefined') {
    const socket = io();

    socket.on('campaign-started', (data) => {
      console.log('📦 Campaign started:', data);
      loadCampaigns();
      showQueueProgress(data.campaignId || data.batchId);
    });

    socket.on('batch-started', (data) => {
      // Legacy event name
      loadCampaigns();
      showQueueProgress(data.batchId || data.campaignId);
    });

    socket.on('campaign-progress', (data) => {
      console.log('📊 Campaign progress:', data);
      updateCampaignProgress(data);
      updateDashboardStatistics();
    });

    socket.on('batch-progress', (data) => {
      updateCampaignProgress(data);
      updateDashboardStatistics();
    });

    socket.on('campaign-completed', (data) => {
      console.log('✅ Campaign completed:', data);
      loadCampaigns();
      updateDashboardStatistics();
    });

    socket.on('batch-completed', (data) => {
      loadCampaigns();
      updateDashboardStatistics();
    });

    socket.on('campaign-paused', () => { loadCampaigns(); });
    socket.on('campaign-resumed', () => { loadCampaigns(); });
    socket.on('campaign-cancelled', () => { loadCampaigns(); updateDashboardStatistics(); });
    socket.on('batch-paused', () => { loadCampaigns(); });
    socket.on('batch-resumed', () => { loadCampaigns(); });
    socket.on('batch-cancelled', () => { loadCampaigns(); updateDashboardStatistics(); });

    socket.on('contact-calling', (data) => {
      console.log('📞 Contact calling:', data);
      updateCurrentlyCallingCard(data);
      startDurationTimer(data.contactId, data.callStartedAt);
      updateDashboardStatistics();
    });

    socket.on('contact-completed', (data) => {
      console.log('✅ Contact completed:', data);
      clearCurrentlyCallingCard();
      stopDurationTimer();
      if (currentCampaignId) updateQueuePanel(currentCampaignId);
      updateDashboardStatistics();
    });

    socket.on('concurrency-limit-reached', (data) => {
      console.log('⏳ Concurrency limit reached:', data);
      updateConcurrencyStatus(data);
    });

    socket.on('contact-failed', (data) => {
      console.error(`Contact ${data.contactId} failed: ${data.error}`);
    });
  }

  // ============================================================================
  // SETTINGS
  // ============================================================================

  const settingsToggleBtn = document.getElementById('settingsToggleBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const settingsChevron = document.getElementById('settingsChevron');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const settingsSaveStatus = document.getElementById('settingsSaveStatus');

  if (settingsToggleBtn) {
    settingsToggleBtn.addEventListener('click', () => {
      const isHidden = settingsPanel.classList.contains('hidden');
      settingsPanel.classList.toggle('hidden', !isHidden);
      settingsChevron.style.transform = isHidden ? 'rotate(180deg)' : '';
    });
  }

  async function loadSettings() {
    try {
      const response = await fetch('/api/settings');
      const settings = await response.json();
      const fields = ['phoneNumberId', 'assistantId', 'maxConcurrentCalls', 'maxAttemptsPerContact',
                      'interCallDelaySeconds', 'businessHoursStart', 'businessHoursEnd',
                      'timezone', 'noAnswerRetryDays', 'callbackRetryHours'];
      fields.forEach(key => {
        const el = document.getElementById(`setting_${key}`);
        if (el && settings[key] !== undefined) el.value = settings[key];
      });
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', async () => {
      try {
        const settings = {
          phoneNumberId: document.getElementById('setting_phoneNumberId').value.trim(),
          assistantId: document.getElementById('setting_assistantId').value.trim(),
          maxConcurrentCalls: parseInt(document.getElementById('setting_maxConcurrentCalls').value),
          maxAttemptsPerContact: parseInt(document.getElementById('setting_maxAttemptsPerContact').value),
          interCallDelaySeconds: parseInt(document.getElementById('setting_interCallDelaySeconds').value),
          businessHoursStart: parseInt(document.getElementById('setting_businessHoursStart').value),
          businessHoursEnd: parseInt(document.getElementById('setting_businessHoursEnd').value),
          timezone: document.getElementById('setting_timezone').value,
          noAnswerRetryDays: parseFloat(document.getElementById('setting_noAnswerRetryDays').value),
          callbackRetryHours: parseInt(document.getElementById('setting_callbackRetryHours').value)
        };

        const response = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings)
        });

        if (response.ok) {
          settingsSaveStatus.classList.remove('hidden');
          setTimeout(() => settingsSaveStatus.classList.add('hidden'), 2000);
        }
      } catch (error) {
        console.error('Error saving settings:', error);
      }
    });
  }

  // ============================================================================
  // REPORTS
  // ============================================================================

  const reportFromDate = document.getElementById('reportFromDate');
  const reportToDate = document.getElementById('reportToDate');
  const reportCampaignFilter = document.getElementById('reportCampaignFilter');
  const reportPreviewBtn = document.getElementById('reportPreviewBtn');
  const reportExportBtn = document.getElementById('reportExportBtn');
  const reportPreview = document.getElementById('reportPreview');
  const reportTableBody = document.getElementById('reportTableBody');
  const reportSummary = document.getElementById('reportSummary');

  // Set default date range (last 30 days)
  if (reportFromDate && reportToDate) {
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    reportToDate.value = today.toISOString().split('T')[0];
    reportFromDate.value = thirtyDaysAgo.toISOString().split('T')[0];
  }

  // Populate campaign filter dropdown
  async function loadReportCampaignList() {
    try {
      const response = await fetch('/api/campaigns?filter=all');
      const data = await response.json();
      const campaigns = data.campaigns || [];
      if (!reportCampaignFilter) return;
      // Keep the "All Campaigns" option, add rest
      const existing = reportCampaignFilter.querySelector('option[value=""]');
      reportCampaignFilter.innerHTML = '';
      const allOpt = document.createElement('option');
      allOpt.value = '';
      allOpt.textContent = 'All Campaigns';
      reportCampaignFilter.appendChild(allOpt);
      campaigns.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        reportCampaignFilter.appendChild(opt);
      });
    } catch (e) {
      console.error('Error loading campaigns for report filter:', e);
    }
  }

  async function fetchReportData() {
    const from = reportFromDate?.value;
    const to = reportToDate?.value;
    if (!from || !to) { alert('Please select a date range'); return null; }
    const campaignId = reportCampaignFilter?.value || '';
    const url = `/api/campaigns/reports/calls?from=${from}&to=${to}${campaignId ? `&campaignId=${campaignId}` : ''}`;
    const response = await fetch(url);
    if (!response.ok) { alert('Error fetching report data'); return null; }
    return response.json();
  }

  if (reportPreviewBtn) {
    reportPreviewBtn.addEventListener('click', async () => {
      reportPreviewBtn.disabled = true;
      reportPreviewBtn.textContent = 'Loading...';
      try {
        const data = await fetchReportData();
        if (!data) return;

        reportPreview.classList.remove('hidden');
        reportSummary.textContent = `${data.total} call${data.total !== 1 ? 's' : ''} from ${data.from} to ${data.to}`;
        reportTableBody.innerHTML = '';

        if (data.calls.length === 0) {
          reportTableBody.innerHTML = `<tr><td colspan="6" class="px-3 py-4 text-center text-gray-400">No calls found in this date range</td></tr>`;
          return;
        }

        data.calls.slice(0, 50).forEach(call => {
          const tr = document.createElement('tr');
          tr.className = 'hover:bg-gray-50';
          const dur = call.duration_seconds ? `${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s` : '—';
          const time = call.call_time ? new Date(call.call_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—';
          tr.innerHTML = `
            <td class="px-3 py-2 font-medium text-gray-800">${call.customer_name || '—'}</td>
            <td class="px-3 py-2 text-gray-500">${call.campaign_name || '—'}</td>
            <td class="px-3 py-2">${getDisplayStatusBadge(call.call_status)}</td>
            <td class="px-3 py-2 text-gray-500">${call.rating || '—'}</td>
            <td class="px-3 py-2 text-gray-500">${dur}</td>
            <td class="px-3 py-2 text-gray-400">${time}</td>
          `;
          reportTableBody.appendChild(tr);
        });

        if (data.calls.length > 50) {
          reportSummary.textContent += ` (showing first 50 — export CSV for full list)`;
        }
      } catch (e) {
        console.error('Report preview error:', e);
      } finally {
        reportPreviewBtn.disabled = false;
        reportPreviewBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg> Preview`;
      }
    });
  }

  if (reportExportBtn) {
    reportExportBtn.addEventListener('click', () => {
      const from = reportFromDate?.value;
      const to = reportToDate?.value;
      if (!from || !to) { alert('Please select a date range'); return; }
      const campaignId = reportCampaignFilter?.value || '';
      const url = `/api/campaigns/reports/calls?from=${from}&to=${to}${campaignId ? `&campaignId=${campaignId}` : ''}&format=csv`;
      window.open(url, '_blank');
    });
  }

  // Initial load
  loadCampaigns();
  updateDashboardStatistics();
  loadSettings();
  loadCallbackQueue(); // Update badge count on startup
  loadReportCampaignList();

  // Refresh dashboard stats every 15 seconds
  setInterval(updateDashboardStatistics, 15000);
  // Refresh callback queue badge every 60 seconds
  setInterval(loadCallbackQueue, 60000);

  // ========================================================
  // Weekly Schedules
  // ========================================================

  const DAY_LABELS = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };

  // Toggle day button styling
  document.querySelectorAll('.schedule-day-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const span = cb.nextElementSibling;
      if (cb.checked) {
        span.classList.add('bg-blue-500', 'text-white', 'border-blue-500');
        span.classList.remove('border-gray-200');
      } else {
        span.classList.remove('bg-blue-500', 'text-white', 'border-blue-500');
        span.classList.add('border-gray-200');
      }
    });
  });

  // Toggle new schedule form
  document.getElementById('toggleScheduleFormBtn').addEventListener('click', () => {
    document.getElementById('scheduleForm').classList.toggle('hidden');
  });
  document.getElementById('cancelScheduleBtn').addEventListener('click', () => {
    document.getElementById('scheduleForm').classList.add('hidden');
  });

  // Save schedule
  document.getElementById('saveScheduleBtn').addEventListener('click', async () => {
    const name = document.getElementById('scheduleName').value.trim();
    const days = Array.from(document.querySelectorAll('.schedule-day-check:checked')).map(cb => cb.value);
    const startTime = document.getElementById('scheduleStartTime').value;
    const endTime = document.getElementById('scheduleEndTime').value;

    if (!name) return alert('Please enter a schedule name');
    if (days.length === 0) return alert('Please select at least one day');
    if (!startTime || !endTime) return alert('Please set start and end times');
    if (startTime >= endTime) return alert('Start time must be before end time');

    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, days, startTime, endTime })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      document.getElementById('scheduleForm').classList.add('hidden');
      document.getElementById('scheduleName').value = '';
      document.querySelectorAll('.schedule-day-check').forEach(cb => {
        cb.checked = false;
        cb.nextElementSibling.classList.remove('bg-blue-500', 'text-white', 'border-blue-500');
        cb.nextElementSibling.classList.add('border-gray-200');
      });
      loadSchedules();
    } catch (err) {
      alert('Error creating schedule: ' + err.message);
    }
  });

  // Load and render schedules
  async function loadSchedules() {
    try {
      const res = await fetch('/api/schedules');
      const data = await res.json();
      const list = document.getElementById('scheduleList');
      const dropdown = document.getElementById('campaignScheduleId');

      // Update dropdown
      if (dropdown) {
        const currentVal = dropdown.value;
        dropdown.innerHTML = '<option value="">No schedule (manual start)</option>';
        data.schedules.filter(s => s.active).forEach(s => {
          dropdown.innerHTML += `<option value="${s.id}">${s.name}</option>`;
        });
        dropdown.value = currentVal;
      }

      // Render schedule cards
      if (!data.schedules || data.schedules.length === 0) {
        list.innerHTML = '<p class="text-xs text-gray-400 text-center py-2">No schedules yet</p>';
        return;
      }

      list.innerHTML = data.schedules.map(s => {
        const days = JSON.parse(s.days);
        const dayPills = Object.entries(DAY_LABELS).map(([key, label]) => {
          const active = days.includes(key);
          return `<span class="px-1.5 py-0.5 text-[10px] font-bold rounded ${active ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-400'}">${label}</span>`;
        }).join('');

        const statusBadge = s.active
          ? '<span class="px-2 py-0.5 text-[10px] font-bold bg-green-100 text-green-700 rounded-full">Active</span>'
          : '<span class="px-2 py-0.5 text-[10px] font-bold bg-gray-100 text-gray-500 rounded-full">Stopped</span>';

        const pendingBadge = s.pending_campaigns > 0
          ? `<span class="px-2 py-0.5 text-[10px] font-bold bg-yellow-100 text-yellow-700 rounded-full">${s.pending_campaigns} pending</span>`
          : '';

        const toggleBtn = s.active
          ? `<button onclick="toggleSchedule(${s.id}, 'stop')" class="text-[10px] font-semibold text-yellow-600 hover:text-yellow-800">Pause</button>`
          : `<button onclick="toggleSchedule(${s.id}, 'activate')" class="text-[10px] font-semibold text-green-600 hover:text-green-800">Activate</button>`;

        const deleteBtn = `<button onclick="deleteSchedule(${s.id})" class="text-[10px] font-semibold text-red-500 hover:text-red-700">Delete</button>`;

        return `
          <div class="p-3 bg-gray-50 rounded-xl border border-gray-100">
            <div class="flex justify-between items-start mb-2">
              <div class="font-semibold text-sm text-gray-800">${s.name}</div>
              <div class="flex gap-1.5 items-center">${statusBadge} ${pendingBadge}</div>
            </div>
            <div class="flex gap-0.5 mb-2">${dayPills}</div>
            <div class="flex justify-between items-center">
              <span class="text-xs text-gray-500">${s.start_time} - ${s.end_time}</span>
              <div class="flex gap-3">${toggleBtn} ${deleteBtn}</div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.error('Error loading schedules:', err);
    }
  }

  // Global functions for inline onclick handlers
  window.toggleSchedule = async function(id, action) {
    try {
      const res = await fetch(`/api/schedules/${id}/${action}`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error);
      loadSchedules();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  window.deleteSchedule = async function(id) {
    if (!confirm('Delete this schedule?')) return;
    try {
      const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error);
      loadSchedules();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  // Load schedules on startup
  loadSchedules();
}
