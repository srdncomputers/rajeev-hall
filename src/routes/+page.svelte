<script>
  import { onMount } from 'svelte';
  import Dexie from 'dexie';

  // ── Register Service Worker (PWA Offline) ─────────────
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(() => {
      console.log('✅ Service Worker registered — app works offline!');
    }).catch(err => {
      console.log('SW registration failed:', err);
    });
  }

  // ── Database ──────────────────────────────────────────
  const db = new Dexie('HallBookings');
  db.version(4).stores({
    bookings: '++id, date, client_name, phone, event_type, start_time, end_time, advance_paid, total_amount, discount_type, discount_value, final_amount, hall_capacity, booked_capacity, status, notes, created_at',
    settings: 'key',
  });

  // Hall max capacity from settings
  let hallCapacity = $state(500);

  // ── State ─────────────────────────────────────────────
  let currentPage  = $state('calendar');
  let bookings     = $state([]);
  let currentMonth = $state(new Date().getMonth());
  let currentYear  = $state(new Date().getFullYear());
  let hallName     = $state('My Marriage Hall');

  // Settings
  let showSettings    = $state(false);
  let settingHallName = $state('');
  let settingCapacity = $state(500);

  // Booking form
  let showForm     = $state(false);
  let editingId    = $state(null);
  let selectedDate = $state('');

  let fClientName  = $state('');
  let fPhone       = $state('');
  let fEventType   = $state('Wedding');
  let fDate        = $state('');
  let fEndDate     = $state('');
  let fStartTime   = $state('09:00');
  let fEndTime     = $state('22:00');
  let fAdvance     = $state(0);
  let fTotal       = $state(0);
  let fNotes       = $state('');
  let fStatus      = $state('Confirmed');
  let fCapacity      = $state(0);   // booked capacity for this event
  let fDiscountType  = $state('none');  // none, percent, amount
  let fDiscountValue = $state(0);

  // Computed final amount
  let fFinalAmount = $derived(() => {
    if (fDiscountType === 'percent') {
      return Math.max(0, fTotal - (fTotal * fDiscountValue / 100));
    } else if (fDiscountType === 'amount') {
      return Math.max(0, fTotal - fDiscountValue);
    }
    return fTotal;
  });

  // View booking detail
  let viewBooking  = $state(null);

  // Toast
  let toastMsg     = $state('');
  let toastVisible = $state(false);
  let toastType    = $state('success');

  // Delete confirm
  let confirmDelete = $state(null);

  const EVENT_TYPES = ['Wedding','Reception','Engagement','Birthday','Corporate','Other'];
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Time slots
  const TIME_SLOTS = [
    '06:00','07:00','08:00','09:00','10:00','11:00','12:00',
    '13:00','14:00','15:00','16:00','17:00','18:00','19:00',
    '20:00','21:00','22:00','23:00','00:00'
  ];

  // ── Derived ───────────────────────────────────────────
  let calendarDays = $derived(() => {
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    return days;
  });

  let monthBookings = $derived(
    bookings.filter(b => {
      const d = new Date(b.date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    })
  );

  let totalRevenue   = $derived(bookings.filter(b=>b.status!=='Cancelled').reduce((s,b)=>s+(b.total_amount||0),0));
  let totalAdvance   = $derived(bookings.filter(b=>b.status!=='Cancelled').reduce((s,b)=>s+(b.advance_paid||0),0));
  let totalPending   = $derived(totalRevenue - totalAdvance);
  let upcomingCount  = $derived(bookings.filter(b=>new Date(b.date)>=new Date()&&b.status==='Confirmed').length);

  // ── Init ──────────────────────────────────────────────
  onMount(async () => {
    bookings = await db.bookings.toArray();
    const savedName = await db.settings.get('hall_name');
    if (savedName) hallName = savedName.value;
    settingHallName = hallName;
    const savedCap = await db.settings.get('hall_capacity');
    if (savedCap) hallCapacity = savedCap.value;
    settingCapacity = hallCapacity;
  });

  // ── Helpers ───────────────────────────────────────────
  function fmt(n) { return '₹' + parseFloat(n||0).toLocaleString('en-IN'); }
  function today() { return new Date().toISOString().split('T')[0]; }
  function dateStr(y, m, d) {
    return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  function isToday(d) {
    const t = new Date();
    return d === dateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function showToast(msg, type='success') {
    toastMsg = msg; toastType = type; toastVisible = true;
    setTimeout(() => toastVisible = false, 3000);
  }
  function prevMonth() {
    if (currentMonth === 0) { currentMonth = 11; currentYear--; }
    else currentMonth--;
  }
  function nextMonth() {
    if (currentMonth === 11) { currentMonth = 0; currentYear++; }
    else currentMonth++;
  }
  function formatTime(t) {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h12  = hour % 12 || 12;
    return `${h12}:${m} ${ampm}`;
  }

  function getDateBookings(day) {
    if (!day) return [];
    const ds = dateStr(currentYear, currentMonth, day);
    return bookings.filter(b => b.date === ds && b.status !== 'Cancelled');
  }

  function getDateStatus(day) {
    if (!day) return null;
    const bs = getDateBookings(day);
    if (bs.length === 0) return 'free';
    return 'booked';
  }

  // ── Settings ──────────────────────────────────────────
  async function saveSettings() {
    if (!settingHallName.trim()) return;
    await db.settings.put({ key: 'hall_name', value: settingHallName.trim() });
    await db.settings.put({ key: 'hall_capacity', value: +settingCapacity });
    hallName = settingHallName.trim();
    hallCapacity = +settingCapacity;
    showSettings = false;
    showToast('✅ Settings saved!');
  }

  // ── Booking CRUD ──────────────────────────────────────
  function openAddForm(date = '') {
    editingId    = null;
    fClientName  = '';
    fPhone       = '';
    fEventType   = 'Wedding';
    fDate        = date || today();
    fEndDate     = date || today();
    fStartTime   = '09:00';
    fEndTime     = '22:00';
    fAdvance       = 0;
    fTotal         = 0;
    fCapacity      = 0;
    fDiscountType  = 'none';
    fDiscountValue = 0;
    fNotes         = '';
    fStatus        = 'Confirmed';
    showForm     = true;
    viewBooking  = null;
  }

  function openEditForm(b) {
    editingId    = b.id;
    fClientName  = b.client_name;
    fPhone       = b.phone || '';
    fEventType   = b.event_type;
    fDate        = b.date;
    fEndDate     = b.end_date || b.date;
    fStartTime   = b.start_time || '09:00';
    fEndTime     = b.end_time   || '22:00';
    fAdvance       = b.advance_paid || 0;
    fTotal         = b.total_amount || 0;
    fCapacity      = b.booked_capacity || 0;
    fDiscountType  = b.discount_type || 'none';
    fDiscountValue = b.discount_value || 0;
    fNotes         = b.notes || '';
    fStatus        = b.status;
    showForm     = true;
    viewBooking  = null;
  }

  async function saveBooking() {
    if (!fClientName.trim()) { showToast('Client name required', 'error'); return; }
    if (!fDate) { showToast('Date required', 'error'); return; }

    const data = {
      client_name:  fClientName.trim(),
      phone:        fPhone,
      event_type:   fEventType,
      date:         fDate,
      end_date:     fEndDate || fDate,
      start_time:   fStartTime,
      end_time:     fEndTime,
      advance_paid:   +fAdvance,
      total_amount:   +fTotal,
      hall_capacity:  hallCapacity,
      booked_capacity: +fCapacity,
      discount_type:  fDiscountType,
      discount_value: +fDiscountValue,
      final_amount:   fFinalAmount(),
      notes:          fNotes,
      status:       fStatus,
      created_at:   today(),
    };

    if (editingId) {
      await db.bookings.update(editingId, data);
      showToast('✅ Booking updated!');
    } else {
      await db.bookings.add(data);
      showToast('✅ Booking added!');
    }

    bookings  = await db.bookings.toArray();
    showForm  = false;
    editingId = null;
  }

  async function deleteBooking(id) {
    await db.bookings.delete(id);
    bookings      = await db.bookings.toArray();
    viewBooking   = null;
    confirmDelete = null;
    showToast('🗑️ Booking deleted', 'error');
  }

  async function cancelBooking(id) {
    await db.bookings.update(id, { status: 'Cancelled' });
    bookings    = await db.bookings.toArray();
    viewBooking = bookings.find(b => b.id === id) || null;
    showToast('Booking cancelled');
  }

  function openBookingDetail(b) {
    viewBooking = b;
    showForm    = false;
  }

  function handleDayClick(day) {
    if (!day) return;
    const ds  = dateStr(currentYear, currentMonth, day);
    const bks = getDateBookings(day);
    if (bks.length > 0) {
      openBookingDetail(bks[0]);
    } else {
      openAddForm(ds);
    }
  }
</script>

<!-- ══ APP ════════════════════════════════════════════ -->
<div class="app">

  <!-- ── TOP BAR ──────────────────────────────────── -->
  <header class="topbar">
    <div class="topbar-left">
      <div class="app-logo">🏛️</div>
      <div>
        <div class="app-name">{hallName}</div>
        <div class="app-sub">Booking Manager</div>
      </div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="icon-top-btn" onclick={() => { settingHallName = hallName; showSettings = true; }}>⚙️</button>
      <button class="add-btn" onclick={() => openAddForm()}>+ Book</button>
    </div>
  </header>

  <!-- ── BOTTOM NAV ───────────────────────────────── -->
  <nav class="bottom-nav">
    <button class="nav-btn" class:active={currentPage==='calendar'} onclick={()=>currentPage='calendar'}>
      <span class="nav-icon">📅</span>
      <span>Calendar</span>
    </button>
    <button class="nav-btn" class:active={currentPage==='bookings'} onclick={()=>currentPage='bookings'}>
      <span class="nav-icon">📋</span>
      <span>Bookings</span>
    </button>
    <button class="nav-btn" class:active={currentPage==='reports'} onclick={()=>currentPage='reports'}>
      <span class="nav-icon">📊</span>
      <span>Reports</span>
    </button>
  </nav>

  <!-- ── MAIN CONTENT ─────────────────────────────── -->
  <main class="main">

    <!-- ══ CALENDAR PAGE ══════════════════════════════ -->
    {#if currentPage === 'calendar'}

      <div class="month-nav">
        <button class="month-btn" onclick={prevMonth}>‹</button>
        <div class="month-title">{MONTHS[currentMonth]} {currentYear}</div>
        <button class="month-btn" onclick={nextMonth}>›</button>
      </div>

      <div class="legend">
        <span class="legend-item"><span class="dot free"></span>Free</span>
        <span class="legend-item"><span class="dot booked"></span>Booked</span>
        <span class="legend-item"><span class="dot today-dot"></span>Today</span>
      </div>

      <div class="cal-grid">
        {#each DAYS as day}
          <div class="cal-day-header">{day}</div>
        {/each}

        {#each calendarDays() as day}
          {#if day === null}
            <div class="cal-cell empty"></div>
          {:else}
            {@const status    = getDateStatus(day)}
            {@const ds        = dateStr(currentYear, currentMonth, day)}
            {@const todayFlag = isToday(ds)}
            {@const dayBks    = getDateBookings(day)}
            <div
              class="cal-cell"
              class:free={status==='free'}
              class:booked={status==='booked'}
              class:is-today={todayFlag}
              onclick={() => handleDayClick(day)}
            >
              <span class="day-num">{day}</span>
              {#if dayBks.length > 0}
                <span class="booking-dot">{dayBks[0].event_type.substring(0,3)}</span>
                {#if dayBks[0].start_time}
                  <span class="time-dot">{formatTime(dayBks[0].start_time)}</span>
                {/if}
              {/if}
            </div>
          {/if}
        {/each}
      </div>

      <div class="month-summary">
        <div class="summary-card booked-card">
          <div class="s-value">{monthBookings.length}</div>
          <div class="s-label">Booked</div>
        </div>
        <div class="summary-card free-card">
          <div class="s-value">{new Date(currentYear, currentMonth+1, 0).getDate() - monthBookings.length}</div>
          <div class="s-label">Free Days</div>
        </div>
      </div>

      {#if monthBookings.length > 0}
        <div class="section-title">This Month's Bookings</div>
        {#each [...monthBookings].sort((a,b)=>a.date.localeCompare(b.date)) as b}
          <div class="booking-card" onclick={() => openBookingDetail(b)}>
            <div class="bc-left">
              <div class="bc-date">{new Date(b.date).getDate()}</div>
              <div class="bc-month">{MONTHS[new Date(b.date).getMonth()].substring(0,3)}</div>
            </div>
            <div class="bc-mid">
              <div class="bc-name">{b.client_name}</div>
              <div class="bc-type">{b.event_type} • {b.phone||'—'}</div>
              {#if b.start_time}
                <div class="bc-time">🕐 {formatTime(b.start_time)} → {formatTime(b.end_time)}</div>
              {/if}
            </div>
            <div class="bc-right">
              <span class="status-badge" class:confirmed={b.status==='Confirmed'} class:cancelled={b.status==='Cancelled'} class:tentative={b.status==='Tentative'}>
                {b.status}
              </span>
            </div>
          </div>
        {/each}
      {/if}

    <!-- ══ BOOKINGS PAGE ══════════════════════════════ -->
    {:else if currentPage === 'bookings'}
      <div class="section-title" style="margin-top:0">All Bookings</div>

      {#if bookings.length === 0}
        <div class="empty-state">
          <div class="empty-icon">📅</div>
          <p>No bookings yet</p>
          <button class="btn-primary" onclick={() => openAddForm()}>Add First Booking</button>
        </div>
      {:else}
        {#each [...bookings].sort((a,b) => b.date.localeCompare(a.date)) as b}
          <div class="booking-card" onclick={() => openBookingDetail(b)}>
            <div class="bc-left">
              <div class="bc-date">{new Date(b.date).getDate()}</div>
              <div class="bc-month">{MONTHS[new Date(b.date).getMonth()].substring(0,3)}</div>
            </div>
            <div class="bc-mid">
              <div class="bc-name">{b.client_name}</div>
              <div class="bc-type">{b.event_type} • {b.phone||'—'}</div>
              {#if b.start_time}
                <div class="bc-time">🕐 {formatTime(b.start_time)} → {formatTime(b.end_time)}</div>
              {/if}
              <div class="bc-amount">{fmt(b.total_amount)} • Adv: {fmt(b.advance_paid)}</div>
            </div>
            <div class="bc-right">
              <span class="status-badge" class:confirmed={b.status==='Confirmed'} class:cancelled={b.status==='Cancelled'} class:tentative={b.status==='Tentative'}>
                {b.status}
              </span>
            </div>
          </div>
        {/each}
      {/if}

    <!-- ══ REPORTS PAGE ═══════════════════════════════ -->
    {:else if currentPage === 'reports'}
      <div class="section-title" style="margin-top:0">Reports — {hallName}</div>

      <div class="report-grid">
        <div class="report-card r-orange">
          <div class="r-icon">🏛️</div>
          <div class="r-value">{bookings.filter(b=>b.status!=='Cancelled').length}</div>
          <div class="r-label">Total Bookings</div>
        </div>
        <div class="report-card r-green">
          <div class="r-icon">📅</div>
          <div class="r-value">{upcomingCount}</div>
          <div class="r-label">Upcoming</div>
        </div>
        <div class="report-card r-blue">
          <div class="r-icon">💰</div>
          <div class="r-value">{fmt(totalRevenue)}</div>
          <div class="r-label">Total Revenue</div>
        </div>
        <div class="report-card r-yellow">
          <div class="r-icon">✅</div>
          <div class="r-value">{fmt(totalAdvance)}</div>
          <div class="r-label">Advance Received</div>
        </div>
        <div class="report-card r-red">
          <div class="r-icon">⏳</div>
          <div class="r-value">{fmt(totalPending)}</div>
          <div class="r-label">Balance Pending</div>
        </div>
        <div class="report-card r-purple">
          <div class="r-icon">❌</div>
          <div class="r-value">{bookings.filter(b=>b.status==='Cancelled').length}</div>
          <div class="r-label">Cancelled</div>
        </div>
      </div>

      <div class="section-title">By Event Type</div>
      {#each EVENT_TYPES as et}
        {@const count = bookings.filter(b=>b.event_type===et&&b.status!=='Cancelled').length}
        {#if count > 0}
          <div class="event-bar">
            <span class="eb-label">{et}</span>
            <div class="eb-track">
              <div class="eb-fill" style="width:{Math.round(count/bookings.length*100)}%"></div>
            </div>
            <span class="eb-count">{count}</span>
          </div>
        {/if}
      {/each}
    {/if}

  </main>

  <!-- ══ SETTINGS SHEET ════════════════════════════════ -->
  {#if showSettings}
    <div class="sheet-overlay" onclick={() => showSettings = false}>
      <div class="sheet" onclick={e => e.stopPropagation()}>
        <div class="sheet-handle"></div>
        <div class="sheet-title">⚙️ Hall Settings</div>

        <div style="margin-top:20px">
          <div class="form-group">
            <label>🏛️ Marriage Hall Name</label>
            <input
              bind:value={settingHallName}
              placeholder="Enter your hall name"
              style="font-size:16px;font-weight:600"
            >
            <div style="font-size:12px;color:#667788;margin-top:4px">
              This name appears at the top of the app
            </div>
          </div>

          <div class="form-group" style="margin-top:14px">
            <label>👥 Hall Maximum Capacity (people)</label>
            <input
              type="number"
              bind:value={settingCapacity}
              placeholder="e.g. 500"
              min="1"
              style="font-size:16px;font-weight:600"
            >
            <div style="font-size:12px;color:#667788;margin-top:4px">
              Used to warn when booking exceeds capacity
            </div>
          </div>

          <div class="preview-box">
            <div style="font-size:11px;color:#667788;margin-bottom:6px">PREVIEW</div>
            <div style="font-size:16px;font-weight:800;color:#1a2332">{settingHallName || 'Hall Name'}</div>
            <div style="font-size:11px;color:#8899aa">Booking Manager</div>
          </div>

          <button class="btn-save-full" onclick={saveSettings}>
            💾 Save Hall Name
          </button>
          <button class="btn-cancel-full" onclick={() => showSettings = false}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ══ BOOKING DETAIL SHEET ══════════════════════════ -->
  {#if viewBooking}
    <div class="sheet-overlay" onclick={() => viewBooking = null}>
      <div class="sheet" onclick={e => e.stopPropagation()}>
        <div class="sheet-handle"></div>

        <div class="sheet-header">
          <div>
            <div class="sheet-title">{viewBooking.client_name}</div>
            <div class="sheet-sub">{viewBooking.event_type}</div>
          </div>
          <span class="status-badge large"
            class:confirmed={viewBooking.status==='Confirmed'}
            class:cancelled={viewBooking.status==='Cancelled'}
            class:tentative={viewBooking.status==='Tentative'}>
            {viewBooking.status}
          </span>
        </div>

        <div class="detail-grid">
          <div class="detail-item">
            <div class="di-label">📅 Date</div>
            <div class="di-value">{new Date(viewBooking.date).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}</div>
          </div>
          {#if viewBooking.end_date && viewBooking.end_date !== viewBooking.date}
            <div class="detail-item">
              <div class="di-label">📅 End Date</div>
              <div class="di-value">{new Date(viewBooking.end_date).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}</div>
            </div>
          {/if}
          {#if viewBooking.start_time}
            <div class="detail-item">
              <div class="di-label">🕐 Start Time</div>
              <div class="di-value">{formatTime(viewBooking.start_time)}</div>
            </div>
            <div class="detail-item">
              <div class="di-label">🕐 End Time</div>
              <div class="di-value">{formatTime(viewBooking.end_time)}</div>
            </div>
          {/if}
          <div class="detail-item">
            <div class="di-label">📞 Phone</div>
            <div class="di-value">{viewBooking.phone || '—'}</div>
          </div>
          {#if viewBooking.booked_capacity > 0}
            {@const cap = viewBooking.hall_capacity || hallCapacity}
            {@const pct = Math.round(viewBooking.booked_capacity / cap * 100)}
            <div class="detail-item full">
              <div class="di-label">👥 Guest Capacity</div>
              <div class="di-value" class:cap-text-over={pct > 100}>
                {viewBooking.booked_capacity} / {cap} guests
                {#if pct > 100}
                  ⚠️ OVER CAPACITY!
                {:else if pct > 70}
                  🟡 {pct}% full
                {:else}
                  🟢 {pct}% full
                {/if}
              </div>
              <div class="cap-bar-track" style="margin-top:8px">
                <div class="cap-bar-fill"
                  class:cap-ok={pct<=70}
                  class:cap-warn={pct>70&&pct<=100}
                  class:cap-over={pct>100}
                  style="width:{Math.min(pct,100)}%">
                </div>
              </div>
            </div>
          {/if}
          <div class="detail-item">
            <div class="di-label">💰 Total Amount</div>
            <div class="di-value green">{fmt(viewBooking.total_amount)}</div>
          </div>
          {#if viewBooking.discount_type && viewBooking.discount_type !== 'none' && viewBooking.discount_value > 0}
            <div class="detail-item">
              <div class="di-label">🏷️ Discount</div>
              <div class="di-value" style="color:#e8a020">
                {viewBooking.discount_type === 'percent' ? viewBooking.discount_value + '%' : fmt(viewBooking.discount_value)}
              </div>
            </div>
            <div class="detail-item">
              <div class="di-label">✨ Final Amount</div>
              <div class="di-value green">{fmt(viewBooking.final_amount)}</div>
            </div>
          {/if}
          <div class="detail-item">
            <div class="di-label">✅ Advance Paid</div>
            <div class="di-value green">{fmt(viewBooking.advance_paid)}</div>
          </div>
          <div class="detail-item">
            <div class="di-label">⏳ Balance Due</div>
            <div class="di-value orange">{fmt((viewBooking.final_amount||viewBooking.total_amount||0)-(viewBooking.advance_paid||0))}</div>
          </div>
          {#if viewBooking.notes}
            <div class="detail-item full">
              <div class="di-label">📝 Notes</div>
              <div class="di-value">{viewBooking.notes}</div>
            </div>
          {/if}
        </div>

        <div class="sheet-actions">
          <button class="btn-edit"   onclick={() => openEditForm(viewBooking)}>✏️ Edit</button>
          {#if viewBooking.status !== 'Cancelled'}
            <button class="btn-cancel" onclick={() => cancelBooking(viewBooking.id)}>🚫 Cancel</button>
          {/if}
          <button class="btn-delete" onclick={() => { confirmDelete = viewBooking.id; }}>🗑️ Delete</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ══ ADD / EDIT FORM SHEET ═════════════════════════ -->
  {#if showForm}
    <div class="sheet-overlay" onclick={() => showForm = false}>
      <div class="sheet form-sheet" onclick={e => e.stopPropagation()}>
        <div class="sheet-handle"></div>
        <div class="sheet-title">{editingId ? '✏️ Edit Booking' : '➕ New Booking'}</div>

        <div class="form-scroll">
          <div class="form-group">
            <label>Client Name *</label>
            <input bind:value={fClientName} placeholder="Sharma Family">
          </div>
          <div class="form-group">
            <label>Phone Number</label>
            <input bind:value={fPhone} type="tel" placeholder="+91 98765 43210">
          </div>
          <div class="form-group">
            <label>Event Type</label>
            <select bind:value={fEventType}>
              {#each EVENT_TYPES as et}<option>{et}</option>{/each}
            </select>
          </div>

          <!-- Dates -->
          <div class="form-row">
            <div class="form-group">
              <label>Start Date *</label>
              <input type="date" bind:value={fDate}>
            </div>
            <div class="form-group">
              <label>End Date</label>
              <input type="date" bind:value={fEndDate}>
            </div>
          </div>

          <!-- Timing -->
          <div class="timing-section">
            <div class="timing-title">🕐 Event Timing</div>
            <div class="form-row">
              <div class="form-group">
                <label>Start Time</label>
                <select bind:value={fStartTime}>
                  {#each TIME_SLOTS as t}
                    <option value={t}>{formatTime(t)}</option>
                  {/each}
                </select>
              </div>
              <div class="form-group">
                <label>End Time</label>
                <select bind:value={fEndTime}>
                  {#each TIME_SLOTS as t}
                    <option value={t}>{formatTime(t)}</option>
                  {/each}
                </select>
              </div>
            </div>
            <div class="time-preview">
              📅 {fDate || 'Date'} &nbsp;|&nbsp; 🕐 {formatTime(fStartTime)} → {formatTime(fEndTime)}
            </div>
          </div>

          <!-- Amount -->
          <div class="form-row">
            <div class="form-group">
              <label>Total Amount (₹)</label>
              <input type="number" bind:value={fTotal} min="0">
            </div>
            <div class="form-group">
              <label>Advance Paid (₹)</label>
              <input type="number" bind:value={fAdvance} min="0">
            </div>
          </div>

          <!-- Capacity Section -->
          <div class="capacity-section">
            <div class="capacity-title">👥 Guest Capacity</div>
            <div class="form-group">
              <label>Number of Guests Booked For</label>
              <input type="number" bind:value={fCapacity} min="0" placeholder="e.g. 200">
            </div>
            {#if fCapacity > 0}
              {@const pct = Math.round(fCapacity / hallCapacity * 100)}
              <div class="capacity-bar-wrap">
                <div class="cap-bar-track">
                  <div class="cap-bar-fill"
                    class:cap-ok={pct <= 70}
                    class:cap-warn={pct > 70 && pct <= 100}
                    class:cap-over={pct > 100}
                    style="width:{Math.min(pct,100)}%">
                  </div>
                </div>
                <div class="cap-info" class:cap-text-over={pct > 100}>
                  {#if pct > 100}
                    ⚠️ OVER CAPACITY! {fCapacity} guests booked but hall holds only {hallCapacity}!
                  {:else if pct > 70}
                    🟡 {fCapacity} / {hallCapacity} guests ({pct}%) — Hall filling up!
                  {:else}
                    🟢 {fCapacity} / {hallCapacity} guests ({pct}%) — Good
                  {/if}
                </div>
              </div>
            {/if}
          </div>

          <!-- Discount Section -->
          <div class="discount-section">
            <div class="discount-title">🏷️ Discount</div>
            <div class="form-row">
              <div class="form-group">
                <label>Discount Type</label>
                <select bind:value={fDiscountType}>
                  <option value="none">No Discount</option>
                  <option value="percent">Percentage (%)</option>
                  <option value="amount">Fixed Amount (₹)</option>
                </select>
              </div>
              {#if fDiscountType !== 'none'}
                <div class="form-group">
                  <label>{fDiscountType === 'percent' ? 'Discount %' : 'Discount ₹'}</label>
                  <input type="number" bind:value={fDiscountValue} min="0"
                    max={fDiscountType === 'percent' ? 100 : fTotal}
                    placeholder={fDiscountType === 'percent' ? 'e.g. 10' : 'e.g. 5000'}>
                </div>
              {/if}
            </div>

            {#if fTotal > 0 && fDiscountType !== 'none' && fDiscountValue > 0}
              <div class="discount-preview">
                <div class="dp-row">
                  <span>Original Amount:</span>
                  <span>{fmt(fTotal)}</span>
                </div>
                <div class="dp-row discount-row">
                  <span>Discount {fDiscountType === 'percent' ? `(${fDiscountValue}%)` : ''}:</span>
                  <span>- {fmt(fDiscountType === 'percent' ? fTotal * fDiscountValue / 100 : fDiscountValue)}</span>
                </div>
                <div class="dp-row final-row">
                  <span>Final Amount:</span>
                  <strong>{fmt(fFinalAmount())}</strong>
                </div>
              </div>
            {/if}
          </div>

          {#if fTotal > 0}
            <div class="balance-preview">
              <span>Balance Due:</span>
              <strong>{fmt(fFinalAmount() - fAdvance)}</strong>
            </div>
          {/if}

          <div class="form-group">
            <label>Status</label>
            <select bind:value={fStatus}>
              <option>Confirmed</option>
              <option>Tentative</option>
              <option>Cancelled</option>
            </select>
          </div>
          <div class="form-group">
            <label>Notes</label>
            <textarea bind:value={fNotes} placeholder="Decorations, catering, special requirements..." rows="3"></textarea>
          </div>

          <button class="btn-save-full" onclick={saveBooking}>
            {editingId ? '💾 Update Booking' : '✅ Save Booking'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ══ DELETE CONFIRM ════════════════════════════════ -->
  {#if confirmDelete}
    <div class="sheet-overlay" onclick={() => confirmDelete = null}>
      <div class="confirm-dialog" onclick={e => e.stopPropagation()}>
        <div class="confirm-icon">⚠️</div>
        <div class="confirm-title">Delete Booking?</div>
        <div class="confirm-sub">This cannot be undone.</div>
        <div class="confirm-btns">
          <button class="btn-no"  onclick={() => confirmDelete = null}>Cancel</button>
          <button class="btn-yes" onclick={() => deleteBooking(confirmDelete)}>Delete</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ══ TOAST ═════════════════════════════════════════ -->
  {#if toastVisible}
    <div class="toast" class:toast-error={toastType==='error'}>{toastMsg}</div>
  {/if}

</div>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

  :global(*) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) {
    font-family: 'Plus Jakarta Sans', sans-serif;
    background: #f0f4f8;
    color: #1a2332;
    max-width: 480px;
    margin: 0 auto;
    min-height: 100vh;
  }

  .app { min-height: 100vh; background: #f0f4f8; padding-bottom: 80px; }

  /* Top Bar */
  .topbar { background: #1a2332; padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 50; }
  .topbar-left { display: flex; align-items: center; gap: 10px; }
  .app-logo { font-size: 28px; }
  .app-name { font-size: 16px; font-weight: 800; color: #fff; }
  .app-sub  { font-size: 11px; color: #8899aa; }
  .add-btn  { background: #e8a020; color: #fff; border: none; border-radius: 8px; padding: 9px 16px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13px; font-weight: 700; cursor: pointer; }
  .icon-top-btn { background: rgba(255,255,255,0.1); border: none; border-radius: 8px; color: #fff; font-size: 18px; width: 38px; height: 38px; cursor: pointer; display: flex; align-items: center; justify-content: center; }

  /* Bottom Nav */
  .bottom-nav { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 480px; background: #fff; border-top: 1px solid #e0e8f0; display: flex; z-index: 50; box-shadow: 0 -4px 20px rgba(0,0,0,0.08); }
  .nav-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 10px 0; border: none; background: none; color: #8899aa; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 11px; font-weight: 600; cursor: pointer; }
  .nav-btn.active { color: #e8a020; }
  .nav-icon { font-size: 20px; }

  /* Main */
  .main { padding: 16px; }

  /* Month Nav */
  .month-nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; background: #fff; border-radius: 12px; padding: 12px 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
  .month-title { font-size: 18px; font-weight: 800; color: #1a2332; }
  .month-btn   { background: #f0f4f8; border: none; border-radius: 8px; width: 36px; height: 36px; font-size: 20px; cursor: pointer; color: #1a2332; font-weight: 700; }

  /* Legend */
  .legend { display: flex; gap: 16px; margin-bottom: 10px; padding: 0 4px; }
  .legend-item { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #667788; font-weight: 500; }
  .dot { width: 10px; height: 10px; border-radius: 50%; }
  .dot.free     { background: #e8f5e9; border: 2px solid #56d364; }
  .dot.booked   { background: #ffeaea; border: 2px solid #e05252; }
  .dot.today-dot{ background: #e8a020; }

  /* Calendar */
  .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; background: #fff; border-radius: 16px; padding: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); margin-bottom: 16px; }
  .cal-day-header { text-align: center; font-size: 11px; font-weight: 700; color: #8899aa; padding: 4px 0 8px; text-transform: uppercase; letter-spacing: .04em; }
  .cal-cell { aspect-ratio: 1; border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s; border: 2px solid transparent; padding: 2px; }
  .cal-cell.empty { cursor: default; }
  .cal-cell.free   { background: #f0faf0; border-color: #c8efd0; }
  .cal-cell.free:hover { background: #d4f5d8; }
  .cal-cell.booked { background: #fff0f0; border-color: #fcc; }
  .cal-cell.booked:hover { background: #ffe0e0; }
  .cal-cell.is-today { background: #e8a020 !important; border-color: #c07010 !important; }
  .cal-cell.is-today .day-num { color: #fff !important; }
  .day-num     { font-size: 13px; font-weight: 700; color: #1a2332; line-height: 1; }
  .booking-dot { font-size: 7px; font-weight: 700; color: #e05252; text-transform: uppercase; }
  .time-dot    { font-size: 6px; color: #e05252; font-weight: 600; }

  /* Month summary */
  .month-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
  .summary-card { border-radius: 12px; padding: 14px; text-align: center; }
  .booked-card { background: #fff0f0; }
  .free-card   { background: #f0faf0; }
  .s-value { font-size: 28px; font-weight: 800; color: #1a2332; }
  .s-label { font-size: 12px; color: #667788; font-weight: 500; margin-top: 2px; }

  /* Section title */
  .section-title { font-size: 14px; font-weight: 800; color: #1a2332; text-transform: uppercase; letter-spacing: .06em; margin: 16px 0 10px; }

  /* Booking card */
  .booking-card { background: #fff; border-radius: 14px; padding: 14px; display: flex; gap: 12px; align-items: center; margin-bottom: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); cursor: pointer; transition: all 0.15s; border: 1px solid #e8eef5; }
  .booking-card:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(0,0,0,0.1); }
  .bc-left  { background: #1a2332; border-radius: 10px; padding: 8px; text-align: center; min-width: 44px; }
  .bc-date  { font-size: 20px; font-weight: 800; color: #fff; line-height: 1; }
  .bc-month { font-size: 10px; color: #8899aa; text-transform: uppercase; font-weight: 700; }
  .bc-mid   { flex: 1; }
  .bc-name  { font-size: 15px; font-weight: 700; color: #1a2332; }
  .bc-type  { font-size: 12px; color: #667788; margin-top: 2px; }
  .bc-time  { font-size: 12px; color: #e8a020; font-weight: 600; margin-top: 2px; }
  .bc-amount{ font-size: 12px; color: #56a820; margin-top: 2px; font-weight: 600; }

  /* Status badge */
  .status-badge { padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  .status-badge.confirmed { background: #e8f5e9; color: #2e7d32; }
  .status-badge.cancelled { background: #ffeaea; color: #c62828; }
  .status-badge.tentative { background: #fff8e1; color: #f57f17; }
  .status-badge.large     { font-size: 13px; padding: 6px 14px; }

  /* Reports */
  .report-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; }
  .report-card { border-radius: 14px; padding: 16px; text-align: center; }
  .r-orange { background: #fff3e0; }
  .r-green  { background: #e8f5e9; }
  .r-blue   { background: #e3f2fd; }
  .r-yellow { background: #fffde7; }
  .r-red    { background: #fce4ec; }
  .r-purple { background: #f3e5f5; }
  .r-icon  { font-size: 24px; margin-bottom: 6px; }
  .r-value { font-size: 20px; font-weight: 800; color: #1a2332; }
  .r-label { font-size: 11px; color: #667788; font-weight: 600; margin-top: 3px; }
  .event-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; background: #fff; border-radius: 10px; padding: 10px 14px; }
  .eb-label { font-size: 13px; font-weight: 600; width: 90px; }
  .eb-track { flex: 1; background: #e8eef5; border-radius: 999px; height: 8px; overflow: hidden; }
  .eb-fill  { height: 100%; background: #e8a020; border-radius: 999px; }
  .eb-count { font-size: 13px; font-weight: 700; color: #1a2332; width: 20px; text-align: right; }

  /* Sheet */
  .sheet-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100; display: flex; align-items: flex-end; justify-content: center; }
  .sheet { background: #fff; border-radius: 20px 20px 0 0; width: 100%; max-width: 480px; padding: 16px 20px 32px; max-height: 92vh; overflow-y: auto; animation: slideUp 0.3s ease; }
  .form-sheet { padding-bottom: 40px; }
  @keyframes slideUp { from{transform:translateY(100%)} to{transform:translateY(0)} }
  .sheet-handle { width: 40px; height: 4px; background: #dde5ee; border-radius: 999px; margin: 0 auto 16px; }
  .sheet-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
  .sheet-title { font-size: 20px; font-weight: 800; color: #1a2332; }
  .sheet-sub   { font-size: 13px; color: #667788; margin-top: 3px; }

  /* Detail grid */
  .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
  .detail-item { background: #f8fafc; border-radius: 10px; padding: 12px; }
  .detail-item.full { grid-column: 1/-1; }
  .di-label { font-size: 11px; color: #8899aa; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
  .di-value { font-size: 14px; font-weight: 700; color: #1a2332; }
  .di-value.green  { color: #2e7d32; }
  .di-value.orange { color: #e65100; }

  /* Sheet actions */
  .sheet-actions { display: flex; gap: 8px; }
  .btn-edit   { flex:1; background:#e3f2fd; color:#1565c0; border:none; border-radius:10px; padding:12px; font-family:'Plus Jakarta Sans',sans-serif; font-size:14px; font-weight:700; cursor:pointer; }
  .btn-cancel { flex:1; background:#fff8e1; color:#f57f17; border:none; border-radius:10px; padding:12px; font-family:'Plus Jakarta Sans',sans-serif; font-size:14px; font-weight:700; cursor:pointer; }
  .btn-delete { flex:1; background:#fce4ec; color:#c62828; border:none; border-radius:10px; padding:12px; font-family:'Plus Jakarta Sans',sans-serif; font-size:14px; font-weight:700; cursor:pointer; }

  /* Form */
  .form-scroll { display: flex; flex-direction: column; gap: 14px; margin-top: 16px; }
  .form-group  { display: flex; flex-direction: column; gap: 6px; }
  .form-row    { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  label { font-size: 12px; font-weight: 700; color: #667788; text-transform: uppercase; letter-spacing: .04em; }
  input, select, textarea { background: #f0f4f8; border: 1.5px solid #e0e8f0; border-radius: 10px; color: #1a2332; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px; padding: 11px 14px; outline: none; transition: border-color 0.15s; width: 100%; }
  input:focus, select:focus, textarea:focus { border-color: #e8a020; }
  textarea { resize: none; }

  /* Timing section */
  .timing-section { background: #fff8e8; border: 1.5px solid #e8a020; border-radius: 12px; padding: 14px; }
  .timing-title   { font-size: 13px; font-weight: 700; color: #e8a020; margin-bottom: 10px; }
  .time-preview   { background: #fff; border-radius: 8px; padding: 10px 12px; font-size: 13px; font-weight: 600; color: #1a2332; margin-top: 10px; text-align: center; border: 1px solid #e8eef5; }

  /* Settings preview */
  .preview-box { background: #1a2332; border-radius: 12px; padding: 14px 16px; margin: 14px 0; }

  .balance-preview { background: #fff8e1; border-radius: 10px; padding: 12px 14px; display: flex; justify-content: space-between; font-size: 14px; color: #e65100; font-weight: 600; }
  .btn-save-full   { background: #1a2332; color: #fff; border: none; border-radius: 12px; padding: 15px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 15px; font-weight: 800; cursor: pointer; width: 100%; margin-top: 4px; }
  .btn-save-full:hover { background: #2a3a52; }
  .btn-cancel-full { background: #f0f4f8; color: #667788; border: none; border-radius: 12px; padding: 13px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px; font-weight: 700; cursor: pointer; width: 100%; margin-top: 8px; }

  /* Delete confirm */
  .confirm-dialog { background: #fff; border-radius: 20px; padding: 28px 24px; margin: 0 20px; text-align: center; width: 100%; max-width: 320px; animation: fadeIn 0.2s ease; }
  @keyframes fadeIn { from{opacity:0;transform:scale(0.95)} to{opacity:1;transform:scale(1)} }
  .confirm-icon  { font-size: 40px; margin-bottom: 12px; }
  .confirm-title { font-size: 20px; font-weight: 800; color: #1a2332; }
  .confirm-sub   { font-size: 14px; color: #8899aa; margin-top: 6px; margin-bottom: 20px; }
  .confirm-btns  { display: flex; gap: 10px; }
  .btn-no  { flex:1; background:#f0f4f8; color:#1a2332; border:none; border-radius:10px; padding:13px; font-family:'Plus Jakarta Sans',sans-serif; font-size:14px; font-weight:700; cursor:pointer; }
  .btn-yes { flex:1; background:#c62828; color:#fff; border:none; border-radius:10px; padding:13px; font-family:'Plus Jakarta Sans',sans-serif; font-size:14px; font-weight:700; cursor:pointer; }

  /* Empty state */
  .empty-state { text-align: center; padding: 60px 20px; color: #8899aa; }
  .empty-icon  { font-size: 48px; margin-bottom: 12px; }
  .empty-state p { font-size: 16px; margin-bottom: 20px; }
  .btn-primary { background: #e8a020; color: #fff; border: none; border-radius: 10px; padding: 12px 24px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px; font-weight: 700; cursor: pointer; }

  /* Toast */
  .toast { position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%); background: #1a2332; color: #fff; padding: 12px 20px; border-radius: 999px; font-size: 13px; font-weight: 600; z-index: 200; white-space: nowrap; animation: fadeIn 0.2s ease; box-shadow: 0 4px 20px rgba(0,0,0,0.2); }
  .toast.toast-error { background: #c62828; }

  /* Discount Section */
  .discount-section { background: #fff8e8; border: 1.5px solid #e8a020; border-radius: 12px; padding: 14px; }
  .discount-title   { font-size: 13px; font-weight: 700; color: #e8a020; margin-bottom: 10px; }
  .discount-preview { background: #fff; border-radius: 10px; padding: 12px; margin-top: 10px; border: 1px solid #e8eef5; }
  .dp-row      { display: flex; justify-content: space-between; font-size: 13px; color: #667788; padding: 4px 0; }
  .discount-row{ color: #e05252; font-weight: 600; }
  .final-row   { color: #1a2332; font-weight: 800; font-size: 15px; border-top: 1px solid #e8eef5; margin-top: 6px; padding-top: 8px; }


  /* Capacity Section */
  .capacity-section  { background: #e8f5e9; border: 1.5px solid #56d364; border-radius: 12px; padding: 14px; }
  .capacity-title    { font-size: 13px; font-weight: 700; color: #2e7d32; margin-bottom: 10px; }
  .capacity-bar-wrap { margin-top: 10px; }
  .cap-bar-track     { background: #e0e8f0; border-radius: 999px; height: 10px; overflow: hidden; width: 100%; }
  .cap-bar-fill      { height: 100%; border-radius: 999px; transition: width 0.4s; }
  .cap-bar-fill.cap-ok   { background: #56d364; }
  .cap-bar-fill.cap-warn { background: #e8a020; }
  .cap-bar-fill.cap-over { background: #e05252; }
  .cap-info          { font-size: 12px; font-weight: 600; color: #667788; margin-top: 6px; }
  .cap-text-over     { color: #c62828 !important; font-weight: 800 !important; }

</style>