/* ============================================================
   MADADGAR — Pure vanilla JS app (Firebase RTDB via compat SDK)
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyA5l-49V_ek2rD9Ym06WfQipiijMyzzo64",
  authDomain: "gen-lang-client-0758284005.firebaseapp.com",
  databaseURL:
    "https://gen-lang-client-0758284005-default-rtdb.firebaseio.com",
  projectId: "gen-lang-client-0758284005",
  storageBucket: "gen-lang-client-0758284005.firebasestorage.app",
  messagingSenderId: "570844080170",
  appId: "1:570844080170:web:3a35a26d67747a8210bb53",
};

firebase.initializeApp(firebaseConfig);
const db   = firebase.database();
const auth = firebase.auth();

const ADMIN_PASSWORD = "shoaib999";
const USER_KEY = "madadgar_user_v3";

const state = {
  user: null,
  posts: [],
  users: [],
  successCount: 0,
  currentScreen: "login",
  filter: "find_jobs",
  addressSearch: "",
  categorySearch: "",
  postsLoaded: false,
  usersLoaded: false,
  postType: "job_seeker",
  adminUserView: null,
  editPostId: null,
  usersError: null,
  viewedThisSession: new Set(),
};

/* ----------------------------- Helpers ----------------------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUsername(s) {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9_]/g, "");
}

function timeAgo(ts) {
  if (!ts) return "";
  const diffMs = Date.now() - ts;
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "abhi";
  if (m < 60) return `${m} min pehle`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ghante pehle`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} din pehle`;
  return new Date(ts).toLocaleDateString("en-PK", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function showError(elId, msg) {
  const el = $("#" + elId);
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.hidden = false;
  } else {
    el.hidden = true;
    el.textContent = "";
  }
}

function showScreen(name) {
  state.currentScreen = name;
  $$(".screen").forEach((s) => s.classList.remove("active"));
  const target = $("#screen-" + name);
  if (target) target.classList.add("active");
  window.scrollTo(0, 0);
}

function persistUser() {
  if (state.user) {
    localStorage.setItem(USER_KEY, JSON.stringify(state.user));
  } else {
    localStorage.removeItem(USER_KEY);
  }
}

function loadPersistedUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* ----------------------------- Auth ----------------------------- */
async function handleLogin(e) {
  e.preventDefault();
  const username = $("#login-phone").value; // Matches HTML id
  const password = $("#login-password").value;
  showError("login-error", "");

  const cleanUsername = safeUsername(username);
  if (!cleanUsername) {
    showError("login-error", "Username daalein.");
    return;
  }
  if (!password) {
    showError("login-error", "Password daalein.");
    return;
  }

  try {
    const snap = await db.ref("users/" + cleanUsername).get();
    if (!snap.exists())
      return showError("login-error", "Username nahi mila. Pehle Sign Up karein.");

    const data = snap.val();
    if (data.blocked)
      return showError("login-error", "Aap ko admin ne block kar diya hai.");
    if (!data.email)
      return showError("login-error", "Account mein email nahi hai.");

    let cred;
    try {
      cred = await auth.signInWithEmailAndPassword(data.email, password);
    } catch (authErr) {
      if (authErr.code === "auth/wrong-password" || authErr.code === "auth/invalid-credential")
        return showError("login-error", "Ghalat password. Dobara try karein.");
      throw authErr;
    }

    if (!cred.user.emailVerified) {
      await auth.signOut();
      return showError("login-error", "Aap ki email verify nahi hui. Inbox check karein.");
    }

    if (!data.emailVerified) {
      await db.ref("users/" + cleanUsername + "/emailVerified").set(true);
    }

    await auth.signOut();

    state.user = {
      username: data.username || cleanUsername,
      fullName: data.fullName,
      email: data.email,
      isAdmin: false,
    };
    persistUser();
    setupUserPresence();
    enterApp();
  } catch (err) {
    console.error("Login error:", err);
    showError("login-error", "Internet check karein.");
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const fullName = $("#reg-name").value.trim();
  const username = safeUsername($("#reg-phone").value);
  const password = $("#reg-password").value;
  const role = $("#reg-role").value;
  const email = username + "@madadgar.com"; // Dynamic fallback email since HTML has no email field

  showError("reg-error", "");

  try {
    const existing = await db.ref("users/" + username).get();
    if (existing.exists())
      return showError("reg-error", "Yeh number pehle se registered hai.");

    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.sendEmailVerification();

    await db.ref("users/" + username).set({
      fullName,
      username,
      email,
      role,
      blocked: false,
      emailVerified: false,
      createdAt: Date.now(),
    });

    await auth.signOut();
    alert("Registration kamyabi se ho gayi! Email verify karein.");
    showScreen("login");
  } catch (err) {
    showError("reg-error", err.message);
  }
}

function logout() {
  auth.signOut().catch(() => {});
  state.user = null;
  persistUser();
  db.ref("posts").off();
  db.ref("users").off();
  db.ref("stats/successCount").off();
  state.posts = [];
  state.users = [];
  state.successCount = 0;
  state.postsLoaded = false;
  state.usersLoaded = false;
  showScreen("login");
}

/* ----------------------------- Posts ----------------------------- */
function subscribePosts() {
  db.ref("posts").on("value", (snap) => {
    const list = [];
    snap.forEach((child) => {
      list.push({ id: child.key, ...child.val() });
    });
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    state.posts = list;
    state.postsLoaded = true;
    onPostsChanged();
  });
}

function subscribeUsers() {
  db.ref("users").on("value", (snap) => {
    const list = [];
    snap.forEach((child) => {
      const val = child.val();
      val._key = child.key;
      if (!val.username) val.username = child.key;
      list.push(val);
    });
    state.users = list;
    state.usersLoaded = true;
    onUsersChanged();
  });
}

function onPostsChanged() {
  if (state.currentScreen === "home") renderHome();
  if (state.currentScreen === "admin") {
    renderAdminStats();
    renderReportedPosts();
  }
  if (state.currentScreen === "admin-user") renderAdminUser();
}

function onUsersChanged() {
  if (state.currentScreen === "admin") {
    renderAdminStats();
    renderAdminUsersTable();
  }
  if (state.currentScreen === "admin-user") renderAdminUser();
}

function postCardHTML(post, opts = {}) {
  const isWorker = post.type === "job_seeker";
  const tagClass = isWorker ? "worker" : "employer";
  const tagText = isWorker ? "👤 Worker Profile" : "💼 Job Post";
  const ownerName = post.ownerName ? post.ownerName : "";

  let inner = `
    <div class="post-card">
    <div class="post-tags">
      <span class="tag ${tagClass}">${tagText}</span>
      ${post.verified ? '<span class="tag worker">✓ Verified</span>' : ""}
    </div>`;

  if (post.done) {
    inner += `<div class="done-badge">✓ ALHAMDULILLAH! KAAM HO GAYA</div>`;
  }

  if (post.category) {
    inner += `<div class="post-row bold"><span class="ic">🛠️</span><span>${post.category}</span></div>`;
  }

  if (post.salary) {
    inner += `<div class="post-row"><span class="ic">💰</span><span>${post.salary}</span></div>`;
  }

  inner += `<div class="post-row"><span class="ic">📍</span><span>${post.address || ""}</span></div>`;

  if (ownerName) {
    inner += `<div class="post-row"><span class="ic">👤</span><span>${ownerName}</span></div>`;
  }

  inner += `<div class="post-meta">${timeAgo(post.createdAt)} • ${post.viewCount || 0} views</div>`;

  const isOwner = state.user && post.username === state.user.username;

  if (opts.adminMode) {
    const resetBtn = post.done ? `<button class="action-btn reset" data-act="reset-done" data-id="${post.id}">Reset</button>` : "";
    inner += `
        <div class="post-actions">
            ${resetBtn}
            <button class="action-btn edit-post-btn" data-act="edit-post" data-id="${post.id}">Edit</button>
            <button class="action-btn delete" data-act="delete-post" data-id="${post.id}">Delete</button>
        </div>`;
  } else if (isOwner) {
    const doneBtn = post.done ? "" : `<button class="action-btn done" data-act="mark-done" data-id="${post.id}">✓ Mark as Done</button>`;
    const deleteBtn = opts.myMode ? `<button class="action-btn delete" data-act="delete-mine" data-id="${post.id}">Delete</button>` : "";
    inner += `
        <div class="post-actions">
            ${doneBtn}
            <button class="action-btn call" data-act="call" data-mobile="${escapeHtml(post.mobileNumber || '')}">Call</button>
            ${deleteBtn}
        </div>`;
  } else {
    if (!post.done) {
      const reportBtn = `<button class="action-btn report" data-act="report-post" data-id="${post.id}">⚠️ Report</button>`;
      inner += `
            <div class="post-actions" style="display: flex; flex-direction: column; gap: 5px;">
                <button type="button" class="action-btn" onclick="openChatWithUser('${post.username || 'test_user'}', '${escapeHtml(post.ownerName || 'User')}')" style="background-color: #007bff; color: white;">💬 Chat</button>
                <div style="display: flex; gap: 5px; width: 100%;">
                    <button class="action-btn call" data-act="call" data-mobile="${escapeHtml(post.mobileNumber || '')}" style="flex: 1;">📞 Call</button>
                    <div style="flex: 1;">${reportBtn}</div>
                </div>
            </div>`;
    }
  }

  inner += `</div>`;
  return inner;
}

function renderHome() {
  const list = $("#posts-container");
  if (!list) return;

  if (!state.postsLoaded) {
    list.innerHTML = `<div class="loading-spinner">Data load ho raha hai...</div>`;
    return;
  }

  const filtered = state.posts.filter((p) => {
    const matchesType = state.filter === "find_jobs" ? p.type === "employer" : p.type === "job_seeker";
    if (!matchesType) return false;
    if (state.addressSearch && !(p.address || "").toLowerCase().includes(state.addressSearch.toLowerCase())) return false;
    if (state.categorySearch && !(p.category || "").toLowerCase().includes(state.categorySearch.toLowerCase())) return false;
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-block"><p>Kuch nahi mila.</p></div>`;
    return;
  }

  list.innerHTML = filtered.map((p) => postCardHTML(p)).join("");
  filtered.forEach((p) => recordView(p));
}

async function recordView(post) {
  if (!post || !post.id || !state.user || state.user.isAdmin) return;
  if (post.username === state.user.username) return;
  if (state.viewedThisSession.has(post.id)) return;
  state.viewedThisSession.add(post.id);

  try {
    await db.ref("posts/" + post.id + "/viewCount").transaction((c) => (c || 0) + 1);
  } catch (err) {
    console.warn(err);
  }
}

function subscribeStats() {
  db.ref("stats/successCount").on("value", (snap) => {
    state.successCount = snap.val() || 0;
    updateSuccessBar();
  });
}

function updateSuccessBar() {
  const sc = $("#success-count");
  if (sc) sc.textContent = state.successCount;
}

function renderAdminStats() {
  const total = state.users.length;
  const elUsers = $("#admin-total-users");
  if (elUsers) elUsers.textContent = total;
  const elPosts = $("#admin-total-posts");
  if (elPosts) elPosts.textContent = state.posts.length;
}

function renderAdminUsersTable() {
  const body = $("#admin-users-list");
  if (!body) return;
  body.innerHTML = state.users.map(u => `
    <li style="padding:10px; border-bottom:1px solid #eee; display:flex; justify-content:space-between;" class="user-row" data-username="${escapeHtml(u.username)}">
      <span>${escapeHtml(u.fullName)} (@${escapeHtml(u.username)})</span>
      <button class="user-action-btn danger" data-act="delete-user" data-username="${escapeHtml(u.username)}">🗑 Delete</button>
    </li>
  `).join("");
}

function renderReportedPosts() {
  const container = $("#reported-posts-list");
  if (!container) return;
  container.innerHTML = `<div class="muted small">Reported posts panel.</div>`;
}

function renderAdminUser() {
  if (!state.adminUserView) return;
  renderAdminUserDetail();
}

function renderAdminUserDetail() {
  const username = state.adminUserView;
  const u = state.users.find(x => x.username === username);
  const container = $("#admin-user-content");
  if (!container || !u) return;

  container.innerHTML = `<h4>${escapeHtml(u.fullName)}</h4><p>@${escapeHtml(u.username)}</p>`;
}

async function addPostToFirebase(data) {
  const ref = db.ref("posts").push();
  await ref.set({
    type: data.type,
    category: data.category,
    salary: data.salary,
    mobileNumber: data.mobileNumber,
    username: data.username,
    ownerName: data.ownerName,
    address: data.address,
    createdAt: Date.now(),
    viewCount: 0,
    verified: false,
  });
}

async function deletePostFromFirebase(id) {
  await db.ref("posts/" + id).remove();
}

async function updatePostInFirebase(id, data) {
  await db.ref("posts/" + id).update(data);
}

function triggerSearch() {
  state.addressSearch = $("#search-address").value;
  state.categorySearch = $("#search-category").value;
  renderHome();
}

function setFilter(type) {
  state.filter = type;
  $("#btn-filter-jobs").classList.toggle("active", type === "find_jobs");
  $("#btn-filter-providers").classList.toggle("active", type === "find_providers");
  renderHome();
}

function navigateTo(screen) {
  showScreen(screen);
}

function navigateToPostForm(type) {
  state.postType = type;
  showScreen("post_form");
}

async function handleCreatePost(e) {
  e.preventDefault();
  const title = $("#post-title").value;
  const category = $("#post-category").value;
  const desc = $("#post-desc").value;
  const address = $("#post-address").value;
  const phone = $("#post-phone").value;

  try {
    await addPostToFirebase({
      type: state.postType,
      category: category,
      salary: title, // title mapping logic if used as salary/unwan
      mobileNumber: phone,
      username: state.user.username,
      ownerName: state.user.fullName,
      address: address + " (" + desc + ")",
    });
    showScreen("home");
  } catch (err) {
    alert("Post nahi ho saki.");
  }
}

function handleAdminLogin(e) {
  e.preventDefault();
  const pass = $("#admin-pass-input").value;
  if (pass === ADMIN_PASSWORD) {
    state.user = { username: "admin", fullName: "Admin Panel", isAdmin: true };
    persistUser();
    enterApp();
  } else {
    alert("Ghalat Admin Password!");
  }
}

/* ----------------------------- Events ----------------------------- */
function attachEvents() {
  const loginForm = $("#form-login");
  if (loginForm) loginForm.addEventListener("submit", handleLogin);

  const regForm = $("#form-register");
  if (regForm) regForm.addEventListener("submit", handleRegister);

  document.addEventListener("click", async (e) => {
    const target = e.target.closest("[data-act]");
    if (!target) return;
    const act = target.dataset.act;

    if (act === "call") {
      const mobile = target.dataset.mobile;
      if (mobile) window.location.href = "tel:" + mobile;
    }
    if (act === "delete-post") {
      if (confirm("Delete post?")) await deletePostFromFirebase(target.dataset.id);
    }
  });
}

/* ----------------------------- Boot ----------------------------- */
function enterApp() {
  setupUserPresence();
  subscribeStats();
  if (state.user.isAdmin) {
    showScreen("admin_dashboard");
    subscribePosts();
    subscribeUsers();
  } else {
    showScreen("home");
    subscribePosts();
  }
}

function init() {
  attachEvents();
  state.user = loadPersistedUser();
  if (state.user) {
    enterApp();
  } else {
    showScreen("login");
  }
}

document.addEventListener("DOMContentLoaded", init);

// PROFILE SYSTEM & CHAT FUNCTIONS
function setupUserPresence() {
  if (!state.user) return;
  const userStatusRef = db.ref('/users/' + state.user.username + '/status');
  db.ref('.info/connected').on('value', (snapshot) => {
    if (snapshot.val() == false) return;
    userStatusRef.onDisconnect().set({ state: 'offline', last_changed: firebase.database.ServerValue.TIMESTAMP }).then(() => {
      userStatusRef.set({ state: 'online', last_changed: firebase.database.ServerValue.TIMESTAMP });
    });
  });
}

function listenToUserPresence(targetUserId) {
  db.ref('/users/' + targetUserId + '/status').on('value', (snapshot) => {
    const statusElement = document.getElementById("chat-user-status");
    if (!statusElement) return;
    if (!snapshot.exists()) {
      statusElement.innerText = "offline";
      return;
    }
    statusElement.innerText = snapshot.val().state === "online" ? "online" : "offline";
  });
}

function openChatWithUser(receiverID, receiverName) {
  listenToUserPresence(receiverID);
  alert("Chat system integrated dynamically with " + receiverName);
}
