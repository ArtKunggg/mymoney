/* เงินของฉัน — จดรายจ่ายและหนี้ผ่อนเป็นงวด
 * Everything lives in this browser's localStorage (key below): no server, no account.
 * Amounts are stored in satang (integers) so sums never drift.
 * Reminders: iPhone web apps can't schedule notifications on their own, so each debt can export
 * its remaining due dates as an .ics file -> the iPhone Calendar app does the alerting. */
(() => {
  'use strict';

  const KEY = 'mymoney.v1';
  const CATS = [
    ['food', '🍜', 'อาหาร'], ['travel', '🚗', 'เดินทาง'], ['bills', '💡', 'บิล/ค่าน้ำไฟ'], ['shop', '🛍️', 'ช้อปปิ้ง'],
    ['health', '💊', 'สุขภาพ'], ['fun', '🎮', 'บันเทิง'], ['debt', '💳', 'ผ่อนชำระ'], ['other', '📦', 'อื่นๆ'],
  ];
  const CAT = Object.fromEntries(CATS.map(([id, ico, name]) => [id, { ico, name }]));
  const SOON_DAYS = 5;

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const view = $('#view');
  const sheet = $('#sheet');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ------------------------------------------------------------ money & dates
  const baht = (satang) => '฿' + (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: satang % 100 ? 2 : 0, maximumFractionDigits: 2 });
  const toSatang = (v) => {
    const n = Number(String(v).replace(/[,\s฿]/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  };
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => iso(new Date());
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d || 1); };
  const monthOf = (s) => s.slice(0, 7);
  const thisMonth = () => today().slice(0, 7);
  const addMonths = (ym, k) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const monthName = (ym) => parse(ym + '-01').toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
  const dateLong = (s) => parse(s).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' });
  const dateShort = (s) => parse(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

  // ------------------------------------------------------------ storage
  // v1 stored a debt's installment amount (`per`); v2 stores the whole amount owed (`amount`) and
  // derives each installment from it. Old data and old backup files are converted on the way in.
  function migrate(d) {
    d.debts.forEach((x) => {
      if (typeof x.amount !== 'number' && typeof x.per === 'number') x.amount = x.per * x.total;
      delete x.per;
      x.payments = x.payments || [];
    });
    d.v = 2;
    return d;
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && Array.isArray(d.expenses) && Array.isArray(d.debts)) return migrate(d);
    } catch (e) { /* unreadable: start empty */ }
    return { v: 2, expenses: [], debts: [], lastBackup: null };
  }
  let db = load();
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
      return true;
    } catch (e) {
      toast('บันทึกไม่สำเร็จ — พื้นที่เก็บข้อมูลเต็ม หรือเบราว์เซอร์ไม่อนุญาต', 5000);
      return false;
    }
  }
  // Ask the browser not to clear our data under storage pressure (granted silently or not at all).
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // ------------------------------------------------------------ debts (monthly installments)
  // A debt: name, amount (satang owed in total), total (installments), paid (installments done),
  // day (due day of month), start ('YYYY-MM' of installment #1), payments [{n, date, amount}].
  // Installments split the amount evenly; the last one takes the leftover satang.
  // A debt with kind 'flex' has no schedule: amount owed, opening (paid before it was entered),
  // and payments [{date, amount}] of any size; progress is shown as a percentage.
  function dueDate(debt, n) {                         // date of installment n (1-based)
    const ym = addMonths(debt.start, n - 1);
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return `${ym}-${pad(Math.min(debt.day, last))}`;
  }
  const baseOf = (d) => Math.floor(d.amount / d.total);
  const perOf = (d, n) => (n >= d.total ? d.amount - baseOf(d) * (d.total - 1) : baseOf(d));
  // installments marked paid when the debt was entered count at their planned amount
  const isFlex = (d) => d.kind === 'flex';
  const paymentsSum = (d) => (d.payments || []).reduce((s, p) => s + p.amount, 0);
  const paidAmount = (d) => (isFlex(d) ? (d.opening || 0) + paymentsSum(d)
    : paymentsSum(d) + Math.max(0, d.paid - (d.payments || []).length) * baseOf(d));
  const remaining = (d) => Math.max(0, d.amount - paidAmount(d));
  const isDone = (d) => (isFlex(d) ? remaining(d) <= 0 : d.paid >= d.total || remaining(d) <= 0);
  const nextDue = (d) => (isFlex(d) || isDone(d) ? null : dueDate(d, d.paid + 1));
  // whole percent paid, rounded down so an unfinished debt never reads 100%
  const pctPaid = (d) => (isDone(d) ? 100 : Math.min(99, Math.floor((paidAmount(d) / d.amount) * 100)));
  const nextAmount = (d) => Math.min(perOf(d, d.paid + 1), remaining(d));
  function dueStatus(date) {
    const k = daysBetween(today(), date);
    if (k < 0) return { cls: 'red', text: `เลยกำหนด ${-k} วัน`, k };
    if (k === 0) return { cls: 'red', text: 'ครบกำหนดวันนี้', k };
    if (k <= SOON_DAYS) return { cls: 'amber', text: `อีก ${k} วัน`, k };
    return { cls: 'gray', text: `อีก ${k} วัน`, k };
  }

  // ------------------------------------------------------------ router
  function route() {
    const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
    const params = new URLSearchParams(query || '');
    const tab = path.split('/')[0] || 'home';
    $$('.tabs a').forEach((a) => a.classList.toggle('is-on', a.dataset.tab === tab));
    window.scrollTo(0, 0);
    if (tab === 'expenses') return renderExpenses(params.get('m') || thisMonth());
    if (tab === 'debts') return renderDebts();
    if (tab === 'settings') return renderSettings();
    renderHome();
  }
  window.addEventListener('hashchange', route);

  const setTitle = (t) => { $('#title').textContent = t; document.title = t === 'เงินของฉัน' ? t : `${t} — เงินของฉัน`; };
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  // ------------------------------------------------------------ home
  function renderHome() {
    setTitle('เงินของฉัน');
    const m = thisMonth();
    const spent = sum(db.expenses.filter((e) => monthOf(e.date) === m));
    const lastSpent = sum(db.expenses.filter((e) => monthOf(e.date) === addMonths(m, -1)));
    const open = db.debts.filter((d) => !isDone(d));
    const owed = open.reduce((s, d) => s + remaining(d), 0);
    const upcoming = open.filter((d) => !isFlex(d)).map((d) => ({ d, date: nextDue(d) }))
      .filter((x) => daysBetween(today(), x.date) <= 14)
      .sort((a, b) => a.date.localeCompare(b.date));
    const hasData = db.expenses.length || db.debts.length;
    const backupAge = db.lastBackup ? daysBetween(db.lastBackup.slice(0, 10), today()) : null;

    view.innerHTML = `
      ${standalone() ? '' : `<div class="notice notice--warn"><b>ติดตั้งลงหน้าจอโฮมก่อนใช้งานจริง</b>
        ใน Safari กดปุ่มแชร์ (สี่เหลี่ยมมีลูกศรชี้ขึ้น) → “เพิ่มไปยังหน้าจอโฮม” ถ้าใช้ผ่านเบราว์เซอร์อย่างเดียว iPhone อาจลบข้อมูลเมื่อไม่ได้เปิดนานๆ</div>`}
      ${hasData && (backupAge === null || backupAge > 30) ? `<div class="notice notice--info"><b>${backupAge === null ? 'ยังไม่เคยสำรองข้อมูล' : `สำรองข้อมูลล่าสุด ${backupAge} วันที่แล้ว`}</b>
        ข้อมูลอยู่ในเครื่องนี้เครื่องเดียว — <a href="#/settings">สำรองเก็บไว้ใน iCloud Drive</a> กันหาย</div>` : ''}
      <div class="stats">
        <section class="card"><h2>ใช้ไปเดือนนี้</h2><div class="big num">${baht(spent)}</div>
          <div class="sub">${lastSpent ? `เดือนก่อน ${baht(lastSpent)}` : monthName(m)}</div></section>
        <section class="card"><h2>หนี้คงเหลือ</h2><div class="big num">${baht(owed)}</div>
          <div class="sub">${open.length ? `${open.length} รายการ` : 'ไม่มีหนี้ค้าง 🎉'}</div></section>
      </div>
      <section class="card" style="margin-top:12px">
        <h2>ต้องจ่ายใน 14 วันนี้</h2>
        ${upcoming.length ? upcoming.map(({ d, date }) => {
          const st = dueStatus(date);
          return `<div class="due">
            <div class="item__main"><div class="item__title">${esc(d.name)}</div>
              <div class="item__sub">งวด ${d.paid + 1}/${d.total} · ${dateShort(date)} · <span class="chip chip--${st.cls}">${st.text}</span></div></div>
            <div style="text-align:right"><div class="item__amt">${baht(nextAmount(d))}</div>
              <button class="btn btn--small btn--primary" data-pay="${d.id}" style="margin-top:6px">จ่ายแล้ว</button></div>
          </div>`;
        }).join('') : `<div class="empty" style="padding:12px"><b>✅</b>${open.length ? 'ยังไม่มีงวดที่ต้องจ่ายใน 2 สัปดาห์นี้' : 'ยังไม่มีหนี้ที่บันทึกไว้'}</div>`}
      </section>
      <section class="card">
        <div class="row row--between"><h2 style="margin:0">รายจ่ายล่าสุด</h2><a href="#/expenses" class="sub">ดูทั้งหมด</a></div>
        ${expenseList(db.expenses.slice().sort(byNewest).slice(0, 5), false) || '<div class="empty"><b>🧾</b>ยังไม่มีรายจ่าย กด + เพื่อจด</div>'}
      </section>
      <button class="fab" data-add-expense aria-label="จดรายจ่าย">+</button>`;
  }

  const sum = (list) => list.reduce((s, e) => s + e.amount, 0);
  const byNewest = (a, b) => b.date.localeCompare(a.date) || (b.ts || 0) - (a.ts || 0);

  function expenseList(list, groupByDay = true) {
    if (!list.length) return '';
    let html = '';
    let day = '';
    for (const e of list) {
      if (groupByDay && e.date !== day) {
        day = e.date;
        const dayTotal = sum(list.filter((x) => x.date === day));
        html += `<div class="day row row--between"><span>${dateLong(day)}</span><span class="num">${baht(dayTotal)}</span></div>`;
      }
      const c = CAT[e.cat] || CAT.other;
      html += `<button class="item" data-edit-expense="${e.id}">
        <span class="item__ico" aria-hidden="true">${c.ico}</span>
        <span class="item__main"><span class="item__title">${esc(e.note || c.name)}</span>
          <span class="item__sub">${esc(c.name)}${groupByDay ? '' : ` · ${dateShort(e.date)}`}</span></span>
        <span class="item__amt">${baht(e.amount)}</span></button>`;
    }
    return `<div class="list">${html}</div>`;
  }

  // ------------------------------------------------------------ expenses
  function renderExpenses(m) {
    setTitle('รายจ่าย');
    const list = db.expenses.filter((e) => monthOf(e.date) === m).sort(byNewest);
    const total = sum(list);
    const byCat = CATS.map(([id, ico, name]) => ({ id, ico, name, amt: sum(list.filter((e) => e.cat === id)) }))
      .filter((c) => c.amt > 0).sort((a, b) => b.amt - a.amt);
    const next = addMonths(m, 1);
    view.innerHTML = `
      <div class="month">
        <a class="btn" href="#/expenses?m=${addMonths(m, -1)}" aria-label="เดือนก่อน">‹</a>
        <b>${monthName(m)}</b>
        ${next <= thisMonth() ? `<a class="btn" href="#/expenses?m=${next}" aria-label="เดือนถัดไป">›</a>` : '<span style="width:44px"></span>'}
      </div>
      <section class="card">
        <h2>รวมทั้งเดือน</h2><div class="big num">${baht(total)}</div>
        <div class="sub">${list.length} รายการ</div>
        ${byCat.length ? `<div class="cats">${byCat.map((c) => `
          <div class="row row--between"><span>${c.ico} ${c.name}</span><span class="num">${baht(c.amt)} · ${Math.round((c.amt / total) * 100)}%</span></div>
          <div class="bar"><i style="width:${Math.max(2, (c.amt / byCat[0].amt) * 100)}%"></i></div>`).join('')}</div>` : ''}
      </section>
      <section class="card">${expenseList(list) || '<div class="empty"><b>🧾</b>เดือนนี้ยังไม่มีรายจ่าย</div>'}</section>
      <button class="fab" data-add-expense aria-label="จดรายจ่าย">+</button>`;
  }

  function expenseForm(e) {
    const editing = Boolean(e);
    e = e || { date: today(), cat: 'food', amount: 0, note: '' };
    openSheet(`
      <h2 id="sheet-title">${editing ? 'แก้ไขรายจ่าย' : 'จดรายจ่าย'}</h2>
      <label class="field"><span>จำนวนเงิน (บาท)</span>
        <input class="input input--amount" name="amount" inputmode="decimal" autocomplete="off" required
          value="${e.amount ? e.amount / 100 : ''}" placeholder="0"></label>
      <div class="field"><span>หมวด</span><div class="cats-pick">${CATS.map(([id, ico, name]) => `
        <label><input type="radio" name="cat" value="${id}" ${e.cat === id ? 'checked' : ''}><span><i>${ico}</i>${name}</span></label>`).join('')}</div></div>
      <div class="two">
        <label class="field"><span>วันที่</span><input class="input" type="date" name="date" value="${e.date}" max="${today()}" required></label>
        <label class="field"><span>บันทึก</span><input class="input" name="note" value="${esc(e.note)}" placeholder="เช่น ข้าวกลางวัน" maxlength="80"></label>
      </div>
      <div class="actions">
        ${editing ? '<button class="btn btn--danger" type="button" data-delete>ลบ</button>' : '<button class="btn" type="button" data-close>ยกเลิก</button>'}
        <button class="btn btn--primary" type="submit">บันทึก</button>
      </div>`, (form) => {
      const amount = toSatang(form.amount.value);
      if (!amount) return 'ใส่จำนวนเงินมากกว่า 0';
      const data = { amount, cat: form.cat.value, date: form.date.value || today(), note: form.note.value.trim() };
      if (editing) Object.assign(db.expenses.find((x) => x.id === e.id), data);
      else db.expenses.push({ id: uid(), ts: Date.now(), ...data });
      save();
      toast(editing ? 'แก้ไขแล้ว' : `จดแล้ว ${baht(amount)}`);
    }, editing ? () => {
      if (!confirm('ลบรายจ่ายนี้?')) return false;
      db.expenses = db.expenses.filter((x) => x.id !== e.id);
      save();
      toast('ลบแล้ว');
    } : null);
    if (!editing) setTimeout(() => sheet.querySelector('[name=amount]').focus(), 50);
  }

  // ------------------------------------------------------------ debts
  function renderDebts() {
    setTitle('หนี้');
    // scheduled debts first, soonest due first; then the ones without installments
    const open = db.debts.filter((d) => !isDone(d))
      .sort((a, b) => isFlex(a) - isFlex(b) || (nextDue(a) || '').localeCompare(nextDue(b) || ''));
    const done = db.debts.filter(isDone);
    view.innerHTML = `
      ${open.length ? open.map((d) => (isFlex(d) ? flexCard(d) : debtCard(d))).join('') : '<section class="card"><div class="empty"><b>💳</b>ยังไม่มีหนี้ที่บันทึกไว้<br>กด “เพิ่มหนี้” เพื่อเริ่ม</div></section>'}
      <button class="btn btn--primary btn--block" data-add-debt>+ เพิ่มหนี้</button>
      ${done.length ? `<section class="card" style="margin-top:12px"><h2>ปิดหนี้แล้ว 🎉</h2><div class="list">${done.map((d) => `
        <button class="item" data-edit-debt="${d.id}"><span class="item__ico" aria-hidden="true">✅</span>
          <span class="item__main"><span class="item__title">${esc(d.name)}</span><span class="item__sub">${baht(d.amount)} · ${isFlex(d) ? 'ไม่มีงวด' : `${d.total} งวด`}</span></span></button>`).join('')}</div></section>` : ''}`;
  }

  function debtCard(d) {
    const due = nextDue(d);
    const st = dueStatus(due);
    return `<section class="card debt">
      <div class="row row--between"><div><h3>${esc(d.name)}</h3>${d.note ? `<div class="sub">${esc(d.note)}</div>` : ''}</div>
        <span class="chip chip--${st.cls}">${st.text}</span></div>
      <div class="facts">
        <div><span class="sub">งวดถัดไป</span><b>${dateShort(due)}</b></div>
        <div><span class="sub">งวดนี้</span><b>${baht(nextAmount(d))}</b></div>
        <div><span class="sub">จ่ายแล้ว</span><b>${d.paid}/${d.total} งวด</b></div>
        <div><span class="sub">คงเหลือ</span><b>${baht(remaining(d))}</b></div>
      </div>
      <div class="sub" style="margin:-4px 0 8px">ยอดหนี้ทั้งหมด ${baht(d.amount)} · จ่ายไปแล้ว ${baht(paidAmount(d))}</div>
      <div class="bar"><i style="width:${Math.min(100, (paidAmount(d) / d.amount) * 100)}%"></i></div>
      <div class="actions">
        <button class="btn btn--small btn--primary" data-pay="${d.id}">จ่ายงวด ${d.paid + 1} แล้ว</button>
        <button class="btn btn--small" data-ics="${d.id}">📅 เพิ่มลงปฏิทิน</button>
        <button class="btn btn--small" data-edit-debt="${d.id}">แก้ไข</button>
      </div>
    </section>`;
  }

  function flexCard(d) {
    const p = pctPaid(d);
    return `<section class="card debt">
      <div class="row row--between"><div><h3>${esc(d.name)}</h3>${d.note ? `<div class="sub">${esc(d.note)}</div>` : ''}</div>
        <span class="chip chip--gray">ไม่มีงวด</span></div>
      <div class="pct"><b class="big num">${p}%</b><span class="sub">จ่ายไปแล้ว</span></div>
      <div class="bar bar--lg" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><i style="width:${p}%"></i></div>
      <div class="facts">
        <div><span class="sub">จ่ายไปแล้ว</span><b>${baht(paidAmount(d))}</b></div>
        <div><span class="sub">คงเหลือ</span><b>${baht(remaining(d))}</b></div>
      </div>
      <div class="sub" style="margin:-4px 0 0">ยอดหนี้ทั้งหมด ${baht(d.amount)}</div>
      <div class="actions">
        <button class="btn btn--small btn--primary" data-pay="${d.id}">💸 จ่ายเพิ่ม</button>
        <button class="btn btn--small" data-edit-debt="${d.id}">แก้ไข</button>
      </div>
    </section>`;
  }

  // New debts start with a choice of type; switching keeps the name typed so far.
  const kindPick = (kind) => `<div class="seg" role="group" aria-label="ประเภทหนี้">
      <button type="button" data-kind="plan" aria-pressed="${kind === 'plan'}">📅 ผ่อนเป็นงวด</button>
      <button type="button" data-kind="flex" aria-pressed="${kind === 'flex'}">📊 ไม่มีงวด</button></div>`;
  function bindKindPick() {
    $$('[data-kind]', sheet).forEach((b) => b.addEventListener('click', () => {
      const name = $('form', sheet).elements.name.value;
      (b.dataset.kind === 'flex' ? flexForm : debtForm)(null, name);
    }));
  }
  function bindUndo(d) {
    const undo = sheet.querySelector('[data-undo-pay]');
    if (undo) undo.addEventListener('click', () => {
      const real = db.debts.find((x) => x.id === d.id);
      const p = real.payments.pop();
      if (!isFlex(real)) real.paid = Math.max(0, real.paid - 1);
      if (p && p.expenseId) db.expenses = db.expenses.filter((e) => e.id !== p.expenseId);
      save();
      closeSheet();
      toast(isFlex(real) ? `ยกเลิกการจ่าย ${p ? baht(p.amount) : ''} แล้ว` : `ยกเลิกงวด ${p ? p.n : ''} แล้ว`);
      route();
    });
  }

  function flexForm(d, preName = '') {
    const editing = Boolean(d);
    d = d || { kind: 'flex', name: preName, amount: 0, opening: 0, payments: [], note: '' };
    const logged = paymentsSum(d);
    const last = editing && d.payments.length ? d.payments[d.payments.length - 1] : null;
    openSheet(`
      <h2 id="sheet-title">${editing ? 'แก้ไขหนี้' : 'เพิ่มหนี้'}</h2>
      ${editing ? '' : kindPick('flex')}
      <label class="field"><span>ชื่อรายการ</span><input class="input" name="name" value="${esc(d.name)}" required maxlength="60" placeholder="เช่น ยืมเพื่อน, ค้างบัตรเครดิต"></label>
      <label class="field"><span>ยอดหนี้ทั้งหมด (บาท)</span><input class="input input--amount" name="amount" inputmode="decimal" required value="${d.amount ? d.amount / 100 : ''}" placeholder="0"></label>
      <label class="field"><span>จ่ายไปแล้วรวม (บาท)</span><input class="input" name="paidSoFar" inputmode="decimal" value="${paidAmount(d) ? paidAmount(d) / 100 : ''}" placeholder="0">
        <small>${editing ? 'รวมทุกครั้งที่จ่ายมา แก้ตัวเลขนี้ได้ถ้าไม่ตรง' : 'ถ้ายังไม่เคยจ่าย เว้นว่างไว้'}</small></label>
      <p class="notice notice--info" data-pct-hint style="margin-top:-4px"></p>
      <label class="field"><span>หมายเหตุ</span><input class="input" name="note" value="${esc(d.note)}" maxlength="80" placeholder="ไม่ใส่ก็ได้"></label>
      ${last ? `<p class="sub">จ่ายล่าสุด: ${baht(last.amount)} เมื่อ ${dateShort(last.date)}
        <button class="btn btn--small" type="button" data-undo-pay style="margin-left:6px">ยกเลิกครั้งล่าสุด</button></p>` : ''}
      <div class="actions">
        ${editing ? '<button class="btn btn--danger" type="button" data-delete>ลบหนี้</button>' : '<button class="btn" type="button" data-close>ยกเลิก</button>'}
        <button class="btn btn--primary" type="submit">บันทึก</button>
      </div>`, (form) => {
      const amount = toSatang(form.amount.value);
      const paid = toSatang(form.paidSoFar.value);
      if (!form.name.value.trim()) return 'ใส่ชื่อรายการ';
      if (!amount) return 'ใส่ยอดหนี้ทั้งหมดมากกว่า 0';
      if (paid > amount) return 'ยอดที่จ่ายแล้วมากกว่ายอดหนี้ทั้งหมด';
      // payments logged through "จ่ายเพิ่ม" stay; the typed total adjusts what was paid before them
      if (paid < logged) return `ยอดจ่ายแล้วต้องไม่น้อยกว่าที่บันทึกการจ่ายไว้ (${baht(logged)})`;
      const data = { kind: 'flex', name: form.name.value.trim(), amount, opening: paid - logged, note: form.note.value.trim() };
      if (editing) Object.assign(db.debts.find((x) => x.id === d.id), data);
      else db.debts.push({ id: uid(), payments: [], ...data });
      save();
      toast(editing ? 'แก้ไขแล้ว' : 'เพิ่มหนี้แล้ว');
    }, editing ? () => {
      if (!confirm(`ลบ “${d.name}” และประวัติการจ่ายของหนี้นี้?`)) return false;
      db.debts = db.debts.filter((x) => x.id !== d.id);
      save();
      toast('ลบแล้ว');
    } : null);
    const f = $('form', sheet).elements;
    const hint = sheet.querySelector('[data-pct-hint]');
    const showPct = () => {
      const amount = toSatang(f.amount.value);
      if (!amount) { hint.hidden = true; return; }
      const fake = { kind: 'flex', amount, opening: toSatang(f.paidSoFar.value), payments: [] };
      hint.hidden = false;
      hint.textContent = `จ่ายไปแล้ว ${pctPaid(fake)}% · คงเหลือ ${baht(remaining(fake))}`;
    };
    ['amount', 'paidSoFar'].forEach((k) => f[k].addEventListener('input', showPct));
    showPct();
    if (!editing) bindKindPick();
    bindUndo(d);
  }

  function flexPayForm(d) {
    openSheet(`
      <h2 id="sheet-title">จ่าย ${esc(d.name)}</h2>
      <p class="sub" style="margin:-6px 0 14px">คงเหลือ ${baht(remaining(d))} · จ่ายไปแล้ว ${pctPaid(d)}%</p>
      <label class="field"><span>จ่ายไป (บาท)</span><input class="input input--amount" name="amount" inputmode="decimal" required placeholder="0"></label>
      <label class="field"><span>วันที่จ่าย</span><input class="input" type="date" name="date" value="${today()}" max="${today()}" required></label>
      <label class="check"><input type="checkbox" name="asExpense" checked><span>บันทึกเป็นรายจ่ายด้วย (หมวด “ผ่อนชำระ”)</span></label>
      <div class="actions"><button class="btn" type="button" data-close>ยกเลิก</button><button class="btn btn--primary" type="submit">ยืนยันจ่ายแล้ว</button></div>`, (form) => {
      const amount = toSatang(form.amount.value);
      const real = db.debts.find((x) => x.id === d.id);
      if (!amount) return 'ใส่จำนวนเงินมากกว่า 0';
      if (amount > remaining(real)) return `จ่ายเกินยอดคงเหลือ (${baht(remaining(real))})`;
      const date = form.date.value || today();
      const pay = { date, amount };
      if (form.asExpense.checked) {
        const ex = { id: uid(), ts: Date.now(), amount, cat: 'debt', date, note: `จ่ายหนี้ ${real.name}` };
        db.expenses.push(ex);
        pay.expenseId = ex.id;
      }
      real.payments = real.payments || [];
      real.payments.push(pay);
      save();
      toast(isDone(real) ? `🎉 ปิดหนี้ “${real.name}” ครบแล้ว!` : `บันทึกแล้ว · จ่ายไป ${pctPaid(real)}% · คงเหลือ ${baht(remaining(real))}`, 4000);
    });
    setTimeout(() => sheet.querySelector('[name=amount]').focus(), 50);
  }

  function debtForm(d, preName = '') {
    const editing = Boolean(d);
    if (editing && isFlex(d)) return flexForm(d);
    d = d || { name: preName, amount: 0, total: 10, paid: 0, day: new Date().getDate(), start: thisMonth(), note: '' };
    // the date the user sees is the *next* installment's (or the last one's, for a finished debt)
    const shownN = Math.min(d.paid + 1, d.total);
    openSheet(`
      <h2 id="sheet-title">${editing ? 'แก้ไขหนี้' : 'เพิ่มหนี้'}</h2>
      ${editing ? '' : kindPick('plan')}
      <label class="field"><span>ชื่อรายการ</span><input class="input" name="name" value="${esc(d.name)}" required maxlength="60" placeholder="เช่น ผ่อนโทรศัพท์, บัตรเครดิต KTC"></label>
      <label class="field"><span>ยอดหนี้ทั้งหมด (บาท)</span><input class="input input--amount" name="amount" inputmode="decimal" required value="${d.amount ? d.amount / 100 : ''}" placeholder="0">
        <small>ยอดรวมที่ต้องผ่อนจนจบ (รวมดอกเบี้ยแล้ว ถ้ามี)</small></label>
      <div class="two">
        <label class="field"><span>จำนวนงวด</span><input class="input" name="total" type="number" inputmode="numeric" min="1" max="600" required value="${d.total}"></label>
        <label class="field"><span>จ่ายไปแล้ว (งวด)</span><input class="input" name="paid" type="number" inputmode="numeric" min="0" max="600" value="${d.paid}"></label>
      </div>
      <p class="notice notice--info" data-per-hint style="margin-top:-4px"></p>
      <label class="field"><span>${d.paid >= d.total && editing ? 'งวดสุดท้ายครบกำหนดวันที่' : 'งวดถัดไปครบกำหนดวันที่'}</span>
        <input class="input" name="next" type="date" required value="${editing ? dueDate(d, shownN) : today()}">
        <small>งวดต่อๆ ไปครบกำหนดวันที่เดียวกันทุกเดือน (เดือนที่ไม่มีวันนั้น ใช้วันสุดท้ายของเดือน)</small></label>
      <label class="field"><span>หมายเหตุ</span><input class="input" name="note" value="${esc(d.note)}" maxlength="80" placeholder="ไม่ใส่ก็ได้"></label>
      ${editing && d.payments && d.payments.length ? `<p class="sub">จ่ายล่าสุด: งวด ${d.payments[d.payments.length - 1].n} เมื่อ ${dateShort(d.payments[d.payments.length - 1].date)}
        <button class="btn btn--small" type="button" data-undo-pay style="margin-left:6px">ยกเลิกงวดล่าสุด</button></p>` : ''}
      <div class="actions">
        ${editing ? '<button class="btn btn--danger" type="button" data-delete>ลบหนี้</button>' : '<button class="btn" type="button" data-close>ยกเลิก</button>'}
        <button class="btn btn--primary" type="submit">บันทึก</button>
      </div>`, (form) => {
      const amount = toSatang(form.amount.value);
      const total = Math.round(Number(form.total.value));
      const paid = Math.round(Number(form.paid.value) || 0);
      const next = form.next.value;
      if (!form.name.value.trim()) return 'ใส่ชื่อรายการ';
      if (!amount) return 'ใส่ยอดหนี้ทั้งหมดมากกว่า 0';
      if (!(total >= 1 && total <= 600)) return 'จำนวนงวดต้องอยู่ระหว่าง 1–600';
      if (amount < total) return 'ยอดหนี้น้อยเกินไปสำหรับจำนวนงวดนี้';
      if (!(paid >= 0 && paid <= total)) return 'งวดที่จ่ายแล้วต้องไม่เกินจำนวนงวดทั้งหมด';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return 'เลือกวันครบกำหนด';
      // back from the shown installment to installment #1's month
      const start = addMonths(next.slice(0, 7), -(Math.min(paid + 1, total) - 1));
      const data = { name: form.name.value.trim(), amount, total, paid, day: Number(next.slice(8, 10)), start, note: form.note.value.trim() };
      if (editing) Object.assign(db.debts.find((x) => x.id === d.id), data);
      else db.debts.push({ id: uid(), payments: [], ...data });
      save();
      toast(editing ? 'แก้ไขแล้ว' : 'เพิ่มหนี้แล้ว — กด “เพิ่มลงปฏิทิน” ให้ iPhone เตือนก่อนครบกำหนด', editing ? 2500 : 5000);
    }, editing ? () => {
      if (!confirm(`ลบ “${d.name}” และประวัติการจ่ายของหนี้นี้?`)) return false;
      db.debts = db.debts.filter((x) => x.id !== d.id);
      save();
      toast('ลบแล้ว');
    } : null);
    // live "งวดละ ฿x" while typing the amount and the number of installments
    const f = $('form', sheet).elements;
    const hint = sheet.querySelector('[data-per-hint]');
    const showPer = () => {
      const amount = toSatang(f.amount.value);
      const total = Math.round(Number(f.total.value));
      if (!amount || !(total >= 1)) { hint.hidden = true; return; }
      const fake = { amount, total, paid: Math.round(Number(f.paid.value) || 0), payments: [] };
      const base = baseOf(fake);
      const last = perOf(fake, total);
      hint.hidden = false;
      hint.textContent = `ตกงวดละ ${baht(base)}${last !== base ? ` (งวดสุดท้าย ${baht(last)})` : ''}`
        + (fake.paid ? ` · คงเหลือ ${baht(remaining(fake))}` : '');
    };
    ['amount', 'total', 'paid'].forEach((k) => f[k].addEventListener('input', showPer));
    showPer();
    if (!editing) bindKindPick();
    bindUndo(d);
  }

  function payForm(d) {
    if (isFlex(d)) return flexPayForm(d);
    const n = d.paid + 1;
    openSheet(`
      <h2 id="sheet-title">จ่าย ${esc(d.name)} งวด ${n}/${d.total}</h2>
      <p class="sub" style="margin:-6px 0 14px">ครบกำหนด ${dateLong(dueDate(d, n))}</p>
      <label class="field"><span>จ่ายไป (บาท)</span><input class="input input--amount" name="amount" inputmode="decimal" value="${nextAmount(d) / 100}" required></label>
      <label class="field"><span>วันที่จ่าย</span><input class="input" type="date" name="date" value="${today()}" max="${today()}" required></label>
      <label class="check"><input type="checkbox" name="asExpense" checked><span>บันทึกเป็นรายจ่ายด้วย (หมวด “ผ่อนชำระ”)</span></label>
      <div class="actions"><button class="btn" type="button" data-close>ยกเลิก</button><button class="btn btn--primary" type="submit">ยืนยันจ่ายแล้ว</button></div>`, (form) => {
      const amount = toSatang(form.amount.value);
      if (!amount) return 'ใส่จำนวนเงินมากกว่า 0';
      const date = form.date.value || today();
      const real = db.debts.find((x) => x.id === d.id);
      const pay = { n, date, amount };
      if (form.asExpense.checked) {
        const ex = { id: uid(), ts: Date.now(), amount, cat: 'debt', date, note: `${real.name} งวด ${n}/${real.total}` };
        db.expenses.push(ex);
        pay.expenseId = ex.id;
      }
      real.payments = real.payments || [];
      real.payments.push(pay);
      real.paid = Math.min(real.total, real.paid + 1);
      save();
      toast(isDone(real) ? `🎉 ปิดหนี้ “${real.name}” ครบแล้ว!` : `บันทึกงวด ${n} แล้ว · คงเหลือ ${baht(remaining(real))}`, 4000);
    });
  }

  // ------------------------------------------------------------ calendar (.ics)
  // One all-day event per remaining installment, two alerts each (09:00 the day before, 09:00 on
  // the day). Opening the file on iPhone offers "Add All" to the Calendar app.
  function icsFor(d) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const ical = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MyMoney//TH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    for (let n = d.paid + 1; n <= d.total; n++) {
      const day = dueDate(d, n).replace(/-/g, '');
      const end = iso(new Date(parse(dueDate(d, n)).getTime() + 86400000)).replace(/-/g, '');
      lines.push('BEGIN:VEVENT', `UID:${d.id}-${n}@mymoney`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${end}`,
        `SUMMARY:${ical(`💳 จ่าย ${d.name} งวด ${n}/${d.total} (${baht(perOf(d, n))})`)}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${ical(`พรุ่งนี้ครบกำหนด ${d.name}`)}`, 'TRIGGER:-PT15H', 'END:VALARM',
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${ical(`วันนี้ครบกำหนด ${d.name}`)}`, 'TRIGGER:PT9H', 'END:VALARM',
        'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  async function shareFile(name, type, text) {
    const file = new File([text], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') return false;    // the user closed the share sheet
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  }

  // ------------------------------------------------------------ settings & backup
  function renderSettings() {
    setTitle('ตั้งค่า');
    const bytes = new Blob([localStorage.getItem(KEY) || '']).size;
    view.innerHTML = `
      <section class="card"><h2>สำรองข้อมูล</h2>
        <p class="sub" style="margin-top:0">ข้อมูลทั้งหมดอยู่ใน iPhone เครื่องนี้เท่านั้น ไม่มีการส่งขึ้นอินเทอร์เน็ต
          ถ้าลบแอปหรือเปลี่ยนเครื่อง ข้อมูลจะหาย — สำรองเป็นไฟล์แล้ว “บันทึกไปยังไฟล์” (iCloud Drive) เก็บไว้</p>
        <p class="sub">สำรองล่าสุด: ${db.lastBackup ? dateLong(db.lastBackup.slice(0, 10)) : 'ยังไม่เคย'} · ${db.expenses.length} รายจ่าย · ${db.debts.length} หนี้ · ${(bytes / 1024).toFixed(1)} KB</p>
        <button class="btn btn--primary btn--block" data-backup>💾 สำรองข้อมูล (ไฟล์ .json)</button>
        <label class="btn btn--block" style="margin-top:8px">📂 กู้คืนจากไฟล์สำรอง<input type="file" accept="application/json,.json" data-restore hidden></label>
      </section>
      <section class="card"><h2>ส่งออก</h2>
        <button class="btn btn--block" data-csv>📊 รายจ่ายทั้งหมดเป็น CSV (เปิดใน Numbers/Excel)</button></section>
      <section class="card"><h2>ล้างข้อมูล</h2>
        <button class="btn btn--danger btn--block" data-wipe>ลบข้อมูลทั้งหมดในเครื่องนี้</button></section>
      <p class="sub" style="text-align:center">เงินของฉัน · ใช้งานออฟไลน์ได้ · ข้อมูลอยู่ในเครื่องนี้</p>`;
  }

  async function backup() {
    const now = new Date().toISOString();
    // the file carries its own date, so a restored phone doesn't nag for a backup it just came from
    const ok = await shareFile(`mymoney-backup-${today()}.json`, 'application/json', JSON.stringify({ ...db, lastBackup: now, exportedAt: now }, null, 1));
    if (!ok) return;
    db.lastBackup = now;
    save();
    toast('สำรองข้อมูลแล้ว');
    route();
  }

  function restore(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || !Array.isArray(d.expenses) || !Array.isArray(d.debts)) throw new Error('bad');
        const ok = d.expenses.every((e) => e && typeof e.amount === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
          && d.debts.every((x) => x && (x.kind === 'flex' ? typeof x.amount === 'number'
            : (typeof x.amount === 'number' || typeof x.per === 'number') && typeof x.total === 'number' && /^\d{4}-\d{2}$/.test(x.start)));
        if (!ok) throw new Error('bad');
        if (!confirm(`กู้คืน ${d.expenses.length} รายจ่าย และ ${d.debts.length} หนี้?\nข้อมูลปัจจุบันในเครื่องจะถูกแทนที่`)) return;
        db = migrate({ v: 2, expenses: d.expenses, debts: d.debts, lastBackup: d.lastBackup || d.exportedAt || null });
        save();
        toast('กู้คืนข้อมูลแล้ว');
        location.hash = '#/';
        route();
      } catch (e) {
        toast('ไฟล์นี้ไม่ใช่ไฟล์สำรองของแอปนี้', 4000);
      }
    };
    r.readAsText(file);
  }

  function csv() {
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = [['วันที่', 'หมวด', 'จำนวนเงิน', 'บันทึก'].map(q).join(',')];
    db.expenses.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((e) => {
      rows.push([e.date, (CAT[e.cat] || CAT.other).name, (e.amount / 100).toFixed(2), e.note || ''].map(q).join(','));
    });
    shareFile(`mymoney-expenses-${today()}.csv`, 'text/csv', '﻿' + rows.join('\r\n'));   // BOM: Thai in Excel
  }

  // ------------------------------------------------------------ sheet (dialog) helpers
  let onDelete = null;
  function openSheet(html, onSubmit, deleteFn) {
    sheet.innerHTML = `<form novalidate>${html}<p class="sub" data-error style="color:var(--red)"></p></form>`;
    const form = $('form', sheet);
    onDelete = deleteFn;
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const err = onSubmit(form.elements);
      if (typeof err === 'string') { $('[data-error]', form).textContent = err; return; }
      closeSheet();
      route();
    });
    if (!sheet.open) sheet.showModal();
  }
  function closeSheet() { if (sheet.open) sheet.close(); }
  sheet.addEventListener('click', (ev) => {
    if (ev.target === sheet || ev.target.closest('[data-close]')) return closeSheet();
    if (ev.target.closest('[data-delete]') && onDelete) {
      if (onDelete() === false) return;
      closeSheet();
      route();
    }
  });

  let toastTimer = 0;
  function toast(msg, ms = 2500) {
    let el = $('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), ms);
  }

  // ------------------------------------------------------------ actions (one listener for everything)
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('button, [data-add-expense]');
    if (!t || sheet.contains(t)) return;
    const find = (id) => db.debts.find((d) => d.id === id);
    if (t.matches('[data-add-expense]')) return expenseForm();
    if (t.dataset.editExpense) return expenseForm(db.expenses.find((e) => e.id === t.dataset.editExpense));
    if (t.matches('[data-add-debt]')) return debtForm();
    if (t.dataset.editDebt) return debtForm(find(t.dataset.editDebt));
    if (t.dataset.pay) return payForm(find(t.dataset.pay));
    if (t.dataset.ics) {
      const d = find(t.dataset.ics);
      shareFile(`${d.name.replace(/[\\/:*?"<>|]+/g, '_')}-งวด.ics`, 'text/calendar', icsFor(d));
      return toast('เปิดไฟล์แล้วกด “เพิ่มทั้งหมด” เพื่อลงปฏิทิน iPhone', 5000);
    }
    if (t.matches('[data-backup]')) return backup();
    if (t.matches('[data-csv]')) return csv();
    if (t.matches('[data-wipe]')) {
      if (!confirm('ลบรายจ่ายและหนี้ทั้งหมดในเครื่องนี้? กู้คืนไม่ได้ถ้าไม่ได้สำรองไว้')) return;
      db = { v: 2, expenses: [], debts: [], lastBackup: null };
      save();
      toast('ลบข้อมูลทั้งหมดแล้ว');
      location.hash = '#/';
      route();
    }
  });
  document.addEventListener('change', (ev) => {
    if (ev.target.matches('[data-restore]') && ev.target.files[0]) restore(ev.target.files[0]);
  });

  // ------------------------------------------------------------ offline
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  // for tests in the browser console
  window.__mymoney = { icsFor, dueDate, perOf, pctPaid, get db() { return db; } };
  route();
})();
