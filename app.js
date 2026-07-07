const CONFIG = {
  eventDate: "2026-08-03T18:00:00+05:00",
  address: "Жеті қазына-2, Түркістан қаласы",
  mapUrl: "https://2gis.kz/turkestan/geo/70000001106093046/68.244340,43.317621",
  apiUrl: "/api/rsvp",
  adminTokenKey: "rsvp_admin_token",
  dbName: "ernar_aruzhan_invitation",
  storeName: "rsvp_answers",
  adminPaths: ["/admin", "/админ"],
};

const $ = (selector) => document.querySelector(selector);

let dbPromise;

function openDatabase() {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB is not supported"));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(CONFIG.dbName, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CONFIG.storeName)) {
        const store = db.createObjectStore(CONFIG.storeName, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("fullName", "fullName", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function getFallbackRows() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG.storeName) || "[]");
  } catch {
    return [];
  }
}

function saveFallbackRow(answer) {
  const rows = getFallbackRows();
  rows.push({ ...answer, id: Date.now() });
  localStorage.setItem(CONFIG.storeName, JSON.stringify(rows));
}

function sortRows(rows) {
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function rowKey(row) {
  return [row.id, row.createdAt, row.fullName, row.attendance, row.guestCount].join("|");
}

function mergeRows(...groups) {
  const seen = new Set();
  return sortRows(
    groups
      .flat()
      .filter(Boolean)
      .filter((row) => {
        const key = rowKey(row);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
  );
}

async function getLocalGuests() {
  let indexedRows = [];

  try {
    const db = await openDatabase();
    indexedRows = await new Promise((resolve, reject) => {
      const tx = db.transaction(CONFIG.storeName, "readonly");
      const request = tx.objectStore(CONFIG.storeName).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    indexedRows = [];
  }

  return mergeRows(indexedRows, getFallbackRows());
}

async function addRemoteGuest(answer) {
  const response = await fetch(CONFIG.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(answer),
  });

  if (!response.ok) {
    throw new Error("Remote RSVP storage is unavailable");
  }

  return response.json();
}

async function getRemoteGuests() {
  let adminToken = sessionStorage.getItem(CONFIG.adminTokenKey);

  if (!adminToken) {
    adminToken = window.prompt("Admin code");
    if (!adminToken) throw new Error("Admin token is required");
    sessionStorage.setItem(CONFIG.adminTokenKey, adminToken);
  }

  const response = await fetch(CONFIG.apiUrl, {
    headers: {
      Accept: "application/json",
      "X-Admin-Token": adminToken,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      sessionStorage.removeItem(CONFIG.adminTokenKey);
    }
    throw new Error("Remote RSVP storage is unavailable");
  }

  const data = await response.json();
  return Array.isArray(data.rows) ? data.rows : [];
}

async function addGuest(answer) {
  const localAnswer = { ...answer, id: answer.id || Date.now() };

  try {
    await addRemoteGuest(localAnswer);
  } catch {
    // Keep the form useful even before shared storage is configured in Vercel.
  }

  try {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CONFIG.storeName, "readwrite");
      const request = tx.objectStore(CONFIG.storeName).add(localAnswer);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    saveFallbackRow(localAnswer);
  }

  return localAnswer.id;
}

async function getGuests() {
  const localRows = await getLocalGuests();

  try {
    return mergeRows(await getRemoteGuests(), localRows);
  } catch {
    return localRows;
  }
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setCountdown() {
  const target = new Date(CONFIG.eventDate).getTime();
  const note = $("#countdownNote");

  function setValue(id, value) {
    const node = $(`#${id}`);
    if (node) node.textContent = String(value).padStart(2, "0");
  }

  function tick() {
    const diff = target - Date.now();

    if (diff <= 0) {
      setValue("days", 0);
      setValue("hours", 0);
      setValue("minutes", 0);
      setValue("seconds", 0);
      note.textContent = "";
      return;
    }

    setValue("days", Math.floor(diff / 86400000));
    setValue("hours", Math.floor((diff % 86400000) / 3600000));
    setValue("minutes", Math.floor((diff % 3600000) / 60000));
    setValue("seconds", Math.floor((diff % 60000) / 1000));
    note.textContent = "Тойға дейін қалған уақыт.";
  }

  tick();
  setInterval(tick, 1000);
}

function setupMusic() {
  const music = $("#bgMusic");
  const toggle = $("#musicToggle");
  if (!music || !toggle) return;

  function setPlaying(isPlaying) {
    toggle.textContent = isPlaying ? "Ⅱ" : "♪";
    toggle.setAttribute("aria-label", isPlaying ? "Остановить музыку" : "Включить музыку");
    toggle.classList.toggle("is-playing", isPlaying);
  }

  async function playMusic() {
    try {
      await music.play();
      setPlaying(true);
      return true;
    } catch {
      setPlaying(false);
      return false;
    }
  }

  function enableAfterFirstInteraction() {
    const events = ["pointerdown", "keydown", "touchstart"];
    const start = async () => {
      const started = await playMusic();
      if (started) {
        events.forEach((eventName) => {
          document.removeEventListener(eventName, start);
        });
      }
    };

    events.forEach((eventName) => {
      document.addEventListener(eventName, start, { once: true });
    });
  }

  playMusic().then((started) => {
    if (!started) enableAfterFirstInteraction();
  });

  toggle.addEventListener("click", async () => {
    if (music.paused) {
      try {
        await playMusic();
        setPlaying(true);
      } catch {
        setPlaying(false);
      }
    } else {
      music.pause();
      setPlaying(false);
    }
  });
}

function setupCopyAddress() {
  const address = $("#addressText");
  const button = $("#copyAddress");
  const status = $("#copyStatus");
  if (!address || !button || !status) return;

  address.textContent = CONFIG.address;

  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(CONFIG.address);
      status.textContent = "Адрес көшірілді.";
    } catch {
      status.textContent = "Көшіру мүмкін болмады. Адресті қолмен белгілеңіз.";
    }
  });
}

function setupRelationOtherToggle() {
  const select = $("#relationSelect");
  const other = $("#relationOther");
  if (!select || !other) return;

  const otherInput = other.querySelector('input[name="relationOther"]');

  function sync() {
    const show = select.value === "Басқа";
    other.hidden = !show;
    otherInput.required = show;
    if (!show) otherInput.value = "";
  }

  select.addEventListener("change", sync);
  document.addEventListener("rsvp:reset", sync);
  sync();
}

function setupRsvpForm() {
  const form = $("#rsvpForm");
  const status = $("#formStatus");
  if (!form || !status) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const relationRaw = data.get("relation");
    const relationOther = (data.get("relationOther") || "").trim();
    const answer = {
      fullName: (data.get("fullName") || "").trim(),
      relation: relationRaw === "Басқа" ? relationOther || "Басқа" : relationRaw,
      attendance: data.get("attendance"),
      guestCount: Number(data.get("guestCount")),
      createdAt: new Date().toISOString(),
    };

    if (!answer.fullName || !answer.relation || !answer.attendance || !answer.guestCount) {
      status.textContent = "Барлық жолды толтырыңыз.";
      return;
    }

    try {
      await addGuest(answer);
      status.textContent = "Рақмет! Жауабыңыз сақталды.";
      form.reset();
      form.guestCount.value = 1;
      document.dispatchEvent(new CustomEvent("rsvp:reset"));

      const admin = $("#admin");
      if (admin && !admin.hidden) await renderAdmin();
    } catch {
      status.textContent = "Сақтау кезінде қате болды. Қайта байқап көріңіз.";
    }
  });
}

function setupRevealAnimations() {
  const targets = document.querySelectorAll("[data-reveal]");
  if (!targets.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
  );

  targets.forEach((el, index) => {
    if (index < 5) {
      el.style.setProperty("--reveal-delay", `${index * 90}ms`);
      requestAnimationFrame(() => el.classList.add("is-visible"));
    } else {
      observer.observe(el);
    }
  });
}

function rowsToCsv(rows) {
  const headers = ["Аты-жөні", "Кім болады", "Жауабы", "Адам саны", "Уақыты"];
  const values = rows.map((row) => [
    row.fullName,
    row.relation,
    row.attendance,
    row.guestCount,
    formatDate(row.createdAt),
  ]);

  return [headers, ...values]
    .map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
}

async function exportGuestsCsv() {
  const rows = await getGuests();
  const blob = new Blob(["\ufeff", rowsToCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "rsvp-guests.csv";
  link.click();
  URL.revokeObjectURL(url);
}

async function renderAdmin() {
  const rows = await getGuests();
  const tbody = $("#guestRows");
  if (!tbody) return;

  if (rows.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5">Әзірге жауап жоқ. Алғашқы RSVP осы жерде пайда болады.</td></tr>';
  } else {
    tbody.innerHTML = rows
      .map(
        (row) => `
          <tr>
            <td>${escapeHtml(row.fullName)}</td>
            <td>${escapeHtml(row.relation)}</td>
            <td>${escapeHtml(row.attendance)}</td>
            <td>${escapeHtml(row.guestCount)}</td>
            <td>${escapeHtml(formatDate(row.createdAt))}</td>
          </tr>
        `,
      )
      .join("");
  }

  const attendingRows = rows.filter((row) => row.attendance !== "Өкінішке қарай келе алмаймын");
  $("#totalAnswers").textContent = rows.length;
  $("#attendingAnswers").textContent = attendingRows.length;
  $("#totalGuests").textContent = attendingRows.reduce(
    (sum, row) => sum + (Number(row.guestCount) || 0),
    0,
  );
}

function setupAdminRoute() {
  const main = $("main");
  if (!main) return;

  const adminSection = document.createElement("section");
  adminSection.id = "admin";
  adminSection.className = "section admin";
  adminSection.hidden = true;
  adminSection.setAttribute("aria-labelledby", "adminTitle");
  adminSection.innerHTML = `
    <div class="section-heading">
      <p class="eyebrow">Админ панель</p>
      <h2 id="adminTitle">Қонақтар тізімі</h2>
    </div>
    <div class="admin-summary">
      <div>
        <strong id="totalAnswers">0</strong>
        <span>жауап</span>
      </div>
      <div>
        <strong id="attendingAnswers">0</strong>
        <span>келетін жауап</span>
      </div>
      <div>
        <strong id="totalGuests">0</strong>
        <span>адам саны</span>
      </div>
    </div>
    <div class="admin-actions">
      <button class="primary-button" id="exportCsv" type="button">CSV жүктеу</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Аты-жөні</th>
            <th>Кім болады</th>
            <th>Жауабы</th>
            <th>Адам саны</th>
            <th>Уақыты</th>
          </tr>
        </thead>
        <tbody id="guestRows"></tbody>
      </table>
    </div>
  `;
  main.appendChild(adminSection);

  $("#exportCsv").addEventListener("click", exportGuestsCsv);

  function isAdminPath() {
    const path = decodeURIComponent(window.location.pathname).replace(/\/$/, "");
    const params = new URLSearchParams(window.location.search);
    return CONFIG.adminPaths.includes(path) || params.has("admin");
  }

  async function showAdmin() {
    adminSection.hidden = false;
    document.body.classList.add("is-admin-route");
    await renderAdmin();
    adminSection.scrollIntoView({ behavior: "auto", block: "start" });
  }

  function hideAdmin() {
    adminSection.hidden = true;
    document.body.classList.remove("is-admin-route");
  }

  function syncRoute() {
    if (isAdminPath()) {
      showAdmin();
    } else {
      hideAdmin();
    }
  }

  window.addEventListener("popstate", syncRoute);
  syncRoute();
}

document.addEventListener("DOMContentLoaded", () => {
  setupMusic();
  setupCopyAddress();
  setupRelationOtherToggle();
  setupRsvpForm();
  setCountdown();
  setupRevealAnimations();
  setupAdminRoute();
});
