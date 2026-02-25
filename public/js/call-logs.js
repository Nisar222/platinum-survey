// Call Logs Page — frontend logic

(function () {
  // ── State ────────────────────────────────────────────────────────────────
  let allCalls = [];
  let activeCallId = null;

  // Parse a SQLite datetime string (stored as UTC, no Z suffix) as UTC
  function parseUTC(str) {
    if (!str) return null;
    // If already has timezone info, parse as-is
    if (str.includes('Z') || str.includes('+') || str.match(/[+-]\d{2}:\d{2}$/)) {
      return new Date(str);
    }
    // SQLite stores UTC without Z — append it
    return new Date(str.replace(' ', 'T') + 'Z');
  }

  function fmtTime(str, opts) {
    const d = parseUTC(str);
    return d ? d.toLocaleString([], opts) : '—';
  }

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const filterCampaign = document.getElementById('filterCampaign');
  const filterFrom     = document.getElementById('filterFrom');
  const filterTo       = document.getElementById('filterTo');
  const applyBtn       = document.getElementById('applyFilters');
  const exportBtn      = document.getElementById('exportCsv');
  const callGroups     = document.getElementById('callGroups');
  const summaryText    = document.getElementById('summaryText');
  const loadingState   = document.getElementById('loadingState');
  const emptyState     = document.getElementById('emptyState');
  const noSelection    = document.getElementById('noSelection');
  const callDetail     = document.getElementById('callDetail');

  // ── Init date range (last 30 days) ───────────────────────────────────────
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);
  filterTo.value   = today.toISOString().slice(0, 10);
  filterFrom.value = thirtyDaysAgo.toISOString().slice(0, 10);

  // ── Load campaigns for filter dropdown ───────────────────────────────────
  async function loadCampaigns() {
    try {
      const res = await fetch('/api/campaigns?filter=all');
      const data = await res.json();
      const campaigns = data.campaigns || data.batches || [];
      campaigns.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name || `Campaign ${c.id}`;
        filterCampaign.appendChild(opt);
      });
    } catch (e) {
      console.error('Failed to load campaigns:', e);
    }
  }

  // ── Fetch call logs ───────────────────────────────────────────────────────
  async function loadCalls() {
    const from       = filterFrom.value;
    const to         = filterTo.value;
    const campaignId = filterCampaign.value;

    loadingState.classList.remove('hidden');
    emptyState.classList.add('hidden');
    callGroups.innerHTML = '';
    summaryText.textContent = 'Loading...';

    try {
      let url = `/api/campaigns/reports/calls?from=${from}&to=${to}`;
      if (campaignId) url += `&campaignId=${campaignId}`;

      const res  = await fetch(url);
      const data = await res.json();
      allCalls   = data.calls || [];

      loadingState.classList.add('hidden');

      if (allCalls.length === 0) {
        emptyState.classList.remove('hidden');
        summaryText.textContent = 'No calls found';
        return;
      }

      summaryText.textContent = `${allCalls.length} call${allCalls.length !== 1 ? 's' : ''} · ${from} to ${to}`;
      renderGroups(allCalls);
      // Auto-select first call
      if (allCalls.length > 0) openDetail(allCalls[0]);
    } catch (e) {
      console.error('Failed to load calls:', e);
      loadingState.classList.add('hidden');
      summaryText.textContent = 'Error loading calls';
    }
  }

  // ── Group calls by campaign and render ───────────────────────────────────
  function renderGroups(calls) {
    // Group by campaign_id
    const groups = {};
    calls.forEach(call => {
      const key  = call.campaign_id || 'unknown';
      const name = call.campaign_name || 'Unknown Campaign';
      if (!groups[key]) groups[key] = { name, calls: [] };
      groups[key].calls.push(call);
    });

    callGroups.innerHTML = '';

    // Sort groups so the campaign with the most recent call appears first
    const sortedGroups = Object.entries(groups).sort((a, b) => {
      const aTime = a[1].calls[0]?.call_time || '';
      const bTime = b[1].calls[0]?.call_time || '';
      return bTime.localeCompare(aTime);
    });

    sortedGroups.forEach(([campaignId, group]) => {
      const section = document.createElement('div');
      section.className = 'bg-white rounded-2xl border border-gray-100 overflow-hidden';

      // Group header
      section.innerHTML = `
        <div class="group-header px-3 py-1.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
          <span class="text-xs font-semibold text-gray-600 truncate">${group.name}</span>
          <span class="text-xs text-gray-400 flex-shrink-0 ml-1">${group.calls.length}</span>
        </div>
      `;

      // Call rows
      const table = document.createElement('div');
      table.className = 'divide-y divide-gray-50';

      group.calls.forEach(call => {
        const row = document.createElement('div');
        row.className = 'call-row px-3 py-2.5 flex items-center gap-2';
        row.dataset.callId = call.id;

        const duration = call.duration_seconds
          ? `${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s`
          : '—';
        const time = fmtTime(call.call_time, { dateStyle: 'short', timeStyle: 'short' });

        row.innerHTML = `
          <div class="flex-1 min-w-0">
            <div class="font-medium text-gray-800 text-xs truncate">${call.customer_name || '—'}</div>
            <div class="text-xs text-gray-400 mt-0.5 truncate">${time} · ${duration}</div>
          </div>
          <div class="flex items-center gap-1 flex-shrink-0">
            ${call.escalation_required ? '<span class="px-1.5 py-0.5 rounded-full text-xs font-bold bg-red-500 text-white whitespace-nowrap">ESC</span>' : ''}
            ${getDispositionBadge(call.call_disposition || call.call_status)}
          </div>
        `;

        row.addEventListener('click', () => openDetail(call));
        table.appendChild(row);
      });

      section.appendChild(table);
      callGroups.appendChild(section);
    });
  }

  // ── Open detail panel ─────────────────────────────────────────────────────
  function openDetail(call) {
    activeCallId = call.id;

    // Highlight active row
    document.querySelectorAll('.call-row').forEach(r => r.classList.remove('active'));
    const activeRow = document.querySelector(`.call-row[data-call-id="${call.id}"]`);
    if (activeRow) activeRow.classList.add('active');

    // Populate header
    document.getElementById('detailName').textContent    = call.customer_name || '—';
    document.getElementById('detailPhone').textContent   = call.phone_number  || '—';
    document.getElementById('detailCampaign').textContent = call.campaign_name || '—';
    document.getElementById('detailDuration').textContent = call.duration_seconds
      ? `${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s`
      : '—';
    document.getElementById('detailTime').textContent = fmtTime(call.call_time, { dateStyle: 'medium', timeStyle: 'short' });

    const dispEl = document.getElementById('detailDisposition');
    dispEl.innerHTML = getDispositionBadge(call.call_disposition || call.call_status);

    const escEl = document.getElementById('detailEscalation');
    if (call.escalation_required) {
      escEl.innerHTML = '<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-red-500 text-white">Escalation Required</span>';
      escEl.classList.remove('hidden');
    } else {
      escEl.innerHTML = '';
      escEl.classList.add('hidden');
    }

    // Audio player
    const audioSection = document.getElementById('audioSection');
    const audioPlayer  = document.getElementById('audioPlayer');
    if (call.recording_url) {
      audioPlayer.src = call.recording_url;
      audioSection.classList.remove('hidden');
    } else {
      audioSection.classList.add('hidden');
      audioPlayer.src = '';
    }

    // Transcript
    renderTranscript(call.transcript_text);

    // Analysis
    document.getElementById('analysisSummary').textContent  = call.call_summary    || '—';
    document.getElementById('analysisFeedback').textContent = call.feedback_summary || call.customer_feedback || '—';
    document.getElementById('analysisSentiment').textContent = call.customer_sentiment || '—';
    document.getElementById('analysisRating').textContent    = call.rating != null ? call.rating : '—';
    document.getElementById('analysisEndedReason').textContent = call.ended_reason || '—';
    document.getElementById('analysisAttempt').textContent   = call.attempt_number ? `#${call.attempt_number}` : '—';

    const cbSection = document.getElementById('analysisCallbackSection');
    if (call.callback_requested) {
      cbSection.classList.remove('hidden');
      document.getElementById('analysisCallbackTime').textContent = call.callback_schedule
        ? fmtTime(call.callback_schedule, { dateStyle: 'medium', timeStyle: 'short' })
        : 'Requested';
    } else {
      cbSection.classList.add('hidden');
    }

    const escSection = document.getElementById('analysisEscalationSection');
    if (call.escalation_required) {
      escSection.classList.remove('hidden');
    } else {
      escSection.classList.add('hidden');
    }

    // Switch to transcript tab
    switchTab('transcript');

    // Show detail, hide empty state
    noSelection.classList.add('hidden');
    callDetail.classList.remove('hidden');
  }

  // ── Render transcript ─────────────────────────────────────────────────────
  function renderTranscript(text) {
    const container  = document.getElementById('transcriptContent');
    const noTranscript = document.getElementById('noTranscript');

    if (!text || text.trim() === '') {
      container.innerHTML = '';
      noTranscript.classList.remove('hidden');
      return;
    }

    noTranscript.classList.add('hidden');

    // Parse transcript — VAPI format: "Role: message\nRole: message"
    const lines = text.split(/\n/).filter(l => l.trim());

    // Parse into [{role, message}] and consolidate consecutive same-role lines
    const parsed = [];
    lines.forEach(line => {
      const match = line.match(/^(AI|Assistant|User|Caller|Bot|Agent):\s*(.+)$/i);
      if (!match) return;
      const isAssistant = /^(AI|Assistant|Bot|Agent)$/i.test(match[1]);
      const last = parsed[parsed.length - 1];
      if (last && last.isAssistant === isAssistant) {
        last.message += ' ' + match[2];
      } else {
        parsed.push({ isAssistant, message: match[2] });
      }
    });

    const bubbles = parsed.map(({ isAssistant, message }) => {
      if (isAssistant) {
        return `
          <div class="flex items-start gap-3">
            <div class="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm" style="background: linear-gradient(135deg, #2BB8D1, #6B4D9C)">
              <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2zm-5 9a1 1 0 0 0-1 1v1a1 1 0 0 0 2 0v-1a1 1 0 0 0-1-1zm10 0a1 1 0 0 0-1 1v1a1 1 0 0 0 2 0v-1a1 1 0 0 0-1-1z"/>
              </svg>
            </div>
            <div class="transcript-bubble-assistant px-4 py-2.5 text-sm text-gray-800 max-w-[82%] leading-relaxed">${message}</div>
          </div>
        `;
      } else {
        return `
          <div class="flex items-start gap-3 justify-end">
            <div class="transcript-bubble-caller px-4 py-2.5 text-sm text-gray-800 max-w-[82%] leading-relaxed">${message}</div>
            <div class="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg class="w-3.5 h-3.5 text-gray-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"/></svg>
            </div>
          </div>
        `;
      }
    });

    container.innerHTML = bubbles.join('');
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
    document.getElementById('tab-transcript').classList.toggle('hidden', tab !== 'transcript');
    document.getElementById('tab-analysis').classList.toggle('hidden', tab !== 'analysis');
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });


  // ── Export CSV ────────────────────────────────────────────────────────────
  exportBtn.addEventListener('click', () => {
    const from       = filterFrom.value;
    const to         = filterTo.value;
    const campaignId = filterCampaign.value;
    let url = `/api/campaigns/reports/calls?from=${from}&to=${to}&format=csv`;
    if (campaignId) url += `&campaignId=${campaignId}`;
    window.open(url, '_blank');
  });

  // ── Apply filters ─────────────────────────────────────────────────────────
  applyBtn.addEventListener('click', loadCalls);

  // ── Disposition badge helper ───────────────────────────────────────────────
  function getDispositionBadge(disposition) {
    const map = {
      'completed':          'bg-green-100 text-green-700',
      'callback_requested': 'bg-yellow-100 text-yellow-700',
      'no_answer':          'bg-gray-100 text-gray-500',
      'max_attempts':       'bg-red-100 text-red-600',
      'failed':             'bg-red-100 text-red-600',
      'calling':            'bg-blue-100 text-blue-600',
    };
    const label = {
      'completed':          'Completed',
      'callback_requested': 'Callback',
      'no_answer':          'No Answer',
      'max_attempts':       'Max Attempts',
      'failed':             'Failed',
      'calling':            'Calling',
    };
    const cls  = map[disposition]  || 'bg-gray-100 text-gray-500';
    const text = label[disposition] || disposition || '—';
    return `<span class="px-2 py-0.5 rounded-full text-xs font-semibold ${cls} whitespace-nowrap">${text}</span>`;
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  loadCampaigns().then(() => loadCalls());

})();
