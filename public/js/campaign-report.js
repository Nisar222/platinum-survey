let currentCampaignId = null;

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

function sentimentBadge(sentiment) {
  if (!sentiment) return '<span class="text-gray-300">—</span>';
  const map = {
    positive: 'bg-green-50 text-green-700',
    happy: 'bg-green-50 text-green-700',
    satisfied: 'bg-green-50 text-green-700',
    neutral: 'bg-gray-100 text-gray-600',
    negative: 'bg-red-50 text-red-700',
    frustrated: 'bg-red-50 text-red-700',
    angry: 'bg-red-50 text-red-700',
    disappointed: 'bg-orange-50 text-orange-700',
  };
  const cls = map[sentiment.toLowerCase()] || 'bg-gray-100 text-gray-600';
  return `<span class="px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${cls}">${sentiment}</span>`;
}

function statusBadge(status) {
  const map = {
    running: 'bg-green-100 text-green-700',
    completed: 'bg-blue-100 text-blue-700',
    paused: 'bg-yellow-100 text-yellow-700',
    cancelled: 'bg-gray-100 text-gray-500',
    pending: 'bg-gray-100 text-gray-500',
  };
  const cls = map[status] || 'bg-gray-100 text-gray-500';
  return `<span class="px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${cls}">${status}</span>`;
}

async function loadCampaigns() {
  try {
    const res = await fetch('/api/campaigns?filter=all');
    if (!res.ok) { window.location.href = '/login'; return; }
    const campaigns = await res.json();
    const select = document.getElementById('campaignSelect');
    campaigns.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name + (c.status === 'running' ? ' (Active)' : c.status === 'completed' ? ' (Completed)' : '');
      select.appendChild(opt);
    });
  } catch (e) {
    console.error('Failed to load campaigns:', e);
  }
}

async function loadReport(campaignId) {
  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('reportContent').classList.add('hidden');
  document.getElementById('loadingState').classList.remove('hidden');

  try {
    const res = await fetch(`/api/campaigns/${campaignId}/report`);
    if (!res.ok) throw new Error('Failed to fetch report');
    const data = await res.json();

    // Campaign header
    document.getElementById('reportCampaignName').textContent = data.campaign.name;
    document.getElementById('reportCampaignStatus').outerHTML =
      `<span id="reportCampaignStatus">${statusBadge(data.campaign.status)}</span>`;

    // Summary stats
    const s = data.summary;
    document.getElementById('statTotal').textContent = s.totalScheduled;
    document.getElementById('statCompleted').textContent = s.completed;
    document.getElementById('statRescheduled').textContent = s.rescheduled;
    document.getElementById('statCallbacks').textContent = s.callbackRequests;
    document.getElementById('statEscalations').textContent = s.escalationsTotal;
    document.getElementById('statEscNonResponse').textContent = s.escalationsDueToNonResponse;
    document.getElementById('statEscLowRating').textContent = s.escalationsDueToLowRating;

    // Escalation table
    const tbody = document.getElementById('escalationTableBody');
    tbody.innerHTML = '';
    if (data.escalations.length === 0) {
      document.getElementById('escalationEmpty').classList.remove('hidden');
      tbody.closest('table').classList.add('hidden');
    } else {
      document.getElementById('escalationEmpty').classList.add('hidden');
      tbody.closest('table').classList.remove('hidden');
      data.escalations.forEach(row => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 transition-colors';
        tr.innerHTML = `
          <td class="px-6 py-3 font-medium text-gray-900">${row.customerName || '—'}</td>
          <td class="px-6 py-3 text-gray-600 max-w-sm">${row.callSummary ? `<span title="${row.callSummary}">${row.callSummary.slice(0, 120)}${row.callSummary.length > 120 ? '…' : ''}</span>` : '—'}</td>
          <td class="px-6 py-3">${sentimentBadge(row.customerSentiment)}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('reportContent').classList.remove('hidden');
    document.getElementById('exportBtn').disabled = false;

  } catch (e) {
    console.error('Failed to load report:', e);
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('emptyState').classList.remove('hidden');
  }
}

function exportCSV() {
  if (!currentCampaignId) return;
  window.location.href = `/api/campaigns/${currentCampaignId}/report/export`;
}

document.addEventListener('DOMContentLoaded', () => {
  loadCampaigns();

  document.getElementById('campaignSelect').addEventListener('change', e => {
    currentCampaignId = e.target.value;
    if (currentCampaignId) {
      loadReport(currentCampaignId);
    } else {
      document.getElementById('reportContent').classList.add('hidden');
      document.getElementById('loadingState').classList.add('hidden');
      document.getElementById('emptyState').classList.remove('hidden');
      document.getElementById('exportBtn').disabled = true;
    }
  });

  document.getElementById('exportBtn').addEventListener('click', exportCSV);
});
