/**
 * Batch Manager Frontend
 * Handles batch upload, display, and real-time progress updates
 */

// Wait for DOM to load
document.addEventListener('DOMContentLoaded', () => {
  console.log('📦 Batch Manager initialized');

  initializeBatchManager();
});

function initializeBatchManager() {
  // Get DOM elements
  const batchUploadForm = document.getElementById('batchUploadForm');
  const excelFileInput = document.getElementById('excelFile');
  const fileNameDisplay = document.getElementById('fileName');
  const uploadBatchBtn = document.getElementById('uploadBatchBtn');
  const uploadBtnText = document.getElementById('uploadBtnText');
  const uploadBtnLoader = document.getElementById('uploadBtnLoader');
  const uploadStatus = document.getElementById('uploadStatus');
  const batchList = document.getElementById('batchList');
  const refreshBatchesBtn = document.getElementById('refreshBatchesBtn');

  // File input change handler
  excelFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      fileNameDisplay.textContent = `Selected: ${file.name}`;
    } else {
      fileNameDisplay.textContent = '';
    }
  });

  // Form submit handler
  batchUploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await uploadBatch();
  });

  // Refresh batches button
  refreshBatchesBtn.addEventListener('click', () => {
    loadBatches();
  });

  // Upload batch function
  async function uploadBatch() {
    const batchName = document.getElementById('batchName').value.trim();
    const file = excelFileInput.files[0];

    if (!file) {
      showUploadStatus('error', 'Please select an Excel file');
      return;
    }

    // Show loading state
    uploadBatchBtn.disabled = true;
    uploadBtnText.classList.add('hidden');
    uploadBtnLoader.classList.remove('hidden');

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (batchName) {
        formData.append('batchName', batchName);
      }

      const response = await fetch('/api/batches/upload', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Success
        showUploadStatus('success', `Batch "${result.batch.name}" created with ${result.batch.total_contacts} contacts!`);

        // Show validation warnings if any
        if (result.validation.errors && result.validation.errors.length > 0) {
          const errorSummary = document.createElement('div');
          errorSummary.className = 'mt-2 text-xs text-yellow-700';
          errorSummary.innerHTML = `<strong>⚠️ ${result.validation.invalid} rows skipped:</strong> ${result.validation.errors.slice(0, 3).map(e => `Row ${e.row}: ${e.error}`).join(', ')}${result.validation.errors.length > 3 ? '...' : ''}`;
          uploadStatus.appendChild(errorSummary);
        }

        // Reset form
        batchUploadForm.reset();
        fileNameDisplay.textContent = '';

        // Reload batches
        setTimeout(() => {
          loadBatches();
        }, 1000);

      } else {
        // Error
        showUploadStatus('error', result.error || 'Upload failed');

        // Show detailed validation errors if present
        if (result.validation && result.validation.errors) {
          const errorList = document.createElement('div');
          errorList.className = 'mt-2 text-xs text-red-700';
          errorList.innerHTML = `<strong>Validation errors:</strong><br>${result.validation.errors.slice(0, 5).map(e => `• Row ${e.row}: ${e.error}`).join('<br>')}${result.validation.errors.length > 5 ? '<br>...and more' : ''}`;
          uploadStatus.appendChild(errorList);
        }
      }
    } catch (error) {
      console.error('Upload error:', error);
      showUploadStatus('error', `Upload failed: ${error.message}`);
    } finally {
      // Reset button state
      uploadBatchBtn.disabled = false;
      uploadBtnText.classList.remove('hidden');
      uploadBtnLoader.classList.add('hidden');
    }
  }

  // Show upload status message
  function showUploadStatus(type, message) {
    uploadStatus.classList.remove('hidden');

    const bgColor = type === 'success' ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500';
    const textColor = type === 'success' ? 'text-green-700' : 'text-red-700';
    const icon = type === 'success'
      ? '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
      : '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';

    uploadStatus.innerHTML = `
      <div class="p-4 ${bgColor} rounded-xl border-l-4">
        <div class="flex items-start gap-2">
          <div class="${textColor}">${icon}</div>
          <div class="${textColor} text-sm font-medium">${message}</div>
        </div>
      </div>
    `;

    // Auto-hide after 5 seconds for success messages
    if (type === 'success') {
      setTimeout(() => {
        uploadStatus.classList.add('hidden');
      }, 5000);
    }
  }

  // Load batches from API
  async function loadBatches() {
    try {
      const response = await fetch('/api/batches');
      const data = await response.json();

      if (data.batches && data.batches.length > 0) {
        displayBatches(data.batches);
      } else {
        batchList.innerHTML = `
          <div class="text-center py-8 text-gray-400">
            <svg class="w-16 h-16 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <p class="text-sm">No batches yet. Upload an Excel file to get started.</p>
          </div>
        `;
      }
    } catch (error) {
      console.error('Error loading batches:', error);
      batchList.innerHTML = `
        <div class="text-center py-8 text-red-400">
          <p class="text-sm">Error loading batches. Please try again.</p>
        </div>
      `;
    }
  }

  // Display batches in UI
  function displayBatches(batches) {
    batchList.innerHTML = '';

    batches.forEach(batch => {
      const batchCard = createBatchCard(batch);
      batchList.appendChild(batchCard);
    });
  }

  // Create batch card element
  function createBatchCard(batch) {
    const card = document.createElement('div');
    card.className = 'p-4 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl border border-purple-200';
    card.dataset.batchId = batch.id;

    const statusBadge = getStatusBadge(batch.status);
    const progressPercent = batch.total_contacts > 0
      ? Math.round((batch.completed_contacts / batch.total_contacts) * 100)
      : 0;

    card.innerHTML = `
      <div class="flex justify-between items-start mb-3">
        <div class="flex-1">
          <h3 class="font-bold text-gray-800">${batch.name}</h3>
          <p class="text-xs text-gray-500 mt-1">${new Date(batch.created_at).toLocaleString()}</p>
        </div>
        ${statusBadge}
      </div>

      <div class="grid grid-cols-3 gap-2 mb-3">
        <div class="text-center p-2 bg-white rounded-lg">
          <div class="text-lg font-bold text-gray-800">${batch.total_contacts}</div>
          <div class="text-xs text-gray-500">Total</div>
        </div>
        <div class="text-center p-2 bg-white rounded-lg">
          <div class="text-lg font-bold text-green-600">${batch.successful_calls}</div>
          <div class="text-xs text-gray-500">Success</div>
        </div>
        <div class="text-center p-2 bg-white rounded-lg">
          <div class="text-lg font-bold text-yellow-600">${batch.callbacks_pending}</div>
          <div class="text-xs text-gray-500">Pending</div>
        </div>
      </div>

      <div class="mb-3">
        <div class="flex justify-between text-xs text-gray-600 mb-1">
          <span>Progress</span>
          <span>${progressPercent}%</span>
        </div>
        <div class="w-full bg-gray-200 rounded-full h-2">
          <div class="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-500" style="width: ${progressPercent}%"></div>
        </div>
      </div>

      <div class="flex gap-2">
        ${getBatchActions(batch)}
      </div>
    `;

    // Add event listeners for action buttons
    addBatchActionListeners(card, batch);

    return card;
  }

  // Get status badge HTML
  function getStatusBadge(status) {
    const badges = {
      pending: '<span class="px-2 py-1 bg-gray-200 text-gray-700 text-xs font-semibold rounded-full">Pending</span>',
      running: '<span class="px-2 py-1 bg-blue-200 text-blue-700 text-xs font-semibold rounded-full animate-pulse">● Running</span>',
      paused: '<span class="px-2 py-1 bg-yellow-200 text-yellow-700 text-xs font-semibold rounded-full">⏸ Paused</span>',
      completed: '<span class="px-2 py-1 bg-green-200 text-green-700 text-xs font-semibold rounded-full">✓ Completed</span>',
      cancelled: '<span class="px-2 py-1 bg-red-200 text-red-700 text-xs font-semibold rounded-full">✕ Cancelled</span>'
    };
    return badges[status] || badges.pending;
  }

  // Get batch action buttons HTML
  function getBatchActions(batch) {
    switch (batch.status) {
      case 'pending':
        return '<button class="action-start flex-1 px-3 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-semibold rounded-lg transition-all">▶ Start</button>';

      case 'running':
        return `
          <button class="action-pause flex-1 px-3 py-2 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-semibold rounded-lg transition-all">⏸ Pause</button>
          <button class="action-view-queue px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-all">👁 Queue</button>
        `;

      case 'paused':
        return `
          <button class="action-resume flex-1 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-all">▶ Resume</button>
          <button class="action-cancel px-3 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-lg transition-all">✕ Cancel</button>
        `;

      case 'completed':
      case 'cancelled':
        return '<div class="text-xs text-gray-500 text-center flex-1 py-2">No actions available</div>';

      default:
        return '';
    }
  }

  // Add event listeners to batch action buttons
  function addBatchActionListeners(card, batch) {
    const startBtn = card.querySelector('.action-start');
    const pauseBtn = card.querySelector('.action-pause');
    const resumeBtn = card.querySelector('.action-resume');
    const cancelBtn = card.querySelector('.action-cancel');
    const viewQueueBtn = card.querySelector('.action-view-queue');

    if (startBtn) {
      startBtn.addEventListener('click', () => batchAction(batch.id, 'start'));
    }
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => batchAction(batch.id, 'pause'));
    }
    if (resumeBtn) {
      resumeBtn.addEventListener('click', () => batchAction(batch.id, 'resume'));
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        if (confirm(`Are you sure you want to cancel batch "${batch.name}"?`)) {
          batchAction(batch.id, 'cancel');
        }
      });
    }
    if (viewQueueBtn) {
      viewQueueBtn.addEventListener('click', () => showQueueProgress(batch.id));
    }
  }

  // Perform batch action
  async function batchAction(batchId, action) {
    try {
      const response = await fetch(`/api/batches/${batchId}/${action}`, {
        method: 'POST'
      });

      const result = await response.json();

      if (response.ok && result.success) {
        console.log(`✅ Batch ${batchId} ${action}ed`);
        // Reload batches to reflect new status
        setTimeout(() => loadBatches(), 500);
      } else {
        console.error(`❌ Batch ${action} failed:`, result.error);
        alert(`Failed to ${action} batch: ${result.error}`);
      }
    } catch (error) {
      console.error(`Error ${action}ing batch:`, error);
      alert(`Error: ${error.message}`);
    }
  }

  // Socket.IO listeners for real-time updates
  if (typeof io !== 'undefined') {
    const socket = io();

    socket.on('batch-progress', (data) => {
      console.log('📊 Batch progress:', data);
      updateBatchProgress(data);
      updateCallStatistics(data.batchId);
    });

    socket.on('batch-completed', (data) => {
      console.log('✅ Batch completed:', data);
      loadBatches();
    });

    socket.on('batch-paused', (data) => {
      console.log('⏸️ Batch paused:', data);
      loadBatches();
    });

    socket.on('batch-resumed', (data) => {
      console.log('▶️ Batch resumed:', data);
      loadBatches();
    });

    socket.on('batch-cancelled', (data) => {
      console.log('🛑 Batch cancelled:', data);
      loadBatches();
    });

    socket.on('contact-calling', (data) => {
      console.log('📞 Contact calling:', data);
      updateCurrentlyCallingCard(data);
      startDurationTimer(data.contactId, data.callStartedAt);
    });

    socket.on('contact-completed', (data) => {
      console.log('✅ Contact completed:', data);
      clearCurrentlyCallingCard();
      stopDurationTimer();
      updateQueueList(data.batchId);
      updateCallStatistics(data.batchId);
    });

    socket.on('concurrency-limit-reached', (data) => {
      console.log('⏳ Concurrency limit reached:', data);
      updateConcurrencyStatus(data);
    });

    socket.on('contact-failed', (data) => {
      console.log('❌ Contact failed:', data);
      showContactFailedNotification(data);
    });

    socket.on('batch-started', (data) => {
      console.log('📦 Batch started:', data);
      loadBatches();
      // Auto-show queue progress panel when batch starts
      showQueueProgress(data.batchId);
    });
  }

  // ============================================================================
  // QUEUE MANAGEMENT FUNCTIONS
  // ============================================================================

  let currentBatchId = null;
  let durationTimer = null;

  // Show queue progress panel
  async function showQueueProgress(batchId) {
    currentBatchId = batchId;
    const queueSection = document.getElementById('queueProgressSection');
    queueSection.classList.remove('hidden');

    // Fetch queue details
    await updateQueuePanel(batchId);

    // Start periodic refresh (every 10 seconds)
    if (window.queueRefreshInterval) {
      clearInterval(window.queueRefreshInterval);
    }
    window.queueRefreshInterval = setInterval(() => {
      updateQueuePanel(batchId);
      updateCallConcurrencyStatus();
    }, 10000);

    // Update concurrency status immediately
    updateCallConcurrencyStatus();

    // Add close button listener
    document.getElementById('closeQueueBtn').addEventListener('click', () => {
      queueSection.classList.add('hidden');
      if (window.queueRefreshInterval) {
        clearInterval(window.queueRefreshInterval);
      }
      stopDurationTimer();
    });
  }

  // Update queue panel with data
  async function updateQueuePanel(batchId) {
    try {
      const response = await fetch(`/api/batches/${batchId}/queue-details`);
      const data = await response.json();

      // Update currently calling
      if (data.currentContact) {
        updateCurrentlyCallingCard(data.currentContact);
      } else {
        clearCurrentlyCallingCard();
      }

      // Update queue list
      const queueList = document.getElementById('queueList');
      queueList.innerHTML = '';

      if (data.queueDetails && data.queueDetails.length > 0) {
        data.queueDetails.forEach((contact) => {
          const contactCard = createQueueContactCard(contact);
          queueList.appendChild(contactCard);
        });
      } else {
        queueList.innerHTML = `
          <div class="text-center py-8 text-gray-400">
            <p class="text-sm">No contacts in queue</p>
          </div>
        `;
      }
    } catch (error) {
      console.error('Error updating queue panel:', error);
    }
  }

  // Create queue contact card
  function createQueueContactCard(contact) {
    const card = document.createElement('div');
    card.className = 'p-3 bg-white border border-gray-200 rounded-lg hover:shadow-md transition-all';
    card.dataset.contactId = contact.id;

    const waitMinutes = Math.ceil(contact.estimatedWaitSeconds / 60);
    const startTime = new Date(contact.estimatedStartTime).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });

    card.innerHTML = `
      <div class="flex justify-between items-start">
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs font-bold text-gray-400">#${contact.queuePosition}</span>
            <span class="font-semibold text-gray-800">${contact.customer_name}</span>
          </div>
          <div class="text-xs text-gray-500">${contact.phone_number}</div>
        </div>
        <div class="text-right">
          <div class="text-xs text-gray-500">~${waitMinutes} min</div>
          <div class="text-xs text-gray-400">${startTime}</div>
        </div>
      </div>
      ${contact.attempt_count > 0 ? `
        <div class="mt-2 text-xs text-yellow-600">
          Retry ${contact.attempt_count}/${contact.max_attempts}
        </div>
      ` : ''}
    `;

    return card;
  }

  // Update currently calling card
  function updateCurrentlyCallingCard(contact) {
    const infoDiv = document.getElementById('currentContactInfo');

    infoDiv.innerHTML = `
      <div class="font-semibold text-gray-800">${contact.customerName || contact.customer_name}</div>
      <div class="text-xs text-gray-500 mt-1">${contact.phoneNumber || contact.phone_number}</div>
      <div class="text-xs text-gray-500 mt-1">
        Attempt ${contact.attemptNumber || contact.attempt_count}/${contact.maxAttempts || contact.max_attempts}
        <span id="callDuration" class="ml-2 font-mono"></span>
      </div>
    `;
  }

  // Clear currently calling card
  function clearCurrentlyCallingCard() {
    const infoDiv = document.getElementById('currentContactInfo');
    infoDiv.innerHTML = 'No active call';
    stopDurationTimer();
  }

  // Start duration timer
  function startDurationTimer(contactId, callStartedAt) {
    stopDurationTimer(); // Clear any existing timer

    const startTime = callStartedAt ? new Date(callStartedAt) : new Date();

    durationTimer = setInterval(() => {
      const now = new Date();
      const elapsed = Math.floor((now - startTime) / 1000);
      const durationDisplay = document.getElementById('callDuration');
      if (durationDisplay) {
        durationDisplay.textContent = `• ${formatDuration(elapsed)}`;
      }
    }, 1000);
  }

  // Stop duration timer
  function stopDurationTimer() {
    if (durationTimer) {
      clearInterval(durationTimer);
      durationTimer = null;
    }
  }

  // Format duration in seconds to mm:ss
  function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // Update call concurrency status
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

      // Visual bars for concurrency status
      barsContainer.innerHTML = '';
      for (let i = 0; i < data.maxCalls; i++) {
        const bar = document.createElement('div');
        bar.className = `flex-1 rounded-full ${
          i < data.activeCallCount
            ? 'bg-red-400'
            : 'bg-green-400'
        }`;
        barsContainer.appendChild(bar);
      }
    } catch (error) {
      console.error('Error updating call concurrency status:', error);
    }
  }

  // Update concurrency status (from Socket.IO event)
  function updateConcurrencyStatus(data) {
    const statusText = document.getElementById('concurrencyStatusText');
    statusText.textContent = `Waiting... (${data.activeCallCount}/${data.maxCalls} active)`;
    statusText.className = 'text-sm text-yellow-600 font-semibold';
  }

  // Update call statistics
  async function updateCallStatistics(batchId) {
    try {
      const response = await fetch(`/api/batches/${batchId}`);
      const data = await response.json();

      if (data.batch) {
        const batch = data.batch;

        // Success rate
        const successRate = batch.total_contacts > 0
          ? Math.round((batch.successful_calls / batch.total_contacts) * 100)
          : 0;
        document.getElementById('successRate').textContent = `${successRate}%`;

        // Average duration
        const avgDuration = batch.avg_call_duration_seconds || 0;
        const avgMinutes = Math.round(avgDuration / 60);
        document.getElementById('avgDuration').textContent = `${avgMinutes}m`;

        // Callbacks count
        document.getElementById('callbacksCount').textContent = batch.callbacks_pending || 0;
      }
    } catch (error) {
      console.error('Error updating call statistics:', error);
    }
  }

  // Show contact failed notification
  function showContactFailedNotification(data) {
    // You could add a toast notification here
    console.error(`Contact ${data.contactId} failed: ${data.error}`);
  }

  // Update batch progress in real-time
  function updateBatchProgress(data) {
    const batchCard = document.querySelector(`[data-batch-id="${data.batchId}"]`);
    if (!batchCard) return;

    const progressPercent = data.total > 0
      ? Math.round((data.completed / data.total) * 100)
      : 0;

    // Update stats
    const stats = batchCard.querySelectorAll('.text-lg');
    if (stats[0]) stats[0].textContent = data.total;
    if (stats[1]) stats[1].textContent = data.successful;
    if (stats[2]) stats[2].textContent = data.callbacksPending;

    // Update progress bar
    const progressBar = batchCard.querySelector('.bg-gradient-to-r');
    if (progressBar) {
      progressBar.style.width = `${progressPercent}%`;
    }

    const progressText = batchCard.querySelector('.flex.justify-between span:last-child');
    if (progressText) {
      progressText.textContent = `${progressPercent}%`;
    }
  }

  // Initial load
  loadBatches();
}
