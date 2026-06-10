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

// FIX: Guard against double-initialisation
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
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
  activeChat: null,
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
  const username = $("#login-username").value;
  const password = $("#login-password").value;
  showError("login-error", "");

  const cleanUsername = safeUsername(username);
  if (!cleanUsername) return showError("login-error", "Username daalein.");
  if (!password) return showError("login-error", "Password daalein.");

  const btn = $("#login-btn-text");
  btn.textContent = "Sabar Karein...";

  try {
    const snap = await db.ref("users/" + cleanUsername).get();
    if (!snap.exists())
      return showError("login-error", "Username nahi mila. Pehle Sign Up karein.");

    const data = snap.val();
    if (data.blocked)
      return showError("login-error", "Aap ko admin ne block kar diya hai.");
    if (!data.email)
      return showError("login-error", "Account mein email nahi hai. Admin se raabta karein.");

    let cred;
    try {
      cred = await auth.signInWithEmailAndPassword(data.email, password);
    } catch (authErr) {
      if (
        authErr.code === "auth/wrong-password" ||
        authErr.code === "auth/invalid-credential" ||
        authErr.code === "auth/invalid-password"
      )
        return showError("login-error", "Ghalat password. Dobara try karein.");
      if (authErr.code === "auth/too-many-requests")
        return showError("login-error", "Bahut zyada tries. Thodi der baad try karein.");
      throw authErr;
    }

    if (!cred.user.emailVerified) {
      await auth.signOut();
      return showError(
        "login-error",
        "Aap ki email verify nahi hui. Inbox check karein aur pehle email verify karein."
      );
    }

    if (!data.emailVerified) {
      await db.ref("users/" + cleanUsername + "/emailVerified").set(true);
    }

    // ── Keep the Firebase Auth session alive so security rules work ──────
    // DO NOT call auth.signOut() here — the session is needed for RTDB rules.
    // logout() already calls auth.signOut() when the user explicitly logs out.

    const uid = cred.user.uid;

    // Write uid→username reverse-index (idempotent — safe to rewrite on every login)
    await db.ref("uid_to_username/" + uid).set(cleanUsername);

    // Backfill uid into user profile if it wasn't stored during signup
    if (!data.uid) {
      await db.ref("users/" + cleanUsername + "/uid").set(uid);
    }

    state.user = {
      username: data.username || cleanUsername,
      fullName: data.fullName,
      email: data.email,
      uid,
      isAdmin: false,
    };
    persistUser();
    // FIX: setupUserPresence() removed here — enterApp() calls it already
    enterApp();
  } catch (err) {
    console.error("Login error:", err.code, err.message);
    showError("login-error", "Server tak nahi pohanche. Internet check karein.");
  } finally {
    btn.textContent = "LOGIN";
  }
}

async function handleSignup() {
  const fullName = $("#signup-fullname").value.trim();
  const username = safeUsername($("#signup-username").value);
  const email    = $("#signup-email").value.trim().toLowerCase();
  const password = $("#signup-password").value;

  showError("signup-error", "");
  if (!fullName)
    return showError("signup-error", "Apna naam likhein.");
  if (username.length < 3)
    return showError("signup-error", "Username chhota hai (kam az kam 3 letters).");
  if (!/^[a-zA-Z0-9_]+$/.test(username))
    return showError("signup-error", "Username mein sirf letters, numbers, _ chalega.");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return showError("signup-error", "Sahi email address daalen.");
  if (password.length < 6)
    return showError("signup-error", "Password chhota hai (kam az kam 6 characters).");

  const btn = $("#signup-btn-text");
  btn.textContent = "Account ban raha hai...";
  $("#signup-btn").disabled = true;

  try {
    const existing = await db.ref("users/" + username).get();
    if (existing.exists())
      return showError("signup-error", "Yeh username pehle se hai. Doosra try karein.");

    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.sendEmailVerification();

    // Write uid→username reverse-index FIRST so the users/ write passes rules
    await db.ref("uid_to_username/" + cred.user.uid).set(username);

    await db.ref("users/" + username).set({
      fullName,
      username,
      email,
      uid: cred.user.uid,
      blocked: false,
      emailVerified: false,
      createdAt: Date.now(),
    });

    await auth.signOut();

    $("#signup-form").hidden = true;
    $("#signup-success-notice").hidden = false;
  } catch (err) {
    console.error("Signup error:", err.code, err.message);
    let msg = err.message || "Signup fail hua. Phir koshish karein.";
    if (err.code === "auth/email-already-in-use")
      msg = "Yeh email pehle se registered hai.";
    else if (err.code === "auth/invalid-email")
      msg = "Email address sahi nahi hai.";
    else if (err.code === "auth/weak-password")
      msg = "Password zyada secure hona chahiye (kam az kam 6 characters).";
    showError("signup-error", msg);
  } finally {
    btn.textContent = "SIGN UP";
    $("#signup-btn").disabled = false;
  }
}

function resetSignupUI() {
  $("#signup-form").hidden = false;
  $("#signup-success-notice").hidden = true;
  $("#signup-fullname").value = "";
  $("#signup-username").value = "";
  $("#signup-email").value    = "";
  $("#signup-password").value = "";
  showError("signup-error", "");
}

function logout() {
  auth.signOut().catch(() => {});
  state.user = null;
  persistUser();
  db.ref("posts").off();
  db.ref("users").off();
  db.ref("stats/successCount").off();
  // Detach chat listeners
  _closeChatListeners();
  if (_inboxListener)      { _inboxListener.off();      _inboxListener = null; }
  if (_unreadBadgeListener){ _unreadBadgeListener.off(); _unreadBadgeListener = null; }
  state.posts = [];
  state.users = [];
  state.successCount = 0;
  state.postsLoaded = false;
  state.usersLoaded = false;
  state.usersError = null;
  state.viewedThisSession = new Set();
  state.activeChat = null;
  showScreen("login");
  if ($("#login-username")) $("#login-username").value = "";
  if ($("#login-password")) $("#login-password").value = "";
}

/* ----------------------------- Posts ----------------------------- */
function subscribePosts() {
  db.ref("posts").on(
    "value",
    (snap) => {
      const list = [];
      snap.forEach((child) => {
        list.push({ id: child.key, ...child.val() });
      });
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      state.posts = list;
      state.postsLoaded = true;
      onPostsChanged();
    },
    (err) => {
      console.warn("Posts read error:", err.message);
      state.postsLoaded = true;
      renderHome();
    }
  );
}

function subscribeUsers() {
  db.ref("users").on(
    "value",
    (snap) => {
      const list = [];
      const ghostKeys = [];
      snap.forEach((child) => {
        const val = child.val();
        val._key = child.key;
        if (!val.username) val.username = child.key;

        const hasName  = val.fullName && val.fullName.trim();
        const hasEmail = val.email    && val.email.trim();
        if (!hasName || !hasEmail) {
          ghostKeys.push(child.key);
          return;
        }
        list.push(val);
      });

      ghostKeys.forEach((key) =>
        db.ref("users/" + key).remove().catch(() => {})
      );

      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      state.users = list;
      state.usersLoaded = true;
      state.usersError = null;
      onUsersChanged();
    },
    (err) => {
      console.error("Firebase users read error:", err.code, err.message);
      state.usersLoaded = true;
      state.usersError = err.message || "Firebase permission error";
      onUsersChanged();
    }
  );
}

function onPostsChanged() {
  if (state.currentScreen === "home") renderHome();
  if (state.currentScreen === "history") renderHistory();
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

async function addPostToFirebase(data) {
  const ref = db.ref("posts").push();
  await ref.set({
    type: data.type,
    category: data.category || null,
    salary: data.salary || null,
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

async function deleteUser(username) {
  if (
    !confirm(
      `"@${username}" ka account permanently delete karna hai?\n\nIs user ke saare posts bhi delete ho jayenge. Yeh action undo nahi ho sakti.`
    )
  )
    return;
  try {
    const userRecord = state.users.find((x) => x.username === username);
    const dbKey = (userRecord && userRecord._key) ? userRecord._key : username;

    const userPosts = state.posts.filter((p) => p.username === username);
    await Promise.all(userPosts.map((p) => db.ref("posts/" + p.id).remove()));

    await db.ref("users/" + dbKey).remove();

    if (state.currentScreen === "admin-user") {
      state.adminUserView = null;
      showScreen("admin");
    }
  } catch (err) {
    console.error("deleteUser error:", err);
    alert("Delete fail. Phir try karein.\n\n" + (err.message || ""));
  }
}

function retryLoadUsers() {
  state.users = [];
  state.usersLoaded = false;
  state.usersError = null;
  db.ref("users").off("value");
  renderAdminUsersTable();
  subscribeUsers();
}

function openEditPost(post) {
  state.editPostId = post.id;
  $("#post-modal-title").textContent = "Post Edit Karein";
  $("#post-submit").textContent = "SAVE KAREIN";
  $("#edit-cancel-btn").hidden = false;
  const type = post.type || "job_seeker";
  state.postType = type;
  $$(".type-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.type === type)
  );
  const catSelect = $("#post-category");
  const validOptions = Array.from(catSelect.options).map((o) => o.value);
  if (validOptions.includes(post.category)) {
    catSelect.value = post.category;
    $("#post-custom-category").hidden = true;
    $("#post-custom-category").value = "";
  } else {
    catSelect.value = "Other";
    $("#post-custom-category").hidden = false;
    $("#post-custom-category").value = post.category || "";
  }
  if (type === "employer" && post.salary) {
    $("#salary-field").hidden = false;
    const stripped = (post.salary || "").replace(/^rs\.?\s*/i, "").trim();
    $("#post-salary").value = stripped;
  } else {
    $("#salary-field").hidden = type !== "employer";
    $("#post-salary").value = "";
  }
  $("#post-mobile-input").value = post.mobileNumber || state.user?.mobile || "";
  $("#post-address").value = post.address || "";
  $("#add-post-modal").hidden = false;
}

async function markPostDone(id) {
  const post = state.posts.find((p) => p.id === id);
  if (!post || post.done) return;
  if (!confirm("Pakka kaam ho gaya?\nYeh post 'Alhamdulillah Kaam Ho Gaya' ke saath mark ho jayegi."))
    return;
  try {
    await db.ref("posts/" + id).update({ done: true, doneAt: Date.now() });
    await db.ref("stats/successCount").transaction((c) => (c || 0) + 1);
  } catch (err) {
    console.error(err);
    alert("Mark fail. Phir try karein.");
  }
}

async function resetPostDone(id) {
  const post = state.posts.find((p) => p.id === id);
  if (!post || !post.done) return;
  if (!confirm("Is post ka status wapas Active karein?\n(Success Stories count se 1 minus ho jayega)"))
    return;
  try {
    await db.ref("posts/" + id).update({ done: false, doneAt: null });
    await db.ref("stats/successCount").transaction((c) => Math.max(0, (c || 0) - 1));
  } catch (err) {
    console.error(err);
    alert("Reset fail. Phir try karein.");
  }
}

async function recordView(post) {
  if (!post || !post.id || !state.user) return;
  if (state.user.isAdmin) return;
  if (post.username === state.user.username) return;
  if (state.viewedThisSession.has(post.id)) return;
  state.viewedThisSession.add(post.id);
  const username = state.user.username;
  const lsKey = "madadgar_views_" + username;
  let viewedMap = {};
  try {
    viewedMap = JSON.parse(localStorage.getItem(lsKey) || "{}");
  } catch {}
  if (viewedMap[post.id]) return;
  viewedMap[post.id] = 1;
  localStorage.setItem(lsKey, JSON.stringify(viewedMap));
  try {
    await db.ref("posts/" + post.id).transaction((current) => {
      if (!current) return current;
      if (current.viewers && current.viewers[username]) return;
      current.viewers = current.viewers || {};
      current.viewers[username] = true;
      current.viewCount = (current.viewCount || 0) + 1;
      return current;
    });
  } catch (err) {
    console.warn("View record failed:", err.message);
  }
}

function subscribeStats() {
  db.ref("stats/successCount").on(
    "value",
    (snap) => {
      state.successCount = snap.val() || 0;
      updateSuccessBar();
    },
    (err) => console.warn("Stats read error:", err.message)
  );
}

async function toggleBlockUser(username, currentlyBlocked) {
  await db.ref("users/" + username).update({ blocked: !currentlyBlocked });
}

/* ----------------------------- Renders ----------------------------- */

// FIX: postCardHTML now correctly builds and RETURNS the HTML string.
// Previously ALL content was inside `if (post.done)` so non-done posts
// returned undefined. Also removed the stray `list.innerHTML += inner`
// and the orphaned `});` that broke the function entirely.
function postCardHTML(post, opts = {}) {
  const isWorker = post.type === "job_seeker";
  const tagClass = isWorker ? "worker" : "employer";
  const tagText  = isWorker ? "👤 Worker Profile" : "💼 Job Post";
  const ownerName = post.ownerName || "";

  let inner = `<div class="post-card">
    <div class="post-tags">
      <span class="tag ${tagClass}">${tagText}</span>
      ${post.verified ? '<span class="tag worker">✓ Verified</span>' : ""}
    </div>`;

  if (post.done) {
    inner += `<div class="done-badge">✓ ALHAMDULILLAH! KAAM HO GAYA</div>`;
  }

  if (post.category) {
    inner += `<div class="post-row bold"><span class="ic">🛠️</span><span>${escapeHtml(post.category)}</span></div>`;
  }

  if (post.salary) {
    inner += `<div class="post-row"><span class="ic">💰</span><span>${escapeHtml(post.salary)}</span></div>`;
  }

  inner += `<div class="post-row"><span class="ic">📍</span><span>${escapeHtml(post.address || "")}</span></div>`;

  if (ownerName) {
    inner += `<div class="post-row"><span class="ic">👤</span><span>${escapeHtml(ownerName)}</span></div>`;
  }

  inner += `<div class="post-meta">${timeAgo(post.createdAt)} • ${post.viewCount || 0} views</div>`;

  const isOwner = state.user && post.username === state.user.username;

  if (opts.adminMode) {
    const resetBtn = post.done
      ? `<button class="action-btn reset" data-act="reset-done" data-id="${post.id}">Reset</button>`
      : "";
    inner += `
      <div class="post-actions">
        ${resetBtn}
        <button class="action-btn edit-post-btn" data-act="edit-post" data-id="${post.id}">Edit</button>
        <button class="action-btn delete" data-act="delete-post" data-id="${post.id}">Delete</button>
      </div>`;
  } else if (isOwner) {
    const doneBtn = post.done
      ? ""
      : `<button class="action-btn done" data-act="mark-done" data-id="${post.id}">✓ Mark as Done</button>`;
    const deleteBtn = opts.myMode
      ? `<button class="action-btn delete" data-act="delete-mine" data-id="${post.id}">Delete</button>`
      : "";
    inner += `
      <div class="post-actions">
        ${doneBtn}
        <button class="action-btn call" data-act="call" data-mobile="${escapeHtml(post.mobileNumber || '')}">📞 Call</button>
        ${deleteBtn}
      </div>`;
  } else {
    if (!post.done) {
      const alreadyReported = (() => {
        try {
          const key = "madadgar_reported_v1";
          return JSON.parse(localStorage.getItem(key) || "[]").includes(post.id);
        } catch { return false; }
      })();

      const reportBtn = alreadyReported
        ? `<button class="action-btn report" disabled style="opacity:.5;cursor:default">Reported</button>`
        : `<button class="action-btn report" data-act="report-post" data-id="${post.id}">⚠️ Report</button>`;

      inner += `
        <div class="post-actions" style="display:flex;flex-direction:column;gap:5px;">
          <button type="button" class="action-btn"
            onclick="openChatWithUser('${escapeHtml(post.username || 'test_user')}','${escapeHtml(post.ownerName || 'User')}','')"
            style="background-color:#007bff;color:white;">💬 Chat</button>
          <div style="display:flex;gap:5px;width:100%;">
            <button class="action-btn call" data-act="call" data-mobile="${escapeHtml(post.mobileNumber || '')}" style="flex:1;">📞 Call</button>
            <div style="flex:1;">${reportBtn}</div>
          </div>
        </div>`;
    }
  }

  inner += `</div>`;
  return inner;  // FIX: always return the built string
}

// FIX: `list` variable was never declared — added the querySelector
function renderHome() {
  const list = $("#posts-list") || $("#home-posts-list");
  if (!list) return;

  if (!state.postsLoaded) {
    list.innerHTML = _skeletonPostCards(3);
    return;
  }

  const filtered = state.posts.filter((p) => {
    const matchesType =
      state.filter === "find_jobs" ? p.type === "employer" : p.type === "job_seeker";
    if (!matchesType) return false;
    if (state.addressSearch && !(p.address || "").toLowerCase().includes(state.addressSearch.toLowerCase()))
      return false;
    if (state.categorySearch && !(p.category || "").toLowerCase().includes(state.categorySearch.toLowerCase()))
      return false;
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-block">
        <div class="big">${state.filter === "find_jobs" ? "💼" : "👥"}</div>
        <div class="title">${
          state.addressSearch || state.categorySearch
            ? "Kuch nahi mila"
            : state.filter === "find_jobs"
            ? "Abhi koi kaam nahi hai"
            : "Abhi koi worker nahi hai"
        }</div>
        <p>${
          state.addressSearch || state.categorySearch
            ? "Apna search badlein ya khali karein"
            : 'Pehle post karne ke liye neeche "+" button dabayein'
        }</p>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map((p) => postCardHTML(p)).join("");
  filtered.forEach((p) => recordView(p));
}

function renderHistory() {
  const list = $("#my-posts-list");
  if (!list) return;
  const mine = state.posts.filter(
    (p) => state.user && p.username === state.user.username
  );
  if (mine.length === 0) {
    list.innerHTML = `
      <div class="empty-block">
        <div class="big">📭</div>
        <div class="title">Aap ne abhi koi post nahi ki</div>
        <p>Home pe wapas jaa kar "+" button dabayein</p>
      </div>`;
    return;
  }
  list.innerHTML = mine.map((p) => postCardHTML(p, { myMode: true })).join("");
}

function renderAdminStats() {
  const total    = state.users.length;
  const verified = state.users.filter((u) => u.emailVerified === true).length;
  const pending  = total - verified;

  const elSignups  = $("#stat-signups");
  const elVerified = $("#stat-verified");
  const elPending  = $("#stat-pending");
  if (elSignups)  elSignups.textContent  = total;
  if (elVerified) elVerified.textContent = verified;
  if (elPending)  elPending.textContent  = pending;

  const elUsers = $("#stat-users");
  if (elUsers) elUsers.textContent = total;
  if ($("#stat-posts")) $("#stat-posts").textContent = state.posts.length;
  const ss = $("#stat-success");
  if (ss) ss.textContent = state.successCount;
}

function showToast(msg, type = "success", duration = 3000) {
  const container = $("#toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add("show"));
  });
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function handleShareApp() {
  const appUrl = "https://maharwazir363-code.github.io/MADADGAR-/";
  const shareText =
    "Salam! Agar aap ko kisi bhi kism ki madad chahiye ya aap kisi ki madad karna chahte hain, " +
    "toh abhi 'MADADGAR' app use karein: " + appUrl;

  if (navigator.share) {
    navigator.share({ title: "MADADGAR", text: shareText, url: appUrl }).catch(() => {});
  } else {
    navigator.clipboard.writeText(shareText)
      .then(() => showToast("✓ Link copy ho gaya!", "success"))
      .catch(() => {
        const ta = document.createElement("textarea");
        ta.value = shareText;
        ta.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        showToast("✓ Link copy ho gaya!", "success");
      });
  }
}

async function handleForgotPassword() {
  const email = $("#forgot-email").value.trim().toLowerCase();
  if (!email) {
    showError("forgot-error", "Email address daalen.");
    return;
  }
  const btn = $("#forgot-btn-text");
  btn.textContent = "Bhej rahe hain...";
  $("#forgot-submit").disabled = true;
  showError("forgot-error", "");
  try {
    await auth.sendPasswordResetEmail(email);
    $("#forgot-modal").hidden = true;
    $("#forgot-email").value = "";
    showToast("Password reset link sent! Please check your Gmail Inbox.", "success", 5000);
  } catch (err) {
    let msg = "Kuch masla aaya. Phir koshish karein.";
    if (err.code === "auth/user-not-found")
      msg = "Yeh email registered nahi hai.";
    else if (err.code === "auth/invalid-email")
      msg = "Sahi email format daalen. (maslan: abc@gmail.com)";
    else if (err.code === "auth/too-many-requests")
      msg = "Bahut zyada tries. Thodi der baad try karein.";
    showError("forgot-error", msg);
  } finally {
    btn.textContent = "Reset Link Bhejein";
    $("#forgot-submit").disabled = false;
  }
}

let _pendingReportId = null;

function handleReportPost(postId) {
  _pendingReportId = postId;
  if ($("#report-modal")) $("#report-modal").hidden = false;
}

async function submitReport() {
  const postId = _pendingReportId;
  _pendingReportId = null;
  if ($("#report-modal")) $("#report-modal").hidden = true;
  if (!postId) return;
  try {
    await db.ref("posts/" + postId).transaction((current) => {
      if (!current) return current;
      current.reportsCount = (current.reportsCount || 0) + 1;
      return current;
    });
    try {
      const key = "madadgar_reported_v1";
      const list = JSON.parse(localStorage.getItem(key) || "[]");
      if (!list.includes(postId)) {
        list.push(postId);
        localStorage.setItem(key, JSON.stringify(list));
      }
    } catch {}
    showToast("⚠️ Post report ho gaya. Admin review karega.", "info", 3500);
  } catch (err) {
    console.error("Report failed:", err);
    showToast("Report fail hua. Phir koshish karein.", "info");
  }
}

function renderReportedPosts() {
  const container = $("#reported-posts-list");
  if (!container) return;

  const reported = state.posts
    .filter((p) => (p.reportsCount || 0) >= 1)
    .sort((a, b) => (b.reportsCount || 0) - (a.reportsCount || 0));

  if (reported.length === 0) {
    container.innerHTML = `<div class="reported-empty muted small">Koi reported post nahi hai. ✓</div>`;
    return;
  }

  container.innerHTML = reported
    .map((p) => {
      const title = escapeHtml(
        p.category || (p.type === "job_seeker" ? "Worker Profile" : "Job Post")
      );
      const meta = [p.address, p.username ? "@" + p.username : ""]
        .filter(Boolean)
        .map(escapeHtml)
        .join(" • ");
      return `
      <div class="reported-post-item">
        <div class="reported-post-info">
          <div class="reported-post-title">${title}</div>
          <div class="reported-post-meta">${meta}</div>
        </div>
        <div class="report-count-tag">⚠️ ${p.reportsCount}</div>
        <button class="user-action-btn danger" data-act="delete-reported" data-id="${escapeHtml(p.id)}">🗑 Delete</button>
      </div>`;
    })
    .join("");
}

function updateSuccessBar() {
  const sc = $("#success-count");
  if (sc) sc.textContent = state.successCount;
  const ss = $("#stat-success");
  if (ss) ss.textContent = state.successCount;
}

function renderAdminUsersTable() {
  const body = $("#users-table-body");
  if (!body) return;

  if (!state.usersLoaded) {
    body.innerHTML = _skeletonUserRows(4);
    return;
  }
  if (state.usersError) {
    body.innerHTML = `
      <div class="empty-block">
        <div class="big">⚠️</div>
        <div class="title">Users load nahi hue</div>
        <div class="muted small" style="margin-top:6px;word-break:break-all">${escapeHtml(state.usersError)}</div>
        <button class="btn btn-outline" style="margin-top:12px" onclick="retryLoadUsers()">↺ Phir Koshish Karein</button>
      </div>`;
    return;
  }
  if (state.users.length === 0) {
    body.innerHTML = `
      <div class="empty-block">
        <div class="big">👥</div>
        <div class="title">Abhi koi user register nahi hai</div>
      </div>`;
    return;
  }

  const postCounts = {};
  state.posts.forEach((p) => {
    if (p.username) postCounts[p.username] = (postCounts[p.username] || 0) + 1;
  });

  // FIX: user-row click handled via delegated listener in attachEvents;
  // data-username is already on the row so clicking anywhere on it
  // (but not on the Delete button) navigates to the user detail screen.
  body.innerHTML = state.users
    .map((u) => {
      const count = postCounts[u.username] || 0;
      return `
      <div class="user-row" data-username="${escapeHtml(u.username)}" style="cursor:pointer;">
        <div class="user-name-col">
          <div class="user-name">${escapeHtml(u.fullName)}</div>
          <div class="user-handle">@${escapeHtml(u.username)}</div>
          ${u.blocked ? '<span class="blocked-tag">🚫 BLOCKED</span>' : ""}
          ${
            u.emailVerified === true
              ? '<span class="status-badge verified">✓ Verified</span>'
              : '<span class="status-badge pending">⏳ Pending</span>'
          }
        </div>
        <div class="user-email">${escapeHtml(u.email || "—")}</div>
        <div class="user-posts-col"><div class="user-posts-num">${count}</div></div>
        <button class="user-action-btn danger" data-act="delete-user" data-username="${escapeHtml(u.username)}">
          🗑 Delete
        </button>
      </div>`;
    })
    .join("");
}

// FIX: loadUserChatsInAdmin is now called AFTER container.innerHTML is set
// so that #admin-user-messages-container actually exists in the DOM.
function renderAdminUser() {
  if (!state.adminUserView) return;
  const username = state.adminUserView;
  const u = state.users.find((x) => x.username === username);
  const container = $("#admin-user-content");
  if (!container) return;

  if (!u) {
    container.innerHTML = `
      <div class="empty-block">
        <div class="big">⚠️</div>
        <div class="title">User nahi mila</div>
      </div>`;
    return;
  }

  const userPosts = state.posts.filter((p) => p.username === username);
  const initial   = (u.fullName || "U").charAt(0).toUpperCase();
  const joinedDate = u.createdAt
    ? new Date(u.createdAt).toLocaleDateString("en-PK", {
        day: "numeric", month: "short", year: "numeric",
      })
    : "-";

  // Remove any pre-existing static duplicate chat history cards from HTML
  // (handles cases where the HTML file already has a hard-coded admin-chat-history-card)
  document.querySelectorAll("#admin-chat-history-card").forEach((el) => el.remove());

  // Render the full template — single, authoritative chat history card
  container.innerHTML = `
    <div class="profile-card">
      <div class="avatar">${escapeHtml(initial)}</div>
      <div class="profile-info">
        <div class="profile-name">${escapeHtml(u.fullName)}</div>
        <div class="profile-handle">@${escapeHtml(u.username)}</div>
        <div class="profile-meta"><span class="ic">📧</span>${u.email ? `<a href="mailto:${escapeHtml(u.email)}">${escapeHtml(u.email)}</a>` : "-"}</div>
        <div class="profile-meta"><span class="ic">📅</span><span class="muted">Joined ${joinedDate}</span></div>
        <div class="profile-meta"><span class="ic">📝</span><span class="bold" style="color:#007bff;font-weight:bold;">Total Posts: ${userPosts.length}</span></div>
        <div class="status-badge ${u.blocked ? "blocked" : "active"}">
          ${u.blocked ? "🚫 BLOCKED" : "✓ ACTIVE"}
        </div>
      </div>
    </div>

    <div style="margin:15px 0;">
      <button class="btn btn-outline"
        style="background:#25D366;color:white;border:none;width:100%;padding:12px;font-weight:bold;border-radius:8px;"
        onclick="openChatWithUser('${escapeHtml(u.username)}','${escapeHtml(u.fullName)}','')">
        💬 Chat With ${escapeHtml(u.fullName)}
      </button>
    </div>

    <div style="display:flex;gap:10px;margin-bottom:15px;flex-wrap:wrap;">
      <button class="user-action-btn"
        data-act="${u.blocked ? 'unblock-user' : 'block-user'}"
        data-username="${escapeHtml(u.username)}"
        style="background:${u.blocked ? '#28a745' : '#fd7e14'};color:white;border:none;padding:10px 16px;border-radius:6px;cursor:pointer;flex:1;">
        ${u.blocked ? "✅ Unblock User" : "🚫 Block User"}
      </button>
      <button class="user-action-btn danger"
        data-act="delete-user"
        data-username="${escapeHtml(u.username)}"
        style="background:#dc3545;color:white;border:none;padding:10px 16px;border-radius:6px;cursor:pointer;flex:1;">
        🗑️ Delete User
      </button>
    </div>

    <div class="posts-header">Posts by ${escapeHtml(u.fullName)} (${userPosts.length})</div>
    <div class="posts-list">
      ${userPosts.length === 0
        ? `<div class="empty-block">
             <div class="big">📭</div>
             <div class="title">Is user ne abhi koi post nahi ki</div>
           </div>`
        : userPosts.map((p) => postCardHTML(p, { adminMode: true })).join("")
      }
    </div>

    <div id="admin-chat-history-card" style="
        margin: 15px 0;
        background: #fff;
        padding: 15px;
        border-radius: 8px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.05);
        border-top: 4px solid #075E54;">
      <h3 style="margin-top: 0; color: #075E54; font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 8px;">
        📋 User Chat History (Admin View)
      </h3>
      <div id="admin-user-messages-container" style="max-height: 420px; overflow-y: auto; display: flex; flex-direction: column; gap: 0; padding: 0;">
        <p style="color: #888; font-style: italic; font-size: 13px; padding: 8px;">⏳ Chat history load ho rahi hai...</p>
      </div>
    </div>`;

  // Call AFTER innerHTML is set so the container element exists in the DOM
  loadUserChatsInAdmin(username);
}

function updateBottomHint() {
  const el = $("#bottom-hint");
  if (el) {
    el.textContent = state.user
      ? `Hi ${state.user.fullName || state.user.username}!`
      : "Hi!";
  }
  const mobileInput = $("#post-mobile-input");
  if (mobileInput && !state.editPostId) mobileInput.value = "";
  if ($("#menu-name")) $("#menu-name").textContent = state.user?.fullName || "—";
  if ($("#menu-sub")) $("#menu-sub").textContent = state.user ? "@" + state.user.username : "@—";
}

/* ----------------------------- Events ----------------------------- */
function attachEvents() {
  $("#form-login").addEventListener("submit", handleLogin);

  $("#signup-btn").addEventListener("click", handleSignup);
  if ($("#go-to-login-btn")) {
    $("#go-to-login-btn").addEventListener("click", () => {
      resetSignupUI();
      showScreen("login");
    });
  }

  $$(".eye-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = document.getElementById(btn.dataset.target);
      if (t) t.type = t.type === "password" ? "text" : "password";
    });
  });

  $("#go-signup").addEventListener("click", () => showScreen("signup"));
  $("#go-login").addEventListener("click", (e) => {
    e.preventDefault();
    resetSignupUI();
    showScreen("login");
  });
  if ($("#back-from-signup")) {
    $("#back-from-signup").addEventListener("click", () => {
      resetSignupUI();
      showScreen("login");
    });
  }

  $$(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.filter = btn.dataset.filter;
      state.addressSearch = "";
      state.categorySearch = "";
      if ($("#search-address")) $("#search-address").value = "";
      if ($("#search-category")) $("#search-category").value = "";
      if ($("#category-search-wrap")) $("#category-search-wrap").style.display = "";
      renderHome();
    });
  });

  if ($("#search-address")) {
    $("#search-address").addEventListener("input", (e) => {
      state.addressSearch = e.target.value;
      $$(".clear-btn[data-clear='search-address']").forEach(
        (b) => (b.hidden = !e.target.value)
      );
      renderHome();
    });
  }
  if ($("#search-category")) {
    $("#search-category").addEventListener("input", (e) => {
      state.categorySearch = e.target.value;
      $$(".clear-btn[data-clear='search-category']").forEach(
        (b) => (b.hidden = !e.target.value)
      );
      renderHome();
    });
  }
  $$(".clear-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.clear;
      if ($("#" + id)) {
        $("#" + id).value = "";
        $("#" + id).dispatchEvent(new Event("input"));
      }
    });
  });

  if ($("#open-history")) {
    $("#open-history").addEventListener("click", () => {
      showScreen("history");
      renderHistory();
    });
  }
  if ($("#back-from-history")) {
    $("#back-from-history").addEventListener("click", () => showScreen("home"));
  }

  if ($("#open-menu")) {
    $("#open-menu").addEventListener("click", () => {
      if ($("#menu-backdrop")) $("#menu-backdrop").hidden = false;
    });
  }
  if ($("#menu-backdrop")) {
    $("#menu-backdrop").addEventListener("click", (e) => {
      if (e.target === $("#menu-backdrop")) $("#menu-backdrop").hidden = true;
    });
  }
  if ($("#menu-history")) {
    $("#menu-history").addEventListener("click", () => {
      if ($("#menu-backdrop")) $("#menu-backdrop").hidden = true;
      showScreen("history");
      renderHistory();
    });
  }
  if ($("#menu-logout")) {
    $("#menu-logout").addEventListener("click", () => {
      if ($("#menu-backdrop")) $("#menu-backdrop").hidden = true;
      logout();
    });
  }
  if ($("#menu-share")) {
    $("#menu-share").addEventListener("click", () => {
      if ($("#menu-backdrop")) $("#menu-backdrop").hidden = true;
      handleShareApp();
    });
  }

  if ($("#open-add-post")) {
    $("#open-add-post").addEventListener("click", () => {
      if (!state.user) return;
      resetAddPostForm();
      $("#add-post-modal").hidden = false;
    });
  }
  if ($("#close-add-post")) {
    $("#close-add-post").addEventListener("click", () => {
      $("#add-post-modal").hidden = true;
      resetAddPostForm();
    });
  }
  if ($("#edit-cancel-btn")) {
    $("#edit-cancel-btn").addEventListener("click", () => {
      $("#add-post-modal").hidden = true;
      resetAddPostForm();
    });
  }
  if ($("#add-post-modal")) {
    $("#add-post-modal").addEventListener("click", (e) => {
      if (e.target.id === "add-post-modal") {
        $("#add-post-modal").hidden = true;
        resetAddPostForm();
      }
    });
  }

  $$(".type-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".type-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.postType = btn.dataset.type;
      if ($("#salary-field")) $("#salary-field").hidden = state.postType !== "employer";
    });
  });

  if ($("#post-category")) {
    $("#post-category").addEventListener("change", (e) => {
      if ($("#post-custom-category")) $("#post-custom-category").hidden = e.target.value !== "Other";
    });
  }

  if ($("#form-add-post")) {
    $("#form-add-post").addEventListener("submit", async (e) => {
      e.preventDefault();
      showError("post-error", "");
      const cat = $("#post-category").value;
      const customCat = $("#post-custom-category").value.trim();
      let salary = $("#post-salary").value.trim();
      if (salary) {
        const stripped = salary.replace(/^rs\.?\s*/i, "").trim();
        salary = stripped ? "Rs. " + stripped : "";
      }
      const address = $("#post-address").value.trim();
      if (!cat)
        return showError("post-error", "Category select karein (Driver, Electrician, etc.)");
      if (cat === "Other" && !customCat)
        return showError("post-error", "Apni category ka naam likhein.");
      if (!address)
        return showError("post-error", "Address/Jagah daalna zaroori hai.");
      const mobile = $("#post-mobile-input").value.trim();
      if (!mobile)
        return showError("post-error", "Mobile number daalna zaroori hai.");

      const submit = $("#post-submit");
      submit.textContent = "SAVE HO RAHA HAI...";
      submit.disabled = true;
      try {
        if (state.editPostId) {
          await updatePostInFirebase(state.editPostId, {
            type: state.postType,
            category: cat === "Other" ? customCat : cat,
            salary: state.postType === "employer" ? salary : "",
            mobileNumber: mobile,
            address,
          });
        } else {
          await addPostToFirebase({
            type: state.postType,
            category: cat === "Other" ? customCat : cat,
            salary: state.postType === "employer" ? salary : "",
            mobileNumber: mobile,
            username: state.user.username,
            ownerName: state.user.fullName,
            address,
          });
        }
        $("#add-post-modal").hidden = true;
        resetAddPostForm();
      } catch (err) {
        console.error(err);
        showError("post-error", "Post save nahi hua. Phir koshish karein.");
      } finally {
        submit.textContent = state.editPostId ? "SAVE KAREIN" : "POST KAREIN";
        submit.disabled = false;
      }
    });
  }

  // Hidden admin gate: 5 quick taps on the login logo
  const loginLogo = document.querySelector("#screen-login .logo-box");
  if (loginLogo) {
    let clickCount = 0;
    let clickTimer = null;
    loginLogo.addEventListener("click", () => {
      clickCount++;
      clearTimeout(clickTimer);
      if (clickCount >= 5) {
        clickCount = 0;
        openAdminGate();
        return;
      }
      clickTimer = setTimeout(() => { clickCount = 0; }, 1500);
    });
  }

  if ($("#admin-gate-form")) {
    $("#admin-gate-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const pwd = $("#admin-gate-input").value;
      if (pwd === ADMIN_PASSWORD) {
        state.user = { username: "admin", fullName: "Super Admin", email: "", isAdmin: true };
        persistUser();
        closeAdminGate();
        _showWelcomeOverlay(() => {
          auth.signInAnonymously()
            .catch(() => {
              console.warn("Anonymous auth unavailable — enable it in Firebase Console → Authentication → Sign-in providers → Anonymous.");
            })
            .finally(() => enterApp());
        });
      } else {
        closeAdminGate();
      }
    });
  }
  if ($("#admin-gate-backdrop")) {
    $("#admin-gate-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "admin-gate-backdrop") closeAdminGate();
    });
  }
  if ($("#admin-gate-cancel")) {
    $("#admin-gate-cancel").addEventListener("click", closeAdminGate);
  }

  if ($("#admin-logout")) $("#admin-logout").addEventListener("click", logout);
  if ($("#back-from-admin-user")) {
    $("#back-from-admin-user").addEventListener("click", () => {
      state.adminUserView = null;
      showScreen("admin");
    });
  }

  // Single delegated click handler for all data-act buttons + user-row clicks
  document.addEventListener("click", async (e) => {
    const target = e.target.closest("[data-act]");
    if (!target) {
      // Row click (not on any action button)
      const row = e.target.closest(".user-row");
      if (row && state.user?.isAdmin) {
        state.adminUserView = row.dataset.username;
        showScreen("admin-user");
        renderAdminUser();
      }
      return;
    }
    const act = target.dataset.act;

    if (act === "call") {
      const mobile = target.dataset.mobile;
      if (mobile) window.location.href = "tel:" + mobile;
      return;
    }
    if (act === "delete-user") {
      e.stopPropagation();
      const username = target.dataset.username;
      if (username) await deleteUser(username);
      return;
    }
    if (act === "block-user") {
      e.stopPropagation();
      const username = target.dataset.username;
      if (username && confirm(`Kya aap @${username} ko block karna chahte hain?`)) {
        await db.ref("users/" + username + "/blocked").set(true);
        showToast(`@${username} block ho gaya.`, "success");
      }
      return;
    }
    if (act === "unblock-user") {
      e.stopPropagation();
      const username = target.dataset.username;
      if (username && confirm(`Kya aap @${username} ko unblock karna chahte hain?`)) {
        await db.ref("users/" + username + "/blocked").set(false);
        showToast(`@${username} unblock ho gaya.`, "success");
      }
      return;
    }
    if (act === "edit-post") {
      e.stopPropagation();
      const id = target.dataset.id;
      const post = state.posts.find((p) => p.id === id);
      if (post) openEditPost(post);
      return;
    }
    if (act === "mark-done") {
      e.stopPropagation();
      const id = target.dataset.id;
      if (id) await markPostDone(id);
      return;
    }
    if (act === "reset-done") {
      e.stopPropagation();
      const id = target.dataset.id;
      if (id) await resetPostDone(id);
      return;
    }
    if (act === "delete-post" || act === "delete-mine") {
      const id = target.dataset.id;
      if (!id) return;
      if (!confirm("Pakka is post ko delete karna hai?")) return;
      try {
        await deletePostFromFirebase(id);
      } catch (err) {
        alert("Delete fail. Phir try karein.");
      }
      return;
    }
    if (act === "report-post") {
      e.stopPropagation();
      const id = target.dataset.id;
      if (id) handleReportPost(id);
      return;
    }
    if (act === "delete-reported") {
      e.stopPropagation();
      const id = target.dataset.id;
      if (!id) return;
      if (!confirm("Is reported post ko permanently delete karna hai?")) return;
      try {
        await deletePostFromFirebase(id);
        showToast("Post delete ho gaya.", "success");
      } catch (err) {
        alert("Delete fail. Phir try karein.");
      }
      return;
    }
  });

  if ($("#forgot-password-btn")) {
    $("#forgot-password-btn").addEventListener("click", () => {
      showError("forgot-error", "");
      if ($("#forgot-email")) $("#forgot-email").value = "";
      if ($("#forgot-modal")) $("#forgot-modal").hidden = false;
      setTimeout(() => { if ($("#forgot-email")) $("#forgot-email").focus(); }, 60);
    });
  }
  if ($("#forgot-cancel")) {
    $("#forgot-cancel").addEventListener("click", () => {
      if ($("#forgot-modal")) $("#forgot-modal").hidden = true;
    });
  }
  if ($("#forgot-submit")) {
    $("#forgot-submit").addEventListener("click", handleForgotPassword);
  }
  if ($("#forgot-email")) {
    $("#forgot-email").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); handleForgotPassword(); }
    });
  }
  if ($("#forgot-modal")) {
    $("#forgot-modal").addEventListener("click", (e) => {
      if (e.target === $("#forgot-modal")) $("#forgot-modal").hidden = true;
    });
  }

  if ($("#report-cancel")) {
    $("#report-cancel").addEventListener("click", () => {
      _pendingReportId = null;
      if ($("#report-modal")) $("#report-modal").hidden = true;
    });
  }
  if ($("#report-confirm-btn")) {
    $("#report-confirm-btn").addEventListener("click", () => submitReport());
  }
  if ($("#report-modal")) {
    $("#report-modal").addEventListener("click", (e) => {
      if (e.target === $("#report-modal")) {
        _pendingReportId = null;
        $("#report-modal").hidden = true;
      }
    });
  }
}

function resetAddPostForm() {
  state.postType = "job_seeker";
  $$(".type-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.type === "job_seeker")
  );
  if ($("#post-category")) $("#post-category").value = "";
  if ($("#post-custom-category")) {
    $("#post-custom-category").value = "";
    $("#post-custom-category").hidden = true;
  }
  if ($("#post-salary")) $("#post-salary").value = "";
  if ($("#salary-field")) $("#salary-field").hidden = true;
  if ($("#post-address")) $("#post-address").value = "";
  if ($("#post-mobile-input")) $("#post-mobile-input").value = "";
  state.editPostId = null;
  if ($("#post-modal-title")) $("#post-modal-title").textContent = "Naya Post Karein";
  if ($("#post-submit")) $("#post-submit").textContent = "POST KAREIN";
  if ($("#edit-cancel-btn")) $("#edit-cancel-btn").hidden = true;
  showError("post-error", "");
  updateBottomHint();
}

/* ── Welcome overlay — shown on correct admin password ───────────────── */
function _showWelcomeOverlay(onDone) {
  const ov = document.createElement("div");
  ov.id = "_admin-welcome-ov";
  ov.style.cssText = [
    "position:fixed","inset:0","z-index:99998",
    "display:flex","flex-direction:column",
    "align-items:center","justify-content:center","gap:32px",
    "background:linear-gradient(160deg,#050a14 0%,#0f172a 45%,#1a3054 100%)",
    "opacity:0","transition:opacity 0.65s ease",
    "padding:40px 28px","text-align:center","overflow:hidden",
  ].join(";");

  ov.innerHTML = `
    <div style="position:absolute;inset:0;pointer-events:none;">
      <div style="
        position:absolute;top:-30%;left:50%;transform:translateX(-50%);
        width:520px;height:520px;
        background:radial-gradient(circle,rgba(251,191,36,0.09) 0%,transparent 68%);
        border-radius:50%;
      "></div>
      <div style="
        position:absolute;bottom:-20%;right:-10%;
        width:300px;height:300px;
        background:radial-gradient(circle,rgba(30,64,175,0.15) 0%,transparent 70%);
        border-radius:50%;
      "></div>
    </div>
    <div style="
      font-size:clamp(17px,4.2vw,32px);
      font-weight:900;letter-spacing:2.5px;line-height:1.3;
      background:linear-gradient(135deg,#fbbf24 0%,#ffffff 55%,#fde68a 100%);
      -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
      filter:drop-shadow(0 0 18px rgba(251,191,36,0.5));
      padding:0 12px;position:relative;z-index:1;
    ">WELCOME<br>MAHAR SHOAIB<br>
    <span style='font-size:0.62em;letter-spacing:5px;'>THE KING OF TECHNOLOGY</span></div>
    <div style="position:relative;z-index:1;">
      <img src="Shoaib.jpg" alt="Shoaib"
        id="_welcome-pic"
        style="
          width:116px;height:116px;border-radius:50%;object-fit:cover;display:block;
          border:2.5px solid rgba(251,191,36,0.8);
          box-shadow:0 0 0 6px rgba(251,191,36,0.12),0 10px 32px rgba(0,0,0,0.55),
                     0 0 48px rgba(251,191,36,0.2);
        "
        onerror="this.style.display='none';document.getElementById('_welcome-fb').style.display='flex';"
      >
      <div id="_welcome-fb" style="
        display:none;width:116px;height:116px;border-radius:50%;
        background:linear-gradient(135deg,#1e3a8a,#1e40af);
        border:2.5px solid rgba(251,191,36,0.8);
        box-shadow:0 0 0 6px rgba(251,191,36,0.12),0 10px 32px rgba(0,0,0,0.55);
        align-items:center;justify-content:center;font-size:46px;
      ">🛡️</div>
    </div>`;

  document.body.appendChild(ov);
  requestAnimationFrame(() => requestAnimationFrame(() => { ov.style.opacity = "1"; }));
  setTimeout(() => {
    ov.style.opacity = "0";
    setTimeout(() => { ov.remove(); onDone(); }, 700);
  }, 2600);
}

function openAdminGate() {
  const bd = $("#admin-gate-backdrop");
  const input = $("#admin-gate-input");
  if (!bd || !input) return;
  input.value = "";
  bd.hidden = false;
  setTimeout(() => input.focus(), 50);
}
function closeAdminGate() {
  if ($("#admin-gate-backdrop")) $("#admin-gate-backdrop").hidden = true;
  if ($("#admin-gate-input")) $("#admin-gate-input").value = "";
}

/* ----------------------------- Boot ----------------------------- */
function enterApp() {
  // FIX: setupUserPresence only called once here (removed from handleLogin)
  setupUserPresence();
  updateBottomHint();
  subscribeStats();
  if (state.user.isAdmin) {
    showScreen("admin");
    subscribePosts();
    subscribeUsers();
    renderAdminUsersTable();
    renderAdminStats();
    renderReportedPosts();
  } else {
    showScreen("home");
    subscribePosts();
    renderHome();
    updateSuccessBar();
    listenForChatNotifications();
  }
}

/* ── Dark mode — persisted preference ───────────────────────────────── */
function initDarkMode() {
  const saved = localStorage.getItem("madadgar_theme") || "light";
  const btn   = document.getElementById("theme-toggle-btn");

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
    localStorage.setItem("madadgar_theme", theme);
  }

  applyTheme(saved);

  if (btn) {
    btn.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") || "light";
      applyTheme(cur === "dark" ? "light" : "dark");
    });
  }
}

/* ── Skeleton loader HTML helpers ───────────────────────────────────── */
function _skeletonPostCards(n) {
  n = n || 3;
  return Array.from({ length: n }, () => `
    <div class="skel-card">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <div class="skel" style="width:70px;height:10px;"></div>
        <div class="skel" style="width:50px;height:10px;"></div>
      </div>
      <div class="skel skel-line lg" style="width:85%;"></div>
      <div class="skel skel-line" style="width:65%;"></div>
      <div class="skel skel-line" style="width:75%;"></div>
      <div class="skel-actions">
        <div class="skel skel-btn"></div>
        <div class="skel skel-btn"></div>
        <div class="skel skel-btn"></div>
      </div>
    </div>`).join("");
}

function _skeletonUserRows(n) {
  n = n || 4;
  return Array.from({ length: n }, () => `
    <div class="skel-row">
      <div class="skel skel-avatar"></div>
      <div class="skel-row-body">
        <div class="skel skel-row-line" style="width:60%;"></div>
        <div class="skel skel-row-line"></div>
      </div>
      <div class="skel" style="width:36px;height:20px;flex-shrink:0;border-radius:6px;"></div>
      <div class="skel skel-btn" style="width:72px;flex-shrink:0;border-radius:8px;"></div>
    </div>`).join("");
}

function init() {
  initDarkMode();
  attachEvents();
  state.user = loadPersistedUser();
  if (state.user) {
    enterApp();
  } else {
    showScreen("login");
  }
  setTimeout(() => {
    const splash = $("#splash");
    if (splash) {
      splash.classList.add("hidden");
      setTimeout(() => splash.remove(), 300);
    }
  }, 100);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

/* ----------------------------- PWA ----------------------------- */
let deferredPrompt;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const topBar = document.getElementById("pwa-top-bar");
  if (topBar) topBar.style.display = "flex";
});

function openInstallModal() {
  const modal = document.getElementById("pwa-install-modal");
  if (modal) modal.style.display = "block";
}
function closeTopBar() {
  const topBar = document.getElementById("pwa-top-bar");
  if (topBar) topBar.style.display = "none";
}
function closeInstallModal() {
  const modal = document.getElementById("pwa-install-modal");
  if (modal) modal.style.display = "none";
}

document.addEventListener("DOMContentLoaded", () => {
  const installBtn = document.getElementById("pwa-install-btn");
  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      const btnText = document.getElementById("btn-text");
      if (btnText) btnText.innerText = "Downloading...";
      setTimeout(async () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          console.log(`User choice: ${outcome}`);
          deferredPrompt = null;
        } else {
          window.location.href = "https://maharwazir363-code.github.io/MADADGAR-/app.apk";
        }
        if (btnText) btnText.innerText = "Install App";
        closeInstallModal();
      }, 1500);
    });
  }
});

/* ----------------------------- Profile ----------------------------- */
/* ── Profile picture upload — FREE (base64 via canvas, no Firebase Storage) ── */
const profileFilePicker = document.getElementById("profile-file-picker");
if (profileFilePicker) {
  profileFilePicker.addEventListener("change", async function (e) {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    const currentUserID = (state.user && state.user.username) ? state.user.username : "test_user";
    const myProfilePic = document.getElementById("my-profile-pic");

    // Show preview immediately (loading state)
    if (myProfilePic) {
      const previewReader = new FileReader();
      previewReader.onload = (ev) => {
        myProfilePic.src = ev.target.result;
        myProfilePic.style.opacity = "0.5";
      };
      previewReader.readAsDataURL(file);
    }

    try {
      // Resize to max 300×300 for profile pics (keeps RTDB node small)
      const base64 = await _resizeImageToBase64(file, 300, 0.80);

      if (myProfilePic) {
        myProfilePic.src = base64;
        myProfilePic.style.opacity = "1";
      }
      if (state.user) state.user.profilePic = base64;
      persistUser();
      await firebase.database().ref("users/" + currentUserID).update({ profilePic: base64 });
      showToast("Profile picture update ho gayi! ✅", "success");
    } catch (err) {
      console.error("Profile pic error:", err);
      if (myProfilePic) myProfilePic.style.opacity = "1";
      showToast("Upload mein masla aaya. Phir try karein.", "error");
    }
    e.target.value = ""; // reset so same file can be re-selected
  });
}

function openProfileModal() {
  const modal = document.getElementById("profile-modal");
  if (!modal) return;
  if (state.user) {
    const nameField   = document.getElementById("my-profile-name");
    const handleField = document.getElementById("my-profile-status");
    const picField    = document.getElementById("my-profile-pic");
    if (nameField)   nameField.innerText   = state.user.fullName || "MADADGAR User";
    if (handleField) handleField.innerText = "@" + (state.user.username || "username");
    if (state.user.profilePic && picField) picField.src = state.user.profilePic;
  }
  modal.style.display = "flex";
}

/* =====================================================================
   CHAT SYSTEM — Real-time Firebase chat with blue ticks & timestamps
   =====================================================================
   Firebase data structure:
     chat_rooms/{roomId}/
       participants:      { userA: true, userB: true }
       participantNames:  { userA: "Full Name A", userB: "Full Name B" }
       lastMessage:       "Hello"
       lastTimestamp:     SERVER_TIMESTAMP
       unread:            { userA: 0, userB: 2 }

     chats/{roomId}/{pushId}/
       senderID:   "userA"
       text:       "Hello"
       timestamp:  SERVER_TIMESTAMP
       seen:       false          ← turns true when receiver opens the chat
   ===================================================================== */

// ── module-level state ────────────────────────────────────────────────
let _chatRoomID          = "";    // currently open room
let _chatMsgListener     = null;  // Firebase ref (chats/{roomId}) — detach on close
let _presenceListener    = null;  // Firebase ref (users/{id}/status)
let _inboxListener       = null;  // Firebase ref (chat_rooms) for inbox list
let _unreadBadgeListener = null;  // Firebase ref (chat_rooms) for global badge
let _adminThreadRef      = null;  // Active real-time listener for admin thread view
// Typing indicator
let _typingTimer         = null;  // debounce handle
let _typingRef           = null;  // my own typing node in Firebase
let _typingListenerRef   = null;  // listener on the other person's typing node
// Voice recording
let _mediaRecorder       = null;
let _audioChunks         = [];
let _isRecording         = false;
let _recTimerInterval    = null;

/* ── helpers ─────────────────────────────────────────────────────────── */

// Deterministic room ID: always smaller_larger so A↔B and B↔A share same room
function _roomId(a, b) { return a < b ? a + "_" + b : b + "_" + a; }

// Human-readable timestamp for chat bubbles
function formatChatTime(ts) {
  if (!ts) return "";
  const now      = new Date();
  const date     = new Date(ts);
  const diffDays = Math.floor((now - date) / 86400000);
  if (diffDays === 0) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7)  return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

/* ── open chat window ────────────────────────────────────────────────── */
function openChatWithUser(receiverID, receiverName, receiverPic) {
  if (!state.user || !receiverID) return;
  const me = state.user.username;
  if (me === receiverID) { alert("Aap apne aap ko message nahi bhej sakte!"); return; }

  // Close any existing open room first
  _closeChatListeners();

  _chatRoomID      = _roomId(me, receiverID);
  state.activeChat = receiverID;

  // Header
  const nameEl   = document.getElementById("chat-user-name");
  const picEl    = document.getElementById("chat-user-pic");
  const statusEl = document.getElementById("chat-user-status");
  if (nameEl)   nameEl.innerText = receiverName || receiverID;
  if (picEl)    picEl.src = receiverPic || "https://cdn-icons-png.flaticon.com/512/149/149071.png";
  if (statusEl) { statusEl.innerText = ""; statusEl.style.color = "#888"; }

  // Show modal
  const modal = document.getElementById("chat-modal");
  if (modal) modal.style.display = "flex";

  // Clear messages area
  const area = document.getElementById("chat-messages-area");
  if (area) area.innerHTML = `<p style="text-align:center;color:#999;font-size:13px;padding:20px;">Messages load ho rahi hain...</p>`;

  // -- child_added: append new messages in real-time without full re-render
  const msgsRef = db.ref("chats/" + _chatRoomID);
  _chatMsgListener = msgsRef;

  msgsRef.on("child_added", (snap) => {
    _appendBubble(snap.key, snap.val(), me);
    if (area) area.scrollTo({ top: area.scrollHeight, behavior: "smooth" });
  });

  // -- child_changed: update blue tick when our sent message becomes seen
  msgsRef.on("child_changed", (snap) => {
    const msg = snap.val();
    if (!msg || msg.senderID !== me) return;
    const el = document.getElementById("tick-" + snap.key);
    if (el && msg.seen) { el.textContent = "✓✓"; el.style.color = "#60A5FA"; }
  });

  // -- Mark all incoming messages seen
  _markSeen(_chatRoomID, me);

  // -- Reset my unread counter
  db.ref("chat_rooms/" + _chatRoomID + "/unread/" + me).set(0).catch(() => {});

  // -- Presence
  _listenToPresence(receiverID);

  // -- Inject extra input buttons (mic, location, attachment) & typing listener
  _ensureChatInputUI();
  _listenTyping(_chatRoomID, me, receiverID);
}

// ── Build inner HTML for a message bubble based on type ───────────────
function _bubbleContent(msg, isMine) {
  const type = msg.type || "text";

  if (type === "audio") {
    return `<audio controls src="${escapeHtml(msg.audioUrl || "")}"
      style="max-width:230px;outline:none;border-radius:8px;display:block;"></audio>`;
  }

  if (type === "location") {
    const url = msg.locationUrl || "#";
    const bg  = isMine ? "rgba(255,255,255,0.15)" : "#EFF6FF";
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"
      style="display:flex;align-items:center;gap:8px;padding:8px 10px;
             background:${bg};border-radius:8px;text-decoration:none;
             color:${isMine ? "#fff" : "#1E40AF"};">
        <span style="font-size:22px;">📍</span>
        <span style="font-size:13px;font-weight:600;">View Location on Map</span>
      </a>`;
  }

  if (type === "image") {
    return `<img src="${escapeHtml(msg.fileUrl || "")}" alt="Image"
      style="max-width:220px;max-height:220px;border-radius:8px;
             cursor:pointer;display:block;object-fit:cover;"
      onclick="_openImageFullscreen(this.src)"
      onerror="this.style.display='none'">`;
  }

  if (type === "document") {
    const bg   = isMine ? "rgba(255,255,255,0.15)" : "#EFF6FF";
    const col  = isMine ? "#fff" : "#111";
    const link = isMine ? "#9EC5FE" : "#1E40AF";
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;
                        background:${bg};border-radius:8px;">
      <span style="font-size:26px;">📄</span>
      <div style="min-width:0;">
        <div style="font-size:12px;font-weight:600;color:${col};
                    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;">
          ${escapeHtml(msg.fileName || "Document")}
        </div>
        <a href="${escapeHtml(msg.fileUrl || "")}" target="_blank"
           download="${escapeHtml(msg.fileName || "file")}"
           style="font-size:11px;color:${link};font-weight:600;text-decoration:none;">
           ⬇ Download
        </a>
      </div>
    </div>`;
  }

  // Default: plain text
  return escapeHtml(msg.text || "");
}

// Append one message bubble (handles all message types)
function _appendBubble(key, msg, myID) {
  const area = document.getElementById("chat-messages-area");
  if (!area) return;
  // Remove loading placeholder
  const ph = area.querySelector("p");
  if (ph) ph.remove();

  const isMine  = msg.senderID === myID;
  const timeStr = formatChatTime(msg.timestamp);
  const tick    = isMine
    ? `<span id="tick-${key}" style="font-size:10px;margin-left:4px;color:${msg.seen ? "#60A5FA" : "#aaa"};">${msg.seen ? "✓✓" : "✓"}</span>`
    : "";
  const type    = msg.type || "text";
  // Non-text types don't need full padding
  const pad     = (type === "image") ? "4px" : "8px 12px";
  const radius  = isMine ? "14px 14px 0 14px" : "14px 14px 14px 0";

  const w = document.createElement("div");
  w.style.cssText = `display:flex;flex-direction:column;align-items:${isMine ? "flex-end" : "flex-start"};margin-bottom:6px;`;
  w.innerHTML = `
    <div style="
      background:${isMine ? "#1E40AF" : "#ffffff"};
      color:${isMine ? "#fff" : "#111"};
      padding:${pad};border-radius:${radius};
      max-width:75%;word-wrap:break-word;font-size:14px;
      box-shadow:0 1px 2px rgba(0,0,0,0.1);overflow:hidden;">
      ${_bubbleContent(msg, isMine)}
    </div>
    <div style="font-size:10px;color:#999;margin-top:2px;">${timeStr}${tick}</div>`;
  area.appendChild(w);
}

// Mark all messages from the other person as seen in one batch write
function _markSeen(roomId, myID) {
  db.ref("chats/" + roomId).once("value").then((snap) => {
    if (!snap.exists()) return;
    const updates = {};
    snap.forEach((child) => {
      const m = child.val();
      if (m && m.senderID !== myID && m.seen === false)
        updates["chats/" + roomId + "/" + child.key + "/seen"] = true;
    });
    if (Object.keys(updates).length) db.ref().update(updates).catch(() => {});
  }).catch(() => {});
}

/* ── send a message ──────────────────────────────────────────────────── */
function sendMessage() {
  if (!state.user || !_chatRoomID) return;
  const me     = state.user.username;
  const myName = state.user.fullName || me;

  const inputEl = document.getElementById("chat-input-text");
  const text    = inputEl ? inputEl.value.trim() : "";
  if (!text) return;

  // Use state.activeChat — splitting _chatRoomID on "_" breaks for usernames with underscores
  const receiverID = state.activeChat || "";
  if (!receiverID) return;

  // Push message node
  db.ref("chats/" + _chatRoomID).push({
    senderID:  me,
    type:      "text",
    text:      text,
    timestamp: firebase.database.ServerValue.TIMESTAMP,
    seen:      false,
  }).then(() => {
    if (inputEl) inputEl.value = "";
  }).catch((err) => console.error("sendMessage:", err));

  // Update lightweight index (chat_rooms) for inbox & badge
  const receiverNameEl = document.getElementById("chat-user-name");
  const receiverName   = receiverNameEl ? receiverNameEl.innerText : receiverID;

  db.ref("chat_rooms/" + _chatRoomID).update({
    participants:     { [me]: true, [receiverID]: true },
    participantNames: { [me]: myName, [receiverID]: receiverName },
    lastMessage:      text,
    lastTimestamp:    firebase.database.ServerValue.TIMESTAMP,
  }).catch(() => {});

  // Increment receiver's unread counter
  db.ref("chat_rooms/" + _chatRoomID + "/unread/" + receiverID)
    .transaction((c) => (c || 0) + 1).catch(() => {});
}

/* ── close chat modal ────────────────────────────────────────────────── */
function closeChatModal() {
  const modal = document.getElementById("chat-modal");
  if (modal) modal.style.display = "none";
  _closeChatListeners();
  state.activeChat = null;
}

function _closeChatListeners() {
  if (_chatMsgListener)   { _chatMsgListener.off();   _chatMsgListener = null; }
  if (_presenceListener)  { _presenceListener.off();  _presenceListener = null; }
  if (_typingListenerRef) { _typingListenerRef.off(); _typingListenerRef = null; }
  // Clear typing status BEFORE nulling _typingRef so the write still fires
  _clearMyTypingStatus();
  _typingRef = null;
  if (_typingTimer) { clearTimeout(_typingTimer); _typingTimer = null; }
  _stopVoiceRecord();
  _chatRoomID = "";
  state.activeChat = null;
}

/* ── Inbox overlay — fully self-contained, no HTML screen dependency ── */
// Creates its own fixed overlay injected into <body> so it works regardless
// of how the HTML is structured.

function _getOrCreateInboxOverlay() {
  let overlay = document.getElementById("_madadgar-inbox-overlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "_madadgar-inbox-overlay";
  overlay.style.cssText = [
    "position:fixed", "inset:0", "z-index:9000",
    "background:#f0f4f8", "display:none",
    "flex-direction:column", "overflow:hidden",
    "font-family:inherit",
  ].join(";");

  overlay.innerHTML = `
    <!-- Header -->
    <div style="background:#1E40AF;color:white;display:flex;align-items:center;
                gap:10px;padding:0 12px;height:56px;flex-shrink:0;
                box-shadow:0 2px 4px rgba(0,0,0,0.2);">
      <button id="_inbox-back-btn"
        style="background:none;border:none;color:white;font-size:24px;
               cursor:pointer;padding:4px 8px 4px 0;line-height:1;flex-shrink:0;"
        aria-label="Back">&#8592;</button>
      <span style="font-size:18px;font-weight:700;flex:1;">Messages</span>
    </div>

    <!-- Conversation list -->
    <div id="_inbox-list"
      style="flex:1;overflow-y:auto;background:white;"></div>`;

  document.body.appendChild(overlay);

  // Back button
  overlay.querySelector("#_inbox-back-btn").addEventListener("click", closeInboxScreen);

  return overlay;
}

function openInboxScreen() {
  if (!state.user) return;

  const overlay = _getOrCreateInboxOverlay();
  overlay.style.display = "flex";

  _renderInboxList();
}

function closeInboxScreen() {
  const overlay = document.getElementById("_madadgar-inbox-overlay");
  if (overlay) overlay.style.display = "none";

  // Detach real-time listener when inbox is hidden to save bandwidth
  if (_inboxListener) { _inboxListener.off(); _inboxListener = null; }
}

// Alias — HTML back buttons may call either name
function goBackToHome() { closeInboxScreen(); }

// loadInbox() kept as a no-op so existing enterApp() references don't crash
function loadInbox() { /* inbox is now opened on-demand via openInboxScreen() */ }

function _renderInboxList() {
  const list = document.getElementById("_inbox-list");
  if (!list || !state.user) return;
  const me = state.user.username;

  list.innerHTML = `
    <div style="text-align:center;padding:30px;color:#888;font-size:13px;">
      Messages load ho rahi hain...
    </div>`;

  // Detach old listener before attaching a new one
  if (_inboxListener) { _inboxListener.off(); _inboxListener = null; }

  const ref = db.ref("chat_rooms").orderByChild("lastTimestamp");
  _inboxListener = ref;

  ref.on("value", (snap) => {
    // Collect rooms where I'm a participant
    const rooms = [];
    snap.forEach((child) => {
      const r = child.val();
      if (r && r.participants && r.participants[me])
        rooms.push({ id: child.key, ...r });
    });
    rooms.reverse(); // newest first

    list.innerHTML = "";

    if (rooms.length === 0) {
      list.innerHTML = `
        <div style="text-align:center;padding:60px 24px;color:#aaa;">
          <div style="font-size:56px;margin-bottom:12px;">💬</div>
          <p style="font-size:15px;margin:0;line-height:1.6;">
            Abhi koi chat nahi hai.<br>
            Kisi post par <strong>💬 Chat</strong> button dabayein!
          </p>
        </div>`;
      return;
    }

    rooms.forEach((room) => {
      const parts     = room.id.split("_");
      const otherID   = parts[0] === me ? parts[1] : parts[0];
      const otherName = (room.participantNames && room.participantNames[otherID]) || otherID;
      const unread    = (room.unread && room.unread[me]) || 0;
      const lastMsg   = room.lastMessage || "Chat shuru karein";
      const lastTime  = formatChatTime(room.lastTimestamp);
      const initial   = otherName.charAt(0).toUpperCase();

      // Build row
      const row = document.createElement("div");
      row.style.cssText = [
        "display:flex", "align-items:center", "gap:12px",
        "padding:13px 16px", "border-bottom:1px solid #f0f0f0",
        "cursor:pointer", "transition:background 0.15s", "background:white",
      ].join(";");
      row.addEventListener("mouseenter", () => { row.style.background = "#f7f9ff"; });
      row.addEventListener("mouseleave", () => { row.style.background = "white"; });

      // Avatar placeholder (replaced by real pic below if available)
      const avatarId  = "_av-" + room.id;
      const statusId  = "_st-" + room.id;
      const unreadBadge = unread > 0
        ? `<span style="background:#25D366;color:white;border-radius:12px;
                        padding:2px 7px;font-size:11px;font-weight:bold;
                        min-width:20px;text-align:center;flex-shrink:0;">
             ${unread > 99 ? "99+" : unread}
           </span>`
        : "";

      row.innerHTML = `
        <div id="${avatarId}" style="width:48px;height:48px;background:#1E40AF;color:white;
             border-radius:50%;display:flex;align-items:center;justify-content:center;
             font-weight:700;font-size:19px;flex-shrink:0;overflow:hidden;">
          ${escapeHtml(initial)}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;">
            <span style="font-weight:700;font-size:15px;color:#111;
                         overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${escapeHtml(otherName)}
            </span>
            <span style="font-size:11px;color:#aaa;flex-shrink:0;">${lastTime}</span>
          </div>
          <div id="${statusId}"
            style="font-size:11px;color:#aaa;margin-top:1px;height:14px;line-height:14px;">
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:3px;gap:6px;">
            <span style="font-size:13px;color:#666;overflow:hidden;text-overflow:ellipsis;
                         white-space:nowrap;flex:1;">${escapeHtml(lastMsg)}</span>
            ${unreadBadge}
          </div>
        </div>`;

      // Open chat on click — close inbox first
      row.addEventListener("click", () => {
        closeInboxScreen();
        openChatWithUser(otherID, otherName, "");
      });

      list.appendChild(row);

      // Async: fetch profile pic + last-seen status for this contact
      db.ref("users/" + otherID).once("value").then((uSnap) => {
        if (!uSnap.exists()) return;
        const u = uSnap.val();

        // Profile picture
        if (u.profilePic) {
          const av = document.getElementById(avatarId);
          if (av) {
            av.innerHTML = "";
            const img = document.createElement("img");
            img.src   = u.profilePic;
            img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%;";
            img.onerror = () => { av.innerHTML = escapeHtml(initial); };
            av.appendChild(img);
          }
        }

        // Last seen / online status
        const stEl = document.getElementById(statusId);
        if (stEl && u.status) {
          const s = u.status;
          if (s.state === "online") {
            stEl.textContent   = "online ●";
            stEl.style.color   = "#25D366";
          } else if (s.last_changed) {
            stEl.textContent = "last seen " + formatChatTime(s.last_changed);
            stEl.style.color = "#aaa";
          }
        }
      }).catch(() => {});
    });

  }, (err) => {
    console.error("Inbox load error:", err);
    list.innerHTML = `
      <p style="color:red;text-align:center;padding:24px;font-size:13px;">
        Inbox load nahi hui. Internet check karein.
      </p>`;
  });
}

/* ── Global unread badge (message icon in header) ────────────────────── */
function listenForChatNotifications() {
  if (!state.user || state.user.isAdmin) return;
  const me = state.user.username;

  if (_unreadBadgeListener) { _unreadBadgeListener.off(); _unreadBadgeListener = null; }

  const ref = db.ref("chat_rooms");
  _unreadBadgeListener = ref;

  ref.on("value", (snap) => {
    let total = 0;
    snap.forEach((child) => {
      const r = child.val();
      if (r && r.participants && r.participants[me] && r.unread && r.unread[me])
        total += r.unread[me];
    });
    const badge = document.getElementById("global-inbox-badge");
    if (badge) {
      if (total > 0) { badge.innerText = total > 99 ? "99+" : total; badge.style.display = "inline-block"; }
      else badge.style.display = "none";
    }
  });
}

/* ── Admin: chat directory for a specific user ───────────────────────────
   Shows a WhatsApp-style contact list first.
   Clicking any contact expands the full inline message thread (text,
   images, audio, documents, location) without leaving the screen.
   ──────────────────────────────────────────────────────────────────────── */
function loadUserChatsInAdmin(targetUserId) {
  const container = document.getElementById("admin-user-messages-container");
  if (!container) return;

  container.innerHTML = `
    <div style="text-align:center;padding:14px 0;color:#075E54;font-size:13px;">
      ⏳ Chat history load ho rahi hai...
    </div>`;

  /* ── helper: render a single message bubble ─────────────────────────── */
  function _renderBubble(msg, myName, otherName) {
    const isTarget    = msg.senderID === targetUserId;
    const senderLabel = escapeHtml(isTarget ? myName : otherName);
    const timeStr     = formatChatTime(msg.timestamp);
    const seenTick    = isTarget
      ? (msg.seen
          ? " <span style='color:#3b82f6;font-size:10px;'>✓✓</span>"
          : " <span style='color:#9ca3af;font-size:10px;'>✓</span>")
      : "";

    const type = msg.type || "text";
    let content = "";
    if (type === "audio") {
      content = `<audio controls src="${escapeHtml(msg.audioUrl || "")}"
        style="max-width:180px;outline:none;border-radius:8px;display:block;"></audio>`;
    } else if (type === "location") {
      content = `<a href="${escapeHtml(msg.locationUrl || "#")}" target="_blank"
        style="display:flex;align-items:center;gap:5px;color:${isTarget ? "#93c5fd" : "#047857"};
               font-size:12px;text-decoration:none;">
        📍 <span style="font-weight:600;">View on Map</span></a>`;
    } else if (type === "image") {
      content = `<img src="${escapeHtml(msg.fileUrl || "")}" alt="Image"
        style="max-width:140px;max-height:140px;border-radius:6px;object-fit:cover;
               display:block;cursor:zoom-in;"
        onclick="_openImageFullscreen(this.src)"
        onerror="this.style.display='none'">`;
    } else if (type === "document") {
      const dh = escapeHtml(msg.fileUrl || "");
      const dn = escapeHtml(msg.fileName || "Document");
      content = `<span style="font-size:12px;">📄 <a href="${dh}" target="_blank"
        download="${dn}" style="color:${isTarget ? "#93c5fd" : "#047857"};">${dn}</a></span>`;
    } else {
      content = `<span style="font-size:13px;">${escapeHtml(msg.text || "")}</span>`;
    }

    const bubble = document.createElement("div");
    bubble.style.cssText = `display:flex;flex-direction:column;align-items:${isTarget ? "flex-end" : "flex-start"};margin-bottom:4px;`;
    bubble.innerHTML = `
      <div style="font-size:10px;color:#9ca3af;margin-bottom:2px;">${senderLabel} · ${timeStr}${seenTick}</div>
      <div style="
        background:${isTarget ? "#1e40af" : "white"};
        color:${isTarget ? "#fff" : "#111"};
        padding:7px 11px;
        border-radius:${isTarget ? "12px 12px 2px 12px" : "12px 12px 12px 2px"};
        max-width:75%;font-size:13px;
        box-shadow:0 1px 2px rgba(0,0,0,0.08);
        word-break:break-word;overflow:hidden;">
        ${content}
      </div>`;
    return bubble;
  }

  /* ── core load ──────────────────────────────────────────────────────── */
  function _doLoad() {
    // Step 1: query chat_rooms index
    db.ref("chat_rooms").once("value").then((snap) => {
      const rooms = [];
      snap.forEach((child) => {
        const r = child.val();
        if (r && r.participants && r.participants[targetUserId] === true)
          rooms.push({ id: child.key, ...r });
      });

      // Step 2: fallback — scan chats/ node
      if (rooms.length === 0) {
        return db.ref("chats").once("value").then((chatsSnap) => {
          const extra = [];
          chatsSnap.forEach((roomSnap) => {
            const key = roomSnap.key || "";
            if (key.includes(targetUserId)) {
              extra.push({ id: roomSnap.key });
            } else {
              let found = false;
              roomSnap.forEach((msgSnap) => {
                if (!found && msgSnap.val().senderID === targetUserId) {
                  found = true;
                  extra.push({ id: roomSnap.key });
                }
              });
            }
          });
          return extra;
        });
      }
      return rooms;

    }).then((rooms) => {

      if (!rooms || rooms.length === 0) {
        container.innerHTML = `
          <div style="text-align:center;padding:20px 0;color:#6b7280;font-size:13px;">
            📭 Is user ne abhi tak kisi se chat nahi ki.
          </div>`;
        return;
      }

      container.innerHTML = ""; // clear spinner

      // Step 3: build contact directory — one card per room
      const fetches = rooms.map((room) =>
        db.ref("chats/" + room.id).once("value").then((msgSnap) => {

          const names     = room.participantNames || {};
          const roomParts = room.id.split("_");
          const otherID   = Object.keys(names).find((k) => k !== targetUserId)
                            || roomParts.find((p) => p !== targetUserId)
                            || "—";
          const myName    = names[targetUserId] || targetUserId;
          const otherName = names[otherID]      || otherID;

          const messages = [];
          if (msgSnap.exists()) {
            msgSnap.forEach((m) => messages.push({ key: m.key, ...m.val() }));
            messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          }

          const lastMsg  = messages.length ? messages[messages.length - 1] : null;
          const lastText = lastMsg
            ? (lastMsg.type === "audio"    ? "🎤 Voice note"
             : lastMsg.type === "image"    ? "🖼 Image"
             : lastMsg.type === "document" ? "📄 " + (lastMsg.fileName || "File")
             : lastMsg.type === "location" ? "📍 Location"
             : lastMsg.text || "…")
            : "Koi message nahi";
          const lastTime = lastMsg ? formatChatTime(lastMsg.timestamp) : "";
          const initial  = (otherName.charAt(0) || "?").toUpperCase();

          /* ── Contact row (always visible) ──────────────────────────── */
          const row = document.createElement("div");
          row.style.cssText = [
            "display:flex", "align-items:center", "gap:10px",
            "padding:10px 12px", "cursor:pointer",
            "border-bottom:1px solid #f0fdf4",
            "background:white", "transition:background 0.12s",
            "user-select:none",
          ].join(";");
          row.onmouseover = () => { row.style.background = "#f0fdf4"; };
          row.onmouseout  = () => { row.style.background = "white"; };

          const arrowSpan = document.createElement("span");
          arrowSpan.textContent = "▶";
          arrowSpan.style.cssText = "font-size:11px;color:#aaa;flex-shrink:0;";

          row.innerHTML = `
            <div style="width:40px;height:40px;border-radius:50%;background:#075E54;
                         color:white;display:flex;align-items:center;justify-content:center;
                         font-weight:700;font-size:17px;flex-shrink:0;">
              ${escapeHtml(initial)}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:13px;color:#111;white-space:nowrap;
                           overflow:hidden;text-overflow:ellipsis;">${escapeHtml(otherName)}</div>
              <div style="font-size:11px;color:#888;white-space:nowrap;overflow:hidden;
                           text-overflow:ellipsis;">${escapeHtml(lastText)}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;">
              <span style="font-size:10px;color:#aaa;">${lastTime}</span>
            </div>`;
          row.appendChild(arrowSpan);

          /* ── Thread panel (collapsed by default) ───────────────────── */
          const thread = document.createElement("div");
          thread.style.cssText = "display:none;";

          // Thread header (green bar with back chevron)
          const threadHdr = document.createElement("div");
          threadHdr.style.cssText = [
            "display:flex", "align-items:center", "gap:8px",
            "padding:8px 12px", "background:#075E54", "color:white",
          ].join(";");

          const backBtn = document.createElement("button");
          backBtn.innerHTML = "← Wapas";
          backBtn.style.cssText = [
            "background:none", "border:none", "color:white",
            "font-size:12px", "font-weight:600", "cursor:pointer",
            "padding:0", "flex-shrink:0",
          ].join(";");
          const hdrLabel = document.createElement("span");
          hdrLabel.style.cssText = "font-size:12px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
          hdrLabel.textContent = myName + " ↔ " + otherName;

          const countBadge = document.createElement("span");
          countBadge.style.cssText = "font-size:10px;opacity:0.75;flex-shrink:0;";
          countBadge.textContent   = messages.length + " msgs";

          threadHdr.appendChild(backBtn);
          threadHdr.appendChild(hdrLabel);
          threadHdr.appendChild(countBadge);
          thread.appendChild(threadHdr);

          // Messages scroll area — filled by live .on("child_added"), not a one-time fetch
          const msgArea = document.createElement("div");
          msgArea.style.cssText = [
            "display:flex", "flex-direction:column",
            "padding:10px 12px", "max-height:280px", "overflow-y:auto",
            "background:#fafafa",
          ].join(";");
          thread.appendChild(msgArea);

          // ── Per-room live listener helpers ───────────────────────────────
          function _openThread() {
            // Detach any previously active thread listener (only one live at a time)
            if (_adminThreadRef) {
              try { _adminThreadRef.off("child_added"); } catch (_) {}
              _adminThreadRef = null;
            }
            // Clear area and show loading placeholder
            msgArea.innerHTML = `<p style="color:#9ca3af;font-size:12px;text-align:center;padding:10px 0;">⏳ Loading messages...</p>`;
            let msgCount = 0;
            const roomRef = db.ref("chats/" + room.id);
            _adminThreadRef = roomRef;

            roomRef.on("child_added", (snap) => {
              // Remove loading / empty placeholder on first child
              const placeholder = msgArea.querySelector("p");
              if (placeholder) placeholder.remove();
              const msg = { key: snap.key, ...snap.val() };
              msgArea.appendChild(_renderBubble(msg, myName, otherName));
              msgCount++;
              countBadge.textContent = msgCount + " msg" + (msgCount !== 1 ? "s" : "");
              // Auto-scroll to the newest message
              requestAnimationFrame(() => { msgArea.scrollTop = msgArea.scrollHeight; });
            }, (err) => {
              console.warn("Admin live thread error:", room.id, err.message);
            });
          }

          function _closeThread() {
            if (_adminThreadRef) {
              try { _adminThreadRef.off("child_added"); } catch (_) {}
              _adminThreadRef = null;
            }
            msgArea.innerHTML = "";
            countBadge.textContent = messages.length + " msgs";
          }

          // Back button — detach live listener and collapse thread
          backBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            _closeThread();
            thread.style.display = "none";
            arrowSpan.textContent = "▶";
          });

          // Row click — open attaches live listener, close detaches it
          row.addEventListener("click", () => {
            const opening = thread.style.display === "none";
            if (opening) {
              thread.style.display = "block";
              arrowSpan.textContent = "▼";
              _openThread();
            } else {
              _closeThread();
              thread.style.display = "none";
              arrowSpan.textContent = "▶";
            }
          });

          /* ── Wrap in card ─────────────────────────────────────────── */
          const card = document.createElement("div");
          card.style.cssText = [
            "border:1px solid #d1fae5",
            "border-radius:10px",
            "overflow:hidden",
            "margin-bottom:8px",
            "box-shadow:0 1px 3px rgba(0,0,0,0.05)",
          ].join(";");
          card.appendChild(row);
          card.appendChild(thread);
          container.appendChild(card);

        }).catch((err) => {
          console.warn("Room load error:", room.id, err.message);
        })
      );

      Promise.all(fetches).then(() => {
        if (!container.children.length) {
          container.innerHTML = `
            <div style="text-align:center;padding:20px 0;color:#6b7280;font-size:13px;">
              📭 Is user ki koi chat history nahi mili.
            </div>`;
        }
      });

    }).catch((err) => {
      console.error("loadUserChatsInAdmin error:", err);
      const isPerm = err && (err.code === "PERMISSION_DENIED" || (err.message || "").includes("permission"));
      container.innerHTML = `
        <div style="text-align:center;padding:14px;color:#dc2626;font-size:13px;">
          ⚠️ Chat history load nahi hui.<br>
          <span style="font-size:11px;color:#9ca3af;">
            ${isPerm
              ? "Firebase Console → Authentication → Sign-in providers → Anonymous signin enable karein."
              : "Internet ya Firebase connection check karein."}
          </span><br>
          <button onclick="loadUserChatsInAdmin('${escapeHtml(targetUserId)}')"
            style="margin-top:8px;padding:6px 14px;background:#075E54;color:white;
                   border:none;border-radius:6px;font-size:12px;cursor:pointer;">
            ↺ Dobara Try Karein
          </button>
        </div>`;
    });
  } // end _doLoad

  // Ensure Firebase Auth session exists before querying
  const currentUser = auth.currentUser;
  if (currentUser) {
    _doLoad();
  } else {
    const unsub = auth.onAuthStateChanged((user) => {
      unsub();
      if (user) {
        _doLoad();
      } else {
        auth.signInAnonymously()
          .then(() => _doLoad())
          .catch(() => {
            container.innerHTML = `
              <div style="text-align:center;padding:14px;color:#dc2626;font-size:13px;">
                ⚠️ Auth error. Firebase Console mein Anonymous signin enable karein.
              </div>`;
          });
      }
    });
  }
}

/* ── Presence ────────────────────────────────────────────────────────── */
function setupUserPresence() {
  if (!state.user || !state.user.username) return;
  const me        = state.user.username;
  const statusRef = db.ref("users/" + me + "/status");

  db.ref(".info/connected").on("value", (snap) => {
    if (!snap.val()) return;
    statusRef.onDisconnect()
      .set({ state: "offline", last_changed: firebase.database.ServerValue.TIMESTAMP })
      .then(() => statusRef.set({ state: "online", last_changed: firebase.database.ServerValue.TIMESTAMP }));
  });
}

function _listenToPresence(targetUserId) {
  const el = document.getElementById("chat-user-status");
  if (!el) return;

  const ref = db.ref("users/" + targetUserId + "/status");
  _presenceListener = ref;

  ref.on("value", (snap) => {
    if (!snap.exists()) {
      el.innerText = "offline"; el.style.color = "#999";
      el._presenceText = "offline";
      return;
    }
    const s = snap.val();
    let text;
    if (s.state === "online") {
      text = "online ●"; el.style.color = "#25D366";
    } else {
      el.style.color = "#999";
      text = s.last_changed ? "last seen " + formatChatTime(s.last_changed) : "offline";
    }
    // Store so typing indicator can restore it when typing stops
    el._presenceText = text;
    // Only update if typing indicator isn't active
    if (el.style.fontStyle !== "italic") el.innerText = text;
  });
}

/* =====================================================================
   EXTENDED CHAT FEATURES
   1. Chat toolbar injection (mic 🎤, location 📍, attachment 📎)
   2. Typing indicator  (Firebase chats_presence/{roomId}/{userId})
   3. Voice recording   (MediaRecorder → Firebase Storage)
   4. Location sharing  (Geolocation → Google Maps link)
   5. File / image attachment (Firebase Storage upload)
   6. Image fullscreen viewer
   7. Admin "All Conversations" overlay
   ===================================================================== */

/* ── Shared icon-button CSS string ───────────────────────────────────── */
function _iconBtnStyle() {
  return [
    "background:none", "border:none", "cursor:pointer",
    "padding:7px", "font-size:19px", "line-height:1",
    "color:#555", "border-radius:50%", "transition:background 0.15s",
    "flex-shrink:0",
  ].join(";");
}

/* ── 1. Inject toolbar into chat modal (idempotent) ──────────────────── */
function _ensureChatInputUI() {
  if (document.getElementById("_chat-toolbar")) return; // already done

  const inputEl = document.getElementById("chat-input-text");
  if (!inputEl) return;
  const parent = inputEl.parentElement;

  // ── Toolbar div (three icon buttons)
  const toolbar = document.createElement("div");
  toolbar.id = "_chat-toolbar";
  toolbar.style.cssText = "display:flex;align-items:center;gap:1px;flex-shrink:0;";
  toolbar.innerHTML = `
    <button id="_btn-attach" title="File ya Image bhejein" style="${_iconBtnStyle()}">📎</button>
    <button id="_btn-loc"    title="Apni location share karein" style="${_iconBtnStyle()}">📍</button>
    <button id="_btn-mic"    title="Voice message — click to start / stop" style="${_iconBtnStyle()}">🎤</button>`;

  // ── Hidden file input
  const fileInput = document.createElement("input");
  fileInput.type    = "file";
  fileInput.id      = "_chat-file-input";
  fileInput.accept  = "image/*,application/pdf,.doc,.docx,.txt";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", (e) => {
    if (e.target.files[0]) _handleFileAttachment(e.target.files[0]);
    e.target.value = "";
  });

  // ── Recording indicator bar
  const recBar = document.createElement("div");
  recBar.id = "_rec-bar";
  recBar.style.cssText = [
    "display:none", "align-items:center", "gap:8px",
    "padding:5px 10px", "background:#FEE2E2", "border-radius:8px",
    "font-size:12px", "color:#DC2626", "flex-shrink:0", "white-space:nowrap",
  ].join(";");
  recBar.innerHTML = `<span style="animation:_chatPulse 1s infinite;">🔴</span> Recording… <span id="_rec-time">0:00</span>`;

  // ── Keyframe for pulsing dot (inject once)
  if (!document.getElementById("_chat-ext-styles")) {
    const sty = document.createElement("style");
    sty.id = "_chat-ext-styles";
    sty.textContent = `
      @keyframes _chatPulse { 0%,100%{opacity:1} 50%{opacity:0.2} }
      #_btn-mic.recording { background:#FEE2E2 !important; color:#DC2626 !important; }
      #_upload-spinner {
        position:absolute; bottom:64px; right:14px; background:#1E40AF;
        color:white; border-radius:8px; padding:6px 12px;
        font-size:12px; font-weight:600; z-index:100; display:none;
      }
    `;
    document.head.appendChild(sty);
  }

  // ── Upload spinner (positioned inside chat-modal)
  if (!document.getElementById("_upload-spinner")) {
    const spinner = document.createElement("div");
    spinner.id = "_upload-spinner";
    spinner.textContent = "⏳ Uploading…";
    const modal = document.getElementById("chat-modal");
    if (modal) {
      modal.style.position = "relative";
      modal.appendChild(spinner);
    }
  }

  // ── Insert elements: recBar | toolbar | fileInput | [existing input] | [send btn]
  const anchor = inputEl; // insert before the text input
  parent.insertBefore(fileInput, anchor);
  parent.insertBefore(toolbar,   anchor);
  parent.insertBefore(recBar,    anchor);

  // ── Wire buttons
  document.getElementById("_btn-attach").addEventListener("click", () =>
    document.getElementById("_chat-file-input").click()
  );
  document.getElementById("_btn-loc").addEventListener("click", shareLocation);
  document.getElementById("_btn-mic").addEventListener("click", _toggleVoiceRecord);

  // ── Typing: add input + Enter listeners (safe even if called multiple times)
  inputEl.removeEventListener("input",   _onTypingInput);
  inputEl.removeEventListener("keydown", _chatEnterKey);
  inputEl.addEventListener("input",   _onTypingInput);
  inputEl.addEventListener("keydown", _chatEnterKey);
}

function _chatEnterKey(e) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

/* ── 2. Typing indicator ─────────────────────────────────────────────── */
function _onTypingInput() {
  if (!_typingRef) return;
  _typingRef.set(true).catch(() => {});
  if (_typingTimer) clearTimeout(_typingTimer);
  _typingTimer = setTimeout(_clearMyTypingStatus, 2000);
}

function _clearMyTypingStatus() {
  if (_typingRef) _typingRef.set(false).catch(() => {});
}

function _listenTyping(roomId, myID, otherID) {
  // Detach old listener
  if (_typingListenerRef) { _typingListenerRef.off(); _typingListenerRef = null; }

  // Register my own typing node and set it to false on disconnect
  _typingRef = db.ref("chats_presence/" + roomId + "/" + myID);
  _typingRef.onDisconnect().set(false).catch(() => {});

  // Listen to the other person's typing status
  const ref = db.ref("chats_presence/" + roomId + "/" + otherID);
  _typingListenerRef = ref;

  ref.on("value", (snap) => {
    const statusEl = document.getElementById("chat-user-status");
    if (!statusEl) return;
    if (snap.val() === true) {
      statusEl.textContent  = "typing…";
      statusEl.style.color  = "#25D366";
      statusEl.style.fontStyle = "italic";
    } else {
      statusEl.style.fontStyle = "";
      // Restore last-seen / online text
      statusEl.innerText = statusEl._presenceText || "";
    }
  });
}

/* ── 3. Voice recording ──────────────────────────────────────────────── */
function _toggleVoiceRecord() {
  if (_isRecording) _stopVoiceRecord(); else _startVoiceRecord();
}

function _startVoiceRecord() {
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    alert("Aapka browser voice recording support nahi karta.");
    return;
  }
  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    _audioChunks   = [];
    const mime     = _getBestAudioMime();
    _mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});

    _mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) _audioChunks.push(e.data); };
    _mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(_audioChunks, { type: _mediaRecorder.mimeType || "audio/ogg" });
      _uploadAudio(blob);
      _audioChunks = [];
    };

    _mediaRecorder.start();
    _isRecording = true;

    // UI: red indicator + mic button state
    const micBtn = document.getElementById("_btn-mic");
    if (micBtn) micBtn.classList.add("recording");
    const recBar = document.getElementById("_rec-bar");
    if (recBar) recBar.style.display = "flex";

    // Seconds timer
    let secs = 0;
    _recTimerInterval = setInterval(() => {
      secs++;
      const el = document.getElementById("_rec-time");
      if (el) el.textContent = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
      if (secs >= 60) _stopVoiceRecord(); // auto-stop at 60 seconds
    }, 1000);

  }).catch((err) => {
    console.error("Microphone access error:", err);
    alert("Microphone access nahi mila. Browser settings mein permission allow karein.");
  });
}

function _stopVoiceRecord() {
  if (_mediaRecorder && _isRecording) {
    try { _mediaRecorder.stop(); } catch (_) {}
    _isRecording = false;
  }
  if (_recTimerInterval) { clearInterval(_recTimerInterval); _recTimerInterval = null; }
  const micBtn = document.getElementById("_btn-mic");
  if (micBtn) micBtn.classList.remove("recording");
  const recBar = document.getElementById("_rec-bar");
  if (recBar) recBar.style.display = "none";
  const tEl = document.getElementById("_rec-time");
  if (tEl) tEl.textContent = "0:00";
}

function _getBestAudioMime() {
  if (typeof MediaRecorder === "undefined") return "";
  const types = [
    "audio/webm;codecs=opus", "audio/ogg;codecs=opus",
    "audio/webm", "audio/ogg", "audio/mp4",
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

/* ── FREE Media Upload Helpers (no Firebase Storage required) ────────
   Strategy: convert files to base64 data URIs and store directly in
   Firebase Realtime Database. Images are resized via canvas (max 800px)
   to keep node sizes small. Voice notes auto-stop at 60 seconds.
   Documents are capped at 800 KB.
   ──────────────────────────────────────────────────────────────────── */

function _blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
}

function _resizeImageToBase64(file, maxPx, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      if (w > maxPx || h > maxPx) {
        const ratio = Math.min(maxPx / w, maxPx / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality || 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image load error")); };
    img.src = url;
  });
}

async function _uploadAudio(blob) {
  if (!state.user || !_chatRoomID) return;

  // Guard: blob must be reasonable size (max 3 MB for a ~60s voice note)
  if (blob.size > 3 * 1024 * 1024) {
    showToast("Voice note bahut lamba hai. Max 60 seconds allowed.", "error");
    return;
  }

  showToast("Voice message save ho raha hai…", "success", 3000);
  try {
    const base64 = await _blobToBase64(blob);
    _pushChatMessage({ type: "audio", audioUrl: base64, text: "🎤 Voice message" });
  } catch (err) {
    console.error("Audio encode error:", err);
    showToast("Voice message save nahi hua. Phir try karein.", "error");
  }
}

/* ── 4. Location sharing ─────────────────────────────────────────────── */
function shareLocation() {
  if (!navigator.geolocation) {
    alert("Aapka browser location support nahi karta.");
    return;
  }
  const btn = document.getElementById("_btn-loc");
  if (btn) { btn.textContent = "⏳"; btn.disabled = true; }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (btn) { btn.textContent = "📍"; btn.disabled = false; }
      const { latitude: lat, longitude: lng } = pos.coords;
      const url = "https://www.google.com/maps?q=" + lat + "," + lng;
      _pushChatMessage({ type: "location", locationUrl: url, lat, lng, text: "📍 Location" });
    },
    (err) => {
      if (btn) { btn.textContent = "📍"; btn.disabled = false; }
      console.error("Geolocation error:", err);
      alert("Location nahi mili. Browser settings mein location allow karein.");
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

/* ── 5. File / image attachment ──────────────────────────────────────── */
function openFileAttachment() {
  const inp = document.getElementById("_chat-file-input");
  if (inp) inp.click();
}

async function _handleFileAttachment(file) {
  if (!state.user || !_chatRoomID) return;

  const isImage = file.type.startsWith("image/");
  const spinner = document.getElementById("_upload-spinner");
  if (spinner) spinner.style.display = "block";

  try {
    if (isImage) {
      // Resize image to max 800px and convert to base64 JPEG — keeps size tiny
      const base64 = await _resizeImageToBase64(file, 800, 0.72);
      if (spinner) spinner.style.display = "none";
      _pushChatMessage({ type: "image", fileUrl: base64, fileName: file.name, text: "🖼 Image" });
    } else {
      // Documents — enforce 800 KB size limit to fit in Firebase RTDB node
      if (file.size > 800 * 1024) {
        if (spinner) spinner.style.display = "none";
        showToast("File bahut bari hai. Max 800 KB allowed. PDF compress kar ke bhejein.", "error", 4000);
        return;
      }
      const base64 = await _blobToBase64(file);
      if (spinner) spinner.style.display = "none";
      _pushChatMessage({ type: "document", fileUrl: base64, fileName: file.name, text: "📄 " + file.name });
    }
  } catch (err) {
    if (spinner) spinner.style.display = "none";
    console.error("File attach error:", err);
    showToast("File bhejne mein masla aaya. Phir try karein.", "error");
  }
}

/* ── Shared helper: push any message type to Firebase ────────────────── */
function _pushChatMessage(extra) {
  if (!state.user || !_chatRoomID) return;
  const me     = state.user.username;
  const myName = state.user.fullName || me;

  const msg = {
    senderID:  me,
    timestamp: firebase.database.ServerValue.TIMESTAMP,
    seen:      false,
    ...extra,
  };

  // Push message
  db.ref("chats/" + _chatRoomID).push(msg).catch((err) => console.error("_pushChatMessage:", err));

  // Use state.activeChat — splitting _chatRoomID on "_" breaks for usernames with underscores
  const receiverID   = state.activeChat || "";
  if (!receiverID) return;
  const nameEl       = document.getElementById("chat-user-name");
  const receiverName = nameEl ? nameEl.innerText : receiverID;

  db.ref("chat_rooms/" + _chatRoomID).update({
    participants:     { [me]: true, [receiverID]: true },
    participantNames: { [me]: myName, [receiverID]: receiverName },
    lastMessage:      extra.text || "Media",
    lastTimestamp:    firebase.database.ServerValue.TIMESTAMP,
  }).catch(() => {});

  // Increment receiver's unread counter
  db.ref("chat_rooms/" + _chatRoomID + "/unread/" + receiverID)
    .transaction((c) => (c || 0) + 1).catch(() => {});
}

/* ── 6. Image fullscreen viewer ──────────────────────────────────────── */
function _openImageFullscreen(src) {
  let viewer = document.getElementById("_img-viewer");
  if (!viewer) {
    viewer = document.createElement("div");
    viewer.id = "_img-viewer";
    viewer.style.cssText = [
      "position:fixed", "inset:0", "z-index:99999",
      "background:rgba(0,0,0,0.95)", "display:none",
      "align-items:center", "justify-content:center", "cursor:zoom-out",
    ].join(";");
    viewer.innerHTML = `
      <img id="_img-viewer-img"
        style="max-width:95vw;max-height:90vh;border-radius:4px;object-fit:contain;">
      <button onclick="document.getElementById('_img-viewer').style.display='none'"
        style="position:absolute;top:14px;right:14px;background:rgba(255,255,255,0.15);
               border:none;color:white;font-size:22px;cursor:pointer;
               border-radius:50%;width:40px;height:40px;line-height:40px;text-align:center;">
        ✕
      </button>`;
    viewer.addEventListener("click", (e) => {
      if (e.target === viewer) viewer.style.display = "none";
    });
    document.body.appendChild(viewer);
  }
  document.getElementById("_img-viewer-img").src = src;
  viewer.style.display = "flex";
}

/* ── 7. Admin — All Conversations overlay ────────────────────────────── */
function _injectAdminChatsBtn() {
  if (document.getElementById("_admin-chats-btn")) return;

  const btn = document.createElement("button");
  btn.id = "_admin-chats-btn";
  btn.innerHTML = "💬 All Conversations";
  btn.style.cssText = [
    "display:inline-flex", "align-items:center", "gap:6px",
    "margin:12px", "padding:10px 18px",
    "background:#1E40AF", "color:white",
    "border:none", "border-radius:8px",
    "font-size:14px", "font-weight:600", "cursor:pointer",
    "box-shadow:0 2px 6px rgba(30,64,175,0.3)",
  ].join(";");
  btn.addEventListener("click", renderAdminAllChats);

  // Insert at top of admin screen, or body as fallback
  const screen = document.getElementById("screen-admin") || document.body;
  screen.insertBefore(btn, screen.firstChild);
}

function renderAdminAllChats() {
  let overlay = document.getElementById("_admin-chats-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "_admin-chats-overlay";
    overlay.style.cssText = [
      "position:fixed", "inset:0", "z-index:9500",
      "background:#f0f4f8", "display:none",
      "flex-direction:column", "overflow:hidden", "font-family:inherit",
    ].join(";");
    overlay.innerHTML = `
      <div style="background:#1E40AF;color:white;display:flex;align-items:center;
                  gap:10px;padding:0 14px;height:56px;flex-shrink:0;
                  box-shadow:0 2px 4px rgba(0,0,0,0.2);">
        <button onclick="document.getElementById('_admin-chats-overlay').style.display='none'"
          style="background:none;border:none;color:white;font-size:24px;
                 cursor:pointer;padding:4px 8px 4px 0;line-height:1;">&#8592;</button>
        <span style="font-size:17px;font-weight:700;flex:1;">All Conversations</span>
        <span id="_admin-chats-count" style="font-size:12px;background:rgba(255,255,255,0.2);
              border-radius:12px;padding:2px 8px;"></span>
      </div>
      <div id="_admin-chats-list"
        style="flex:1;overflow-y:auto;background:white;"></div>`;
    document.body.appendChild(overlay);
  }

  overlay.style.display = "flex";
  const list    = document.getElementById("_admin-chats-list");
  const countEl = document.getElementById("_admin-chats-count");
  list.innerHTML = `<p style="text-align:center;color:#888;padding:30px;font-size:13px;">Loading…</p>`;

  db.ref("chat_rooms").orderByChild("lastTimestamp").once("value").then((snap) => {
    const rooms = [];
    snap.forEach((child) => rooms.push({ id: child.key, ...child.val() }));
    rooms.reverse(); // newest first

    if (countEl) countEl.textContent = rooms.length + " chat" + (rooms.length !== 1 ? "s" : "");

    list.innerHTML = "";
    if (!rooms.length) {
      list.innerHTML = `<div style="text-align:center;padding:60px 20px;color:#aaa;font-size:14px;">Abhi tak koi chat nahi.</div>`;
      return;
    }

    rooms.forEach((room) => {
      const parts   = room.id.split("_");
      const nameA   = (room.participantNames && room.participantNames[parts[0]]) || parts[0];
      const nameB   = (room.participantNames && room.participantNames[parts[1]]) || parts[1];
      const lastMsg = room.lastMessage || "—";
      const lastT   = formatChatTime(room.lastTimestamp);
      const totalUnread = room.unread
        ? Object.values(room.unread).reduce((a, b) => a + (b || 0), 0)
        : 0;

      const row = document.createElement("div");
      row.style.cssText = [
        "display:flex", "align-items:center", "gap:12px",
        "padding:13px 16px", "border-bottom:1px solid #f0f0f0",
        "cursor:pointer", "transition:background 0.15s",
      ].join(";");
      row.addEventListener("mouseenter", () => { row.style.background = "#f7f9ff"; });
      row.addEventListener("mouseleave", () => { row.style.background = ""; });
      row.innerHTML = `
        <div style="width:44px;height:44px;background:#EFF6FF;color:#1E40AF;border-radius:50%;
                    display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">
          💬
        </div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;">
            <span style="font-weight:700;font-size:14px;color:#111;">
              ${escapeHtml(nameA)} ↔ ${escapeHtml(nameB)}
            </span>
            <span style="font-size:11px;color:#aaa;flex-shrink:0;">${lastT}</span>
          </div>
          <div style="font-size:12px;color:#666;margin-top:2px;overflow:hidden;
                      text-overflow:ellipsis;white-space:nowrap;">
            ${escapeHtml(lastMsg)}
          </div>
        </div>
        ${totalUnread > 0
          ? `<span style="background:#EF4444;color:white;border-radius:12px;
                          padding:2px 8px;font-size:11px;font-weight:bold;flex-shrink:0;">
               ${totalUnread}
             </span>`
          : ""}`;

      row.addEventListener("click", () => {
        overlay.style.display = "none";
        _openAdminChatRoom(room.id, nameA, nameB);
      });
      list.appendChild(row);
    });
  }).catch((err) => {
    console.error("Admin all chats error:", err);
    list.innerHTML = `<p style="color:red;text-align:center;padding:24px;font-size:13px;">Load fail. Phir try karein.</p>`;
  });
}

// Admin: read-only message history for a specific room
function _openAdminChatRoom(roomId, nameA, nameB) {
  let viewer = document.getElementById("_admin-room-viewer");
  if (!viewer) {
    viewer = document.createElement("div");
    viewer.id = "_admin-room-viewer";
    viewer.style.cssText = [
      "position:fixed", "inset:0", "z-index:9600",
      "background:#f0f4f8", "display:none",
      "flex-direction:column", "overflow:hidden", "font-family:inherit",
    ].join(";");
    document.body.appendChild(viewer);
  }

  viewer.innerHTML = `
    <div style="background:#1E40AF;color:white;display:flex;align-items:center;
                gap:10px;padding:0 14px;height:56px;flex-shrink:0;">
      <button onclick="
          document.getElementById('_admin-room-viewer').style.display='none';
          document.getElementById('_admin-chats-overlay').style.display='flex';"
        style="background:none;border:none;color:white;font-size:24px;
               cursor:pointer;padding:4px 8px 4px 0;line-height:1;">&#8592;</button>
      <div>
        <div style="font-size:14px;font-weight:700;">${escapeHtml(nameA)} ↔ ${escapeHtml(nameB)}</div>
        <div style="font-size:11px;opacity:0.75;">Read-only — Admin view</div>
      </div>
    </div>
    <div id="_admin-room-msgs"
      style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;
             gap:8px;background:#f5f7fb;">
      <p style="text-align:center;color:#888;font-size:13px;">Loading messages…</p>
    </div>`;
  viewer.style.display = "flex";

  const msgBox = document.getElementById("_admin-room-msgs");
  db.ref("chats/" + roomId).orderByChild("timestamp").once("value").then((snap) => {
    msgBox.innerHTML = "";
    if (!snap.exists()) {
      msgBox.innerHTML = `<p style="text-align:center;color:#aaa;font-size:13px;">Koi message nahi.</p>`;
      return;
    }
    const parts = roomId.split("_");
    snap.forEach((child) => {
      const msg    = child.val();
      const isMine = msg.senderID === parts[0]; // arbitrary: first user = "left"
      const bubble = document.createElement("div");
      bubble.style.cssText = `display:flex;flex-direction:column;align-items:${isMine ? "flex-end" : "flex-start"};`;
      bubble.innerHTML = `
        <div style="font-size:10px;color:#999;margin-bottom:3px;">
          ${escapeHtml(msg.senderID)} · ${formatChatTime(msg.timestamp)}
          ${msg.seen ? '<span style="color:#60A5FA;"> ✓✓</span>' : ""}
        </div>
        <div style="background:${isMine ? "#DBEAFE" : "white"};padding:8px 12px;
                    border-radius:${isMine ? "14px 14px 0 14px" : "14px 14px 14px 0"};
                    max-width:72%;font-size:13px;box-shadow:0 1px 2px rgba(0,0,0,0.08);
                    overflow:hidden;">
          ${_bubbleContent(msg, isMine)}
        </div>`;
      msgBox.appendChild(bubble);
    });
    msgBox.scrollTop = msgBox.scrollHeight;
  }).catch(() => {
    msgBox.innerHTML = `<p style="color:red;text-align:center;font-size:13px;">Load fail.</p>`;
  });
}

/* ── Offline / Online handling ───────────────────────────────────────── */
(function _setupNetworkHandlers() {
  function _offlineToast() {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const existing = document.getElementById("_offline-toast");
    if (existing) return;
    const el = document.createElement("div");
    el.id = "_offline-toast";
    el.className = "toast warn";
    el.style.cssText = "white-space:normal;max-width:280px;text-align:center;line-height:1.4;";
    el.textContent = "📡 Aap offline hain. Please check your connection.";
    container.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("show")));
  }

  function _onlineToast() {
    const el = document.getElementById("_offline-toast");
    if (el) {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 350);
    }
    if (typeof showToast === "function") {
      showToast("✅ Internet connection wapas aa gayi!", "success", 3500);
    }
  }

  window.addEventListener("offline", _offlineToast);
  window.addEventListener("online",  _onlineToast);

  // Check initial state
  if (!navigator.onLine) setTimeout(_offlineToast, 1200);
})();
