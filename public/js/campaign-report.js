let allCampaigns = [];
let selectedIds = new Set();
let reportData = {}; // id -> { campaign, summary, escalations }

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

async function loadCampaigns() {
  try {
    const res = await fetch('/api/campaigns?filter=all');
    if (!res.ok) { window.location.href = '/login'; return; }
    const data = await res.json();
    allCampaigns = data.campaigns || data; // API returns newest first already
    renderCampaignList(allCampaigns);
  } catch (e) {
    console.error('Failed to load campaigns:', e);
  } finally {
    document.getElementById('campaignListLoading').classList.add('hidden');
  }
}

function renderCampaignList(campaigns) {
  const list = document.getElementById('campaignList');
  // Remove existing items (keep loading div)
  list.querySelectorAll('.campaign-item').forEach(el => el.remove());

  if (campaigns.length === 0) {
    list.insertAdjacentHTML('beforeend', '<div class="py-8 text-center text-gray-400 text-xs">No campaigns found</div>');
    return;
  }

  campaigns.forEach(c => {
    const div = document.createElement('div');
    div.className = 'campaign-item px-3 py-3 cursor-pointer flex items-start gap-2.5 transition-colors';
    div.dataset.id = c.id;
    if (selectedIds.has(String(c.id))) div.classList.add('selected');

    const statusDot = c.status === 'running'
      ? '<span class="mt-1 w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0 inline-block"></span>'
      : c.status === 'completed'
        ? '<span class="mt-1 w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0 inline-block"></span>'
        : '<span class="mt-1 w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0 inline-block"></span>';

    div.innerHTML = `
      <input type="checkbox" class="mt-0.5 flex-shrink-0 accent-blue-500" ${selectedIds.has(String(c.id)) ? 'checked' : ''} />
      ${statusDot}
      <div class="min-w-0">
        <div class="text-sm font-medium text-gray-800 truncate">${c.name}</div>
        <div class="text-xs text-gray-400 capitalize">${c.status}</div>
      </div>
    `;

    div.addEventListener('click', (e) => {
      if (e.target.type === 'checkbox') return; // handled below
      toggleCampaign(String(c.id));
    });
    div.querySelector('input[type=checkbox]').addEventListener('change', () => {
      toggleCampaign(String(c.id));
    });

    list.appendChild(div);
  });
}

function toggleCampaign(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
  } else {
    selectedIds.add(id);
  }
  updateSelectionUI();
  loadSelectedReport();
}

function updateSelectionUI() {
  const count = selectedIds.size;
  document.getElementById('selectedCount').textContent = `${count} selected`;

  document.querySelectorAll('.campaign-item').forEach(el => {
    const id = String(el.dataset.id);
    const isSelected = selectedIds.has(id);
    el.classList.toggle('selected', isSelected);
    const cb = el.querySelector('input[type=checkbox]');
    if (cb) cb.checked = isSelected;
  });
}

async function loadSelectedReport() {
  if (selectedIds.size === 0) {
    showEmpty();
    document.getElementById('exportBtn').disabled = true;
    return;
  }

  showLoading();

  // Fetch reports for any IDs not yet cached
  const toFetch = [...selectedIds].filter(id => !reportData[id]);
  try {
    await Promise.all(toFetch.map(async id => {
      const res = await fetch(`/api/campaigns/${id}/report`);
      if (!res.ok) throw new Error(`Failed to fetch report for ${id}`);
      reportData[id] = await res.json();
    }));
  } catch (e) {
    console.error('Failed to load report:', e);
    showEmpty();
    return;
  }

  renderReport();
}

function renderReport() {
  const selected = [...selectedIds].map(id => reportData[id]).filter(Boolean);
  if (selected.length === 0) { showEmpty(); return; }

  // Aggregate summary
  const agg = {
    totalScheduled: 0, completed: 0, rescheduled: 0,
    callbackRequests: 0, escalationsTotal: 0,
    escalationsDueToNonResponse: 0, escalationsDueToLowRating: 0
  };
  selected.forEach(d => {
    const s = d.summary;
    agg.totalScheduled += s.totalScheduled || 0;
    agg.completed += s.completed || 0;
    agg.rescheduled += s.rescheduled || 0;
    agg.callbackRequests += s.callbackRequests || 0;
    agg.escalationsTotal += s.escalationsTotal || 0;
    agg.escalationsDueToNonResponse += s.escalationsDueToNonResponse || 0;
    agg.escalationsDueToLowRating += s.escalationsDueToLowRating || 0;
  });

  // Subtitle
  const names = selected.map(d => d.campaign.name);
  document.getElementById('reportSubtitle').textContent =
    selected.length === 1 ? names[0] : `${selected.length} campaigns combined`;

  // Stats
  document.getElementById('statTotal').textContent = agg.totalScheduled;
  document.getElementById('statCompleted').textContent = agg.completed;
  document.getElementById('statRescheduled').textContent = agg.rescheduled;
  document.getElementById('statCallbacks').textContent = agg.callbackRequests;
  document.getElementById('statEscalations').textContent = agg.escalationsTotal;
  document.getElementById('statEscNonResponse').textContent = agg.escalationsDueToNonResponse;
  document.getElementById('statEscLowRating').textContent = agg.escalationsDueToLowRating;

  // Selected pills
  const pills = document.getElementById('selectedPills');
  pills.innerHTML = selected.map(d => {
    const color = d.campaign.status === 'running' ? 'bg-green-50 text-green-700 border-green-200'
      : d.campaign.status === 'completed' ? 'bg-blue-50 text-blue-700 border-blue-200'
      : 'bg-gray-100 text-gray-600 border-gray-200';
    return `<span class="px-2.5 py-1 rounded-full text-xs font-medium border ${color}">${d.campaign.name}</span>`;
  }).join('');

  // Escalation table — show Campaign column only if multiple selected
  const multiCampaign = selected.length > 1;
  const campaignColHeader = document.getElementById('campaignColHeader');
  campaignColHeader.classList.toggle('hidden', !multiCampaign);

  const tbody = document.getElementById('escalationTableBody');
  tbody.innerHTML = '';

  // Merge all escalations, tag with campaign name
  const allEscalations = [];
  selected.forEach(d => {
    d.escalations.forEach(row => {
      allEscalations.push({ ...row, _campaignName: d.campaign.name });
    });
  });

  if (allEscalations.length === 0) {
    document.getElementById('escalationEmpty').classList.remove('hidden');
    document.getElementById('escalationTable').classList.add('hidden');
  } else {
    document.getElementById('escalationEmpty').classList.add('hidden');
    document.getElementById('escalationTable').classList.remove('hidden');
    allEscalations.forEach(row => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-gray-50 transition-colors';
      const campaignCell = multiCampaign
        ? `<td class="px-6 py-3 text-xs text-gray-500 font-medium">${row._campaignName}</td>`
        : '';
      tr.innerHTML = `
        <td class="px-6 py-3 font-medium text-gray-900">${row.customerName || '—'}</td>
        ${campaignCell}
        <td class="px-6 py-3 text-gray-600 max-w-sm">${row.callSummary ? `<span title="${row.callSummary}">${row.callSummary.slice(0, 120)}${row.callSummary.length > 120 ? '…' : ''}</span>` : '—'}</td>
        <td class="px-6 py-3">${sentimentBadge(row.customerSentiment)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Enable export
  document.getElementById('exportBtn').disabled = false;

  showReport();
}

function showEmpty() {
  document.getElementById('emptyState').classList.remove('hidden');
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('reportContent').classList.add('hidden');
}

function showLoading() {
  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('loadingState').classList.remove('hidden');
  document.getElementById('reportContent').classList.add('hidden');
}

function showReport() {
  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('reportContent').classList.remove('hidden');
}

function exportCSV() {
  if (selectedIds.size === 0) return;
  [...selectedIds].forEach((id, i) => {
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = `/api/campaigns/${id}/report/export`;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }, i * 600);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadCampaigns();

  document.getElementById('campaignSearch').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filtered = allCampaigns.filter(c => c.name.toLowerCase().includes(q));
    renderCampaignList(filtered);
    updateSelectionUI();
  });

  document.getElementById('selectAllBtn').addEventListener('click', () => {
    const search = document.getElementById('campaignSearch').value.toLowerCase();
    const visible = allCampaigns.filter(c => c.name.toLowerCase().includes(search));
    visible.forEach(c => selectedIds.add(String(c.id)));
    updateSelectionUI();
    loadSelectedReport();
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    selectedIds.clear();
    updateSelectionUI();
    showEmpty();
    document.getElementById('exportBtn').disabled = true;
  });

  document.getElementById('exportBtn').addEventListener('click', exportCSV);
});
