// ==UserScript==
// @name         CNKI 检索增强
// @name:zh-CN   CNKI 检索增强
// @name:en      CNKI Advanced Search Workbench
// @namespace    https://cnki-tools.local/userscript
// @version      2.0.0
// @description  提供高级检索输入留存、新建检索页、检索策略记录与专业检索一键填充能力
// @description:zh-CN 提供高级检索输入留存、新建检索页、检索策略记录与专业检索一键填充能力
// @description:en Persist advanced-search draft, open clean new search page, and manage reusable search strategies.
// @author       shujuecn + Codex
// @icon         https://www.cnki.net/favicon.ico
// @homepageURL  https://kns.cnki.net/
// @license      GPL3
// @match        *://*/kns8s/AdvSearch*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY = "cnki_adv_enhancer_v1";
  const SESSION_DRAFT_KEY = "cnki_adv_enhancer_draft_v1";
  const HISTORY_LIMIT = 80;
  const PANEL_ID = "cnki-adv-history-panel";
  const NEW_TAB_BTN_CLASS = "cnki-new-tab-search-btn";
  const AUTO_COLLAPSE_ON_SEARCH = false;

  let store = loadStore();
  let saveDraftTimer = null;
  let layoutBound = false;

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { history: [], pending: null, collapsed: false };
      }
      const data = JSON.parse(raw);
      return {
        history: Array.isArray(data.history) ? data.history : [],
        pending: data.pending || null,
        collapsed: Boolean(data.collapsed),
      };
    } catch (_) {
      return { history: [], pending: null, collapsed: false };
    }
  }

  function saveStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (_) {
      // Ignore storage errors.
    }
  }

  function saveDraft(snapshot) {
    try {
      sessionStorage.setItem(SESSION_DRAFT_KEY, JSON.stringify(snapshot));
    } catch (_) {
      // Ignore storage errors.
    }
  }

  function loadDraft() {
    try {
      const raw = sessionStorage.getItem(SESSION_DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function safeText(el) {
    return el ? (el.textContent || "").trim() : "";
  }

  function nowString(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i += 1) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h.toString(16);
  }

  function parseCount(value) {
    if (value == null) return null;
    const n = String(value).replace(/[^\d]/g, "");
    if (!n) return null;
    const num = Number(n);
    return Number.isFinite(num) ? num : null;
  }

  function getResultCount() {
    const hidden = $("#totalCnt");
    if (hidden && hidden.value) {
      return parseCount(hidden.value);
    }
    const em = $(".pagerTitleCell em");
    return parseCount(safeText(em));
  }

  function getCurrentClassId() {
    return ($("#classid") && $("#classid").value) || "";
  }

  function getCurrentResource() {
    return ($("#resource") && $("#resource").value) || "";
  }

  function getActiveType() {
    const active = $(".search-classify-menu li.active[name]");
    return active ? active.getAttribute("name") : "";
  }

  function getGradeRows() {
    return $all("#gradetxt > dd").filter((dd) =>
      dd.querySelector(".input-box input[type='text']"),
    );
  }

  function collectCheckboxState() {
    const state = {};
    $all(".extend-indent-labels input[type='checkbox']").forEach((cb) => {
      const key = `${cb.getAttribute("name") || ""}|${cb.value || ""}|${cb.getAttribute("data-id") || ""}`;
      state[key] = cb.checked;
    });
    return state;
  }

  function collectAdvancedState() {
    const rows = getGradeRows().map((dd) => {
      const input = $("input[type='text']", dd);
      const fieldSpan = $(".sort.reopt .sort-default > span", dd);
      const matchSpan = $(".sort.special .sort-default > span", dd);
      const logicSpan = $(".sort.logical .sort-default > span", dd);
      return {
        field:
          (fieldSpan &&
            (fieldSpan.getAttribute("value") ||
              fieldSpan.getAttribute("data-value"))) ||
          "",
        fieldText: safeText(fieldSpan),
        match: (matchSpan && matchSpan.getAttribute("value")) || "=",
        matchText: safeText(matchSpan),
        logic:
          (logicSpan &&
            (logicSpan.getAttribute("value") || safeText(logicSpan))) ||
          "AND",
        value: input ? input.value : "",
      };
    });

    const updateActive = $(".tit-dropdown-box .sort-list li.cur a");
    return {
      createdAt: Date.now(),
      classid: getCurrentClassId(),
      resource: getCurrentResource(),
      rows,
      ext: {
        checkbox: collectCheckboxState(),
        dateStart: ($("#datebox0") && $("#datebox0").value) || "",
        dateEnd: ($("#datebox1") && $("#datebox1").value) || "",
        updateRangeValue: updateActive
          ? updateActive.getAttribute("value") || ""
          : "",
      },
    };
  }

  function normalizeTerm(term) {
    const t = (term || "").trim();
    if (!t) return "";
    if (/^['"].*['"]$/.test(t)) return t;
    if (/[*+\-()]/.test(t)) return t;
    return `'${t.replace(/'/g, "\\'")}'`;
  }

  function buildProfessionalExpression(rows) {
    const valid = (rows || []).filter((r) => (r.value || "").trim());
    if (!valid.length) return "";
    const clauses = [];
    valid.forEach((row, idx) => {
      const field = row.field || row.fieldText || "SU";
      const op = row.match === "%" ? "%=" : "=";
      const clause = `${field} ${op} ${normalizeTerm(row.value)}`;
      if (idx === 0) {
        clauses.push(clause);
      } else {
        const logic = (row.logic || "AND").toUpperCase();
        clauses.push(`${logic} ${clause}`);
      }
    });
    return clauses.join(" ");
  }

  function buildSummary(rows) {
    const valid = (rows || []).filter((r) => (r.value || "").trim());
    if (!valid.length) return "（空检索）";
    return valid
      .map((row, idx) => {
        const label = row.fieldText || row.field || "字段";
        const match = row.match === "%" ? "模糊" : "精确";
        if (idx === 0) return `${label}(${match})：${row.value}`;
        return `${(row.logic || "AND").toUpperCase()} ${label}(${match})：${row.value}`;
      })
      .join(" ");
  }

  function dispatchInputEvents(el) {
    if (!el) return;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function clickElement(el) {
    if (!el) return false;
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  }

  function setDropdownByValue(sortRoot, value, isField) {
    if (!sortRoot || !value) return false;
    const defaultSpan = $(".sort-default > span", sortRoot);
    const list = $(".sort-list", sortRoot);
    if (isField) {
      const li = $all(".sort-list li", sortRoot).find(
        (x) => (x.getAttribute("data-val") || "") === value,
      );
      if (!li) return false;
      $all(".sort-list li", sortRoot).forEach((x) => x.classList.remove("cur"));
      li.classList.add("cur");
      const a = $("a", li);
      if (defaultSpan) {
        defaultSpan.setAttribute("value", value);
        defaultSpan.setAttribute("data-value", value);
        if (a) defaultSpan.textContent = safeText(a);
      }
      if (list) list.style.display = "none";
      return true;
    } else {
      const a = $all(".sort-list a", sortRoot).find(
        (x) => (x.getAttribute("value") || "") === value,
      );
      if (!a) return false;
      const li = a.closest("li");
      $all(".sort-list li", sortRoot).forEach((x) => x.classList.remove("cur"));
      if (li) li.classList.add("cur");
      if (defaultSpan) {
        defaultSpan.setAttribute("value", value);
        defaultSpan.textContent = safeText(a);
      }
      if (list) list.style.display = "none";
      return true;
    }
  }

  function ensureRowCount(targetCount) {
    let rows = getGradeRows();
    let guard = 0;
    while (rows.length < targetCount && guard < 20) {
      const addBtn = $("#gradetxt a.add-group");
      if (!addBtn) break;
      clickElement(addBtn);
      rows = getGradeRows();
      guard += 1;
    }
    guard = 0;
    while (rows.length > targetCount && guard < 20) {
      const delBtns = $all("#gradetxt a.del-group");
      const delBtn = delBtns[delBtns.length - 1];
      if (!delBtn) break;
      clickElement(delBtn);
      rows = getGradeRows();
      guard += 1;
    }
  }

  function applyCheckboxState(state) {
    if (!state) return;
    $all(".extend-indent-labels input[type='checkbox']").forEach((cb) => {
      const key = `${cb.getAttribute("name") || ""}|${cb.value || ""}|${cb.getAttribute("data-id") || ""}`;
      if (Object.prototype.hasOwnProperty.call(state, key)) {
        cb.checked = Boolean(state[key]);
        dispatchInputEvents(cb);
      }
    });
  }

  function applyAdvancedState(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.rows)) return false;
    const rowsData = snapshot.rows;
    ensureRowCount(rowsData.length);
    const rows = getGradeRows();
    rowsData.forEach((data, idx) => {
      const dd = rows[idx];
      if (!dd) return;
      setDropdownByValue($(".sort.reopt", dd), data.field, true);
      setDropdownByValue($(".sort.special", dd), data.match, false);
      if (idx > 0)
        setDropdownByValue(
          $(".sort.logical", dd),
          (data.logic || "AND").toUpperCase(),
          false,
        );
      const input = $("input[type='text']", dd);
      if (input) {
        input.value = data.value || "";
        dispatchInputEvents(input);
      }
    });

    if (snapshot.ext) {
      const d0 = $("#datebox0");
      const d1 = $("#datebox1");
      if (d0 && typeof snapshot.ext.dateStart === "string") {
        d0.value = snapshot.ext.dateStart;
        dispatchInputEvents(d0);
      }
      if (d1 && typeof snapshot.ext.dateEnd === "string") {
        d1.value = snapshot.ext.dateEnd;
        dispatchInputEvents(d1);
      }
      if (snapshot.ext.updateRangeValue != null) {
        const sortRoot = $(".tit-dropdown-box .sort");
        if (sortRoot) {
          setDropdownByValue(sortRoot, snapshot.ext.updateRangeValue, false);
        }
      }
      applyCheckboxState(snapshot.ext.checkbox);
    }
    return true;
  }

  function fillMajorExpression(expression) {
    const textarea =
      $("textarea.textarea-major.majorSearch") || $("textarea.majorSearch");
    if (!textarea) return false;
    textarea.value = expression || "";
    dispatchInputEvents(textarea);
    textarea.focus();
    return true;
  }

  function switchToSearchType(typeName, cb) {
    const li = $(`.search-classify-menu li[name='${typeName}']`);
    if (!li) return;
    if (!li.classList.contains("active")) {
      clickElement(li);
    }
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (getActiveType() === typeName || tries > 15) {
        clearInterval(timer);
        if (typeof cb === "function") cb();
      }
    }, 80);
  }

  function saveDraftDebounced() {
    if (saveDraftTimer) clearTimeout(saveDraftTimer);
    saveDraftTimer = setTimeout(() => {
      saveDraft(collectAdvancedState());
    }, 180);
  }

  function restoreDraftWithRetry() {
    const draft = loadDraft();
    if (!draft) return;
    const currentClassId = getCurrentClassId();
    if (draft.classid && currentClassId && draft.classid !== currentClassId)
      return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (getActiveType() !== "gradeSearch") {
        clearInterval(timer);
        return;
      }
      const ok = applyAdvancedState(draft);
      if (ok || attempts > 8) {
        const sortLists = $all("#ModuleSearch .sort-list");
        sortLists.forEach((x) => {
          x.style.display = "none";
        });
        clearInterval(timer);
      }
    }, 120);
  }

  function addHistoryRecord(record) {
    store.history = store.history.filter((x) => x.id !== record.id);
    store.history.unshift(record);
    if (store.history.length > HISTORY_LIMIT) {
      store.history = store.history.slice(0, HISTORY_LIMIT);
    }
    saveStore();
    renderPanel();
  }

  function preparePendingFromCurrent() {
    const snapshot = collectAdvancedState();
    const expression = buildProfessionalExpression(snapshot.rows);
    if (!expression) return;
    const pending = {
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      classid: snapshot.classid,
      resource: snapshot.resource,
      expression,
      expressionHash: simpleHash(expression),
      summary: buildSummary(snapshot.rows),
      snapshot,
      baselineCount: getResultCount(),
    };
    store.pending = pending;
    saveStore();
  }

  function tryCommitPending(requireHashMatch) {
    const pending = store.pending;
    if (!pending) return;
    if (Date.now() - pending.createdAt > 15 * 60 * 1000) {
      store.pending = null;
      saveStore();
      return;
    }
    const currentSnapshot = collectAdvancedState();
    const currentExpression = buildProfessionalExpression(currentSnapshot.rows);
    const hashMatch = simpleHash(currentExpression) === pending.expressionHash;
    if (requireHashMatch && !hashMatch) return;
    const count = getResultCount();
    addHistoryRecord({
      id: pending.id,
      createdAt: pending.createdAt,
      classid: pending.classid,
      resource: pending.resource,
      expression: pending.expression,
      summary: pending.summary,
      count,
      snapshot: pending.snapshot,
    });
    store.pending = null;
    saveStore();
  }

  function injectStyle() {
    if ($("#cnki-adv-enhancer-style")) return;
    const css = `
      #ModuleSearch .search-classify {
        position: relative;
      }
      #ModuleSearch .cnki-new-tab-slot {
        position: absolute;
        left: 0;
        top: 0;
        height: var(--cnki-tab-height, 43px);
        display: flex;
        align-items: center;
        z-index: 3;
      }
      #ModuleSearch .cnki-new-tab-slot .${NEW_TAB_BTN_CLASS} {
        display: block;
        height: var(--cnki-tab-height, 43px);
        padding: 0 20px;
        min-width: 106px;
        border-left: 1px solid #eef1f6;
        color: #004fd9;
        text-align: center;
        font-size: 15px;
        line-height: var(--cnki-tab-height, 43px);
        text-decoration: none;
        background: #f8fafc;
        box-sizing: border-box;
      }
      #ModuleSearch .cnki-new-tab-slot .${NEW_TAB_BTN_CLASS}:hover {
        color: #004fd9;
        filter: brightness(0.98);
      }
      #${PANEL_ID} {
        margin: 12px 0 14px;
        width: 100%;
        max-width: var(--cnki-search-content-width, 1200px);
        box-sizing: border-box;
        padding: 10px 12px;
        border: 1px solid #d9e1ef;
        border-radius: 8px;
        background: #ffffff;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
        margin-left: auto;
        margin-right: auto;
      }
      #${PANEL_ID} .cnki-adv-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
        padding: 2px 0 8px;
        border-bottom: 1px solid #edf1f7;
      }
      #${PANEL_ID} .cnki-adv-toolbar-left {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        font-size: 14px;
        font-weight: 600;
        color: #2f3742;
      }
      #${PANEL_ID} .cnki-adv-toggle {
        font-weight: 500;
        color: #1677ff;
        text-decoration: none;
      }
      #${PANEL_ID} .cnki-adv-toggle:hover {
        color: #0958d9;
      }
      #${PANEL_ID} .cnki-adv-toolbar-right {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      #${PANEL_ID} .cnki-adv-toolbar-right button {
        border: 1px solid #ced7e4;
        border-radius: 5px;
        background: #f8fafd;
        color: #2f3742;
        padding: 4px 10px;
        font-size: 12px;
        cursor: pointer;
      }
      #${PANEL_ID} .cnki-adv-toolbar-right button:hover {
        border-color: #9ab2da;
        background: #eff4ff;
      }
      #${PANEL_ID} .cnki-adv-list-wrap {
        margin-top: 10px;
      }
      #${PANEL_ID}.is-collapsed .cnki-adv-list-wrap {
        display: none;
      }
      #${PANEL_ID} .cnki-adv-head,
      #${PANEL_ID} .cnki-adv-item {
        display: grid;
        grid-template-columns: 154px 100px minmax(220px, 1fr) minmax(220px, 1fr) 210px;
        gap: 10px;
        align-items: start;
      }
      #${PANEL_ID} .cnki-adv-head {
        padding: 8px 10px;
        border: 1px solid #dfe6f1;
        border-bottom: none;
        border-radius: 6px 6px 0 0;
        background: #f6f8fc;
        color: #000000;
        font-size: 12px;
        font-weight: 600;
      }
      #${PANEL_ID} .cnki-adv-list {
        border: 1px solid #dfe6f1;
        border-radius: 0 0 6px 6px;
        background: #ffffff;
      }
      #${PANEL_ID} .cnki-adv-item {
        padding: 9px 10px;
        border-top: 1px solid #edf1f7;
      }
      #${PANEL_ID} .cnki-adv-item:first-child {
        border-top: none;
      }
      #${PANEL_ID} .cnki-adv-cell {
        color: #2f3742;
        font-size: 12px;
        line-height: 1.4;
      }
      #${PANEL_ID} .cnki-adv-cell-time,
      #${PANEL_ID} .cnki-adv-cell-count {
        color: #000000;
      }
      #${PANEL_ID} .cnki-adv-cell-summary {
        font-weight: 600;
        word-break: break-word;
      }
      #${PANEL_ID} .cnki-adv-cell-expression {
        color: #435063;
        word-break: break-all;
      }
      #${PANEL_ID} .cnki-adv-cell-actions {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      #${PANEL_ID} .cnki-adv-cell-actions button {
        border: 1px solid #ced7e4;
        border-radius: 5px;
        background: #fff;
        color: #2f3742;
        padding: 2px 8px;
        font-size: 12px;
        cursor: pointer;
      }
      #${PANEL_ID} .cnki-adv-cell-actions button:hover {
        border-color: #98afd8;
        background: #f2f6ff;
      }
      #${PANEL_ID} .cnki-adv-empty {
        padding: 18px 10px;
        color: #7a8495;
        font-size: 13px;
      }
      @media (max-width: 1280px) {
        #${PANEL_ID} .cnki-adv-head,
        #${PANEL_ID} .cnki-adv-item {
          grid-template-columns: 130px 80px minmax(180px, 1fr) minmax(180px, 1fr) 180px;
        }
      }
      @media (max-width: 1100px) {
        #${PANEL_ID} .cnki-adv-head {
          display: none;
        }
        #${PANEL_ID} .cnki-adv-item {
          grid-template-columns: 1fr;
          gap: 6px;
        }
      }
    `;
    const style = document.createElement("style");
    style.id = "cnki-adv-enhancer-style";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildNewTabUrl() {
    return `${location.origin}/kns8s/AdvSearch`;
  }

  function positionNewTabSlot() {
    const menu = $(".search-classify-menu");
    const slot = $(".cnki-new-tab-slot");
    if (!menu || !slot) return;
    const host = menu.parentElement;
    if (!host) return;
    const tabs = $all("li[name]:not([style*='display:none'])", menu);
    const lastTab = tabs[tabs.length - 1];
    if (!lastTab) return;
    const hostRect = host.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const tabRect = lastTab.getBoundingClientRect();
    const left = Math.max(0, Math.round(tabRect.right - hostRect.left));
    const top = Math.max(0, Math.round(menuRect.top - hostRect.top));
    const height = Math.max(1, Math.round(menuRect.height));
    slot.style.left = `${left}px`;
    slot.style.top = `${top}px`;
    slot.style.setProperty("--cnki-tab-height", `${height}px`);
  }

  function syncPanelWidth() {
    const panel = $(`#${PANEL_ID}`);
    const content = $("#ModuleSearch .search-box > .content");
    if (!panel || !content) return;
    const width = Math.round(content.getBoundingClientRect().width);
    if (width > 0) {
      panel.style.setProperty("--cnki-search-content-width", `${width}px`);
    }
  }

  function syncLayout() {
    positionNewTabSlot();
    syncPanelWidth();
  }

  function insertNewTabButton() {
    const menu = $(".search-classify-menu");
    if (!menu) return;
    const host = menu.parentElement;
    if (!host) return;
    let slot = $(".cnki-new-tab-slot", host);
    if (!slot) {
      slot = document.createElement("div");
      slot.className = "cnki-new-tab-slot";
      menu.insertAdjacentElement("afterend", slot);
    }
    if ($(`.${NEW_TAB_BTN_CLASS}`, slot)) {
      syncLayout();
      return;
    }
    const link = document.createElement("a");
    link.className = NEW_TAB_BTN_CLASS;
    link.href = "javascript:void(0)";
    link.title = "打开新的空白高级检索页面";
    link.textContent = "新建检索页";
    link.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      window.open(buildNewTabUrl(), "_blank", "noopener,noreferrer");
    });
    slot.appendChild(link);
    syncLayout();
  }

  function buildPanelHtml() {
    return `
      <div class="cnki-adv-toolbar">
        <div class="cnki-adv-toolbar-left">
          <span>检索策略</span>
          <a href="javascript:void(0)" class="cnki-adv-toggle" data-action="toggle"></a>
          <span id="cnki-adv-count"></span>
        </div>
        <div class="cnki-adv-toolbar-right">
          <button type="button" data-action="fill-latest-major">最近策略填充</button>
          <button type="button" data-action="clear-all">清空记录</button>
        </div>
      </div>
      <div class="cnki-adv-list-wrap">
        <div class="cnki-adv-head">
          <div>检索时间</div>
          <div>结果数</div>
          <div>高级检索式</div>
          <div>专业检索式</div>
          <div>操作</div>
        </div>
        <div class="cnki-adv-list" id="cnki-adv-list"></div>
      </div>
    `;
  }

  function ensurePanel() {
    const anchor = $("#ModuleSearch .search-box") || $("#ModuleSearch");
    if (!anchor) return;
    let panel = $(`#${PANEL_ID}`);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      panel.innerHTML = buildPanelHtml();
      anchor.insertAdjacentElement("afterend", panel);
      panel.addEventListener("click", onPanelClick);
    }
    renderPanel();
  }

  function renderPanel() {
    const panel = $(`#${PANEL_ID}`);
    if (!panel) return;
    panel.classList.toggle("is-collapsed", !!store.collapsed);
    const toggleBtn = $("[data-action='toggle']", panel);
    if (toggleBtn) toggleBtn.textContent = store.collapsed ? "展开" : "收起";
    const countEl = $("#cnki-adv-count", panel);
    if (countEl) countEl.textContent = `已存 ${store.history.length} 条`;

    const list = $("#cnki-adv-list", panel);
    if (!list) return;
    if (!store.history.length) {
      list.innerHTML = `<div class="cnki-adv-empty">暂无检索策略记录</div>`;
      return;
    }
    list.innerHTML = store.history
      .map((item) => {
        const countText =
          item.count == null
            ? "—"
            : `${Number(item.count).toLocaleString()} 条`;
        return `
          <div class="cnki-adv-item" data-id="${item.id}">
            <div class="cnki-adv-cell cnki-adv-cell-time">${nowString(item.createdAt)}</div>
            <div class="cnki-adv-cell cnki-adv-cell-count">${countText}</div>
            <div class="cnki-adv-cell cnki-adv-cell-summary" title="${escapeHtml(item.summary || "")}">
              ${escapeHtml(item.summary || "")}
            </div>
            <div class="cnki-adv-cell cnki-adv-cell-expression" title="${escapeHtml(item.expression || "")}">
              ${escapeHtml(item.expression || "")}
            </div>
            <div class="cnki-adv-cell cnki-adv-cell-actions">
              <button type="button" data-action="restore">回填高级</button>
              <button type="button" data-action="fill-major">填入专业</button>
              <button type="button" data-action="delete">删除</button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function onPanelClick(evt) {
    const btn = evt.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    if (action === "toggle") {
      store.collapsed = !store.collapsed;
      saveStore();
      renderPanel();
      return;
    }
    if (action === "clear-all") {
      store.history = [];
      saveStore();
      renderPanel();
      return;
    }
    if (action === "fill-latest-major") {
      const latest = store.history[0];
      if (!latest) return;
      switchToSearchType("majorSearch", () => {
        fillMajorExpression(latest.expression || "");
      });
      return;
    }

    const itemEl = evt.target.closest(".cnki-adv-item");
    if (!itemEl) return;
    const id = itemEl.getAttribute("data-id");
    const item = store.history.find((x) => x.id === id);
    if (!item) return;

    if (action === "restore") {
      switchToSearchType("gradeSearch", () => {
        let retries = 0;
        const timer = setInterval(() => {
          retries += 1;
          const ok = applyAdvancedState(item.snapshot);
          if (ok || retries > 8) clearInterval(timer);
        }, 120);
      });
      return;
    }
    if (action === "fill-major") {
      switchToSearchType("majorSearch", () => {
        fillMajorExpression(item.expression || "");
      });
      return;
    }
    if (action === "delete") {
      store.history = store.history.filter((x) => x.id !== id);
      saveStore();
      renderPanel();
    }
  }

  function bindTabAndInputEvents() {
    const menu = $(".search-classify-menu");
    if (!menu) return;
    menu.addEventListener("click", (evt) => {
      const li = evt.target.closest("li[name]");
      if (!li) return;
      const currentType = getActiveType();
      if (currentType === "gradeSearch") {
        saveDraftDebounced();
      }
      setTimeout(() => {
        const active = getActiveType();
        if (active === "gradeSearch") {
          restoreDraftWithRetry();
        }
        syncLayout();
      }, 120);
    });

    const moduleSearch = $("#ModuleSearch");
    if (moduleSearch) {
      moduleSearch.addEventListener("input", (evt) => {
        if (getActiveType() !== "gradeSearch") return;
        if (!evt.target.closest("#gradetxt")) return;
        saveDraftDebounced();
      });
      moduleSearch.addEventListener("change", (evt) => {
        if (getActiveType() !== "gradeSearch") return;
        if (!evt.target.closest(".grade-search-content")) return;
        saveDraftDebounced();
      });
    }
  }

  function bindSearchCapture() {
    const btn = $(".search-buttons .btn-search");
    if (!btn || btn.dataset.cnkiEnhancerBound) return;
    btn.dataset.cnkiEnhancerBound = "1";
    btn.addEventListener(
      "click",
      () => {
        if (getActiveType() !== "gradeSearch") return;
        if (AUTO_COLLAPSE_ON_SEARCH) {
          store.collapsed = true;
          saveStore();
          renderPanel();
        }
        preparePendingFromCurrent();
        setTimeout(() => tryCommitPending(false), 1800);
      },
      true,
    );
  }

  function initAfterReady() {
    injectStyle();
    insertNewTabButton();
    ensurePanel();
    syncLayout();
    bindTabAndInputEvents();
    bindSearchCapture();

    if (!layoutBound) {
      window.addEventListener("resize", syncLayout);
      layoutBound = true;
    }
    setTimeout(syncLayout, 300);
    setTimeout(syncLayout, 900);

    setTimeout(() => tryCommitPending(true), 1200);

    window.addEventListener("beforeunload", () => {
      if (getActiveType() === "gradeSearch") {
        saveDraft(collectAdvancedState());
      }
    });
  }

  function bootstrap() {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const ready = $("#ModuleSearch") && $(".search-classify-menu");
      if (ready || tries > 80) {
        clearInterval(timer);
        if (ready) initAfterReady();
      }
    }, 100);
  }

  bootstrap();
})();
