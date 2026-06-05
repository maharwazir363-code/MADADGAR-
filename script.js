/* ==========================================================================
   MADADGAR - Pure vanilla JS app (Firebase RTDB via compat SDK)
   ========================================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyAs1-49V_ek2rD9YmU6WffQipjijMyzo64",
  authDomain: "gem-lang-client-0758284005.firebaseapp.com",
  databaseURL: "https://gem-lang-client-0758284005-default-rtdb.firebaseio.com",
  projectId: "gem-lang-client-0758284005",
  storageBucket: "gem-lang-client-0758284005.appspot.com",
  messagingSenderId: "570844080170",
  appId: "1:570844080170:web:3a35a26d377d7a8210bb53"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
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
  viewedThisSession: new Set()
};

/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */
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
  if (m < 60) return `${m}m run pehle`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ghante pehle`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} din pehle`;
  return new Date(ts).toLocaleDateString("en-PK", {
    day: "numeric",
    month: "short",
    year: "numeric"
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

/* --------------------------------------------------------------------------
   App Initialization & Listeners
   -------------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  initApp();
});

function initApp() {
  const saved = localStorage.getItem(USER_KEY);
  if (saved) {
    try {
      state.user = JSON.parse(saved);
      state.currentScreen = "home";
    } catch (e) {
      localStorage.removeItem(USER_KEY);
    }
  }
  listenToPosts();
  listenToUsers();
  render();
}

function listenToPosts() {
  db.ref("posts").on("value", (snapshot) => {
    const arr = [];
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        arr.push({ id: child.key, ...child.val() });
      });
    }
    arr.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    state.posts = arr;
    state.postsLoaded = true;
    render();
  }, (err) => {
    console.error("Posts error:", err);
  });
}

function listenToUsers() {
  db.ref("users").on("value", (snapshot) => {
    const arr = [];
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        arr.push({ id: child.key, ...child.val() });
      });
    }
    state.users = arr;
    state.usersLoaded = true;
    state.usersError = null;
    render();
  }, (err) => {
    console.error("Users error:", err);
    state.usersError = err.message;
    render();
  });
}

/* --------------------------------------------------------------------------
   Actions / Logic
   -------------------------------------------------------------------------- */
function handleLogin(e) {
  e.preventDefault();
  const phone = $("#login-phone").value.trim();
  const pass = $("#login-password").value;
  showError("login-error", "");
  
  if (!phone || !pass) {
    showError("login-error", "Meharbani kar k tamam fields pur karein.");
    return;
  }
  const found = state.users.find(u => u.id === phone);
  if (!found) {
    showError("login-error", "Yeh Phone Number register nahi hai.");
    return;
  }
  if (found.password !== pass) {
    showError("login-error", "Galt Password! Dobara koshish karein.");
    return;
  }
  state.user = found;
  localStorage.setItem(USER_KEY, JSON.stringify(found));
  state.currentScreen = "home";
  render();
}

function handleRegister(e) {
  e.preventDefault();
  const name = $("#reg-name").value.trim();
  const phone = $("#reg-phone").value.trim();
  const pass = $("#reg-password").value;
  const role = $("#reg-role").value;
  showError("reg-error", "");
  
  if (!name || !phone || !pass) {
    showError("reg-error", "Tamam fields lazmi hain.");
    return;
  }
  if (phone.length < 10) {
    showError("reg-error", "Sahi phone number likhein.");
    return;
  }
  if (state.users.some(u => u.id === phone)) {
    showError("reg-error", "Yeh phone number pehle se register hai.");
    return;
  }
  const newUser = {
    name,
    password: pass,
    role,
    timestamp: firebase.database.ServerValue.TIMESTAMP
  };
  db.ref("users/" + phone).set(newUser)
    .then(() => {
      state.user = { id: phone, ...newUser };
      localStorage.setItem(USER_KEY, JSON.stringify(state.user));
      state.currentScreen = "home";
      render();
    })
    .catch(err => {
      showError("reg-error", "Server Error: " + err.message);
    });
}

function handleCreatePost(e) {
  e.preventDefault();
  if (!state.user) return;
  
  const title = $("#post-title").value.trim();
  const category = $("#post-category").value;
  const desc = $("#post-desc").value.trim();
  const address = $("#post-address").value.trim();
  const phone = $("#post-phone").value.trim();
  showError("post-error", "");
  
  if (!title || !desc || !address || !phone) {
    showError("post-error", "Tamam malomat bharna lazmi hain.");
    return;
  }
  const postData = {
    title, category, desc, address, phone,
    type: state.postType,
    userId: state.user.id,
    userName: state.user.name,
    timestamp: firebase.database.ServerValue.TIMESTAMP,
    views: 0
  };
  let ref = db.ref("posts");
  let operation = null;
  
  if (state.editPostId) {
    const old = state.posts.find(p => p.id === state.editPostId);
    if (old) {
      postData.views = old.views || 0;
      postData.userId = old.userId;
      postData.userName = old.userName;
    }
    operation = ref.child(state.editPostId).set(postData);
  } else {
    operation = ref.push(postData);
  }
  operation
    .then(() => {
      state.currentScreen = "home";
      state.editPostId = null;
      render();
    })
    .catch(err => {
      showError("post-error", err.message);
    });
}

function deletePost(id) {
  if (!confirm("Kya aap waqai yeh post delete karna chahte hain?")) return;
  db.ref("posts/" + id).remove()
    .then(() => {
      if (state.currentScreen === "admin_dashboard") {
        render();
      } else {
        state.currentScreen = "home";
        render();
      }
    })
    .catch(alert);
}

function incrementViewOnce(post) {
  if (state.viewedThisSession.has(post.id)) return;
  state.viewedThisSession.add(post.id);
  db.ref("posts/" + post.id + "/views").transaction((current) => {
    return (current || 0) + 1;
  });
}

function handleAdminLogin(e) {
  e.preventDefault();
  const pass = $("#admin-pass-input").value;
  if (pass === ADMIN_PASSWORD) {
    state.currentScreen = "admin_dashboard";
    render();
  } else {
    alert("Galt Admin Password!");
  }
}

function logout() {
  state.user = null;
  localStorage.removeItem(USER_KEY);
  state.currentScreen = "login";
  render();
}

/* --------------------------------------------------------------------------
   The Main Render Function
   -------------------------------------------------------------------------- */
function render() {
  $$(".screen").forEach(s => s.hidden = true);
  const active = $("#screen-" + state.currentScreen);
  if (active) active.hidden = false;
  
  if (state.currentScreen === "home") {
    renderHome();
  } else if (state.currentScreen === "post_form") {
    renderPostForm();
  } else if (state.currentScreen === "admin_dashboard") {
    renderAdminDashboard();
  }
}

/* --------------------------------------------------------------------------
   Screen UI Generators
   -------------------------------------------------------------------------- */
function renderHome() {
  if (!state.user) return;
  
  $("#home-user-name").textContent = state.user.name;
  $("#home-user-role").textContent = state.user.role === "provider" ? "Service Provider" : "Job Seeker";
  
  if (state.filter === "find_jobs") {
    $("#btn-filter-jobs").style.background = "#056158";
    $("#btn-filter-jobs").style.color = "#fff";
    $("#btn-filter-providers").style.background = "#f5f5f5";
    $("#btn-filter-providers").style.color = "#333";
  } else {
    $("#btn-filter-providers").style.background = "#056158";
    $("#btn-filter-providers").style.color = "#fff";
    $("#btn-filter-jobs").style.background = "#f5f5f5";
    $("#btn-filter-jobs").style.color = "#333";
  }
  
  const container = $("#posts-container");
  container.innerHTML = "";
  
  if (!state.postsLoaded) {
    container.innerHTML = `<div class="loading-spinner">Data load ho raha hai... Meharbani farmayein...</div>`;
    return;
  }
  
  let filtered = state.posts.filter(p => {
    const targetType = state.filter === "find_jobs" ? "job_seeker" : "provider";
    if (p.type !== targetType) return false;
    if (state.addressSearch) {
      const addr = (p.address || "").toLowerCase();
      if (!addr.includes(state.addressSearch.toLowerCase())) return false;
    }
    if (state.categorySearch) {
      if (p.category !== state.categorySearch) return false;
    }
    return true;
  });
  
  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:40px; color:#666;">Koi posts nahi milin.</div>`;
    return;
  }
  
  filtered.forEach(p => {
    const card = document.createElement("div");
    card.className = "post-card";
    const isOwn = p.userId === state.user.id;
    const deleteBtnHtml = isOwn ? `<button class="btn-delete" onclick="deletePost('${p.id}')">Delete</button>` : "";
    const editBtnHtml = isOwn ? `<button class="btn-edit" onclick="openEditPost('${p.id}')">Edit</button>` : "";
    
    card.innerHTML = `
      <div class="post-header">
        <span class="post-category-tag">${escapeHtml(p.category || "General")}</span>
        <span class="post-time">${timeAgo(p.timestamp)}</span>
      </div>
      <h3 class="post-title">${escapeHtml(p.title)}</h3>
      <p class="post-desc">${escapeHtml(p.desc)}</p>
      <div class="post-meta-row">
        <span>📍 ${escapeHtml(p.address)}</span>
        <span>👁️ ${p.views || 0}</span>
      </div>
      <div class="post-author">By: ${escapeHtml(p.userName || "Anjaan")}</div>
      <div class="post-actions">
        <a class="call-link" href="tel:${p.phone}" onclick="registerView('${p.id}')">📞 Call Karein</a>
        ${editBtnHtml}
        ${deleteBtnHtml}
      </div>
    `;
    container.appendChild(card);
  });
}

function registerView(id) {
  const p = state.posts.find(x => x.id === id);
  if (p) incrementViewOnce(p);
}

function openEditPost(id) {
  const p = state.posts.find(x => x.id === id);
  if (!p) return;
  state.editPostId = id;
  state.postType = p.type || "job_seeker";
  state.currentScreen = "post_form";
  render();
  setTimeout(() => {
    $("#post-form-title").textContent = "Post Edit Karein";
    $("#post-title").value = p.title || "";
    $("#post-category").value = p.category || "Mistry/Labour";
    $("#post-desc").value = p.desc || "";
    $("#post-address").value = p.address || "";
    $("#post-phone").value = p.phone || "";
  }, 50);
}

function renderPostForm() {
  if (!state.editPostId) {
    $("#post-form-title").textContent = state.postType === "job_seeker" ? "Naukri Ki Post Lagayein" : "Apni Service Ki Post Lagayein";
    $("#post-title").value = "";
    $("#post-desc").value = "";
    $("#post-address").value = state.user ? state.user.address || "" : "";
    $("#post-phone").value = state.user ? state.user.id || "" : "";
  }
}

function renderAdminDashboard() {
  $("#admin-total-users").textContent = state.users.length;
  $("#admin-total-posts").textContent = state.posts.length;
  const uList = $("#admin-users-list");
  uList.innerHTML = "";
  
  state.users.forEach(u => {
    const li = document.createElement("li");
    li.style = "padding:10px; border-bottom:1px solid #ddd; display:flex; justify-content:space-between; align-items:center;";
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(u.name)}</strong> (${u.id})<br>
        <small>Role: ${u.role} | Pass: ${u.password}</small>
      </div>
      <button style="background:#d9534f; color:#fff; border:none; padding:5px 10px; borderRadius:4px;" onclick="deleteUser('${u.id}')">Delete</button>
    `;
    uList.appendChild(li);
  });
}

function deleteUser(phone) {
  if (!confirm(`Kya aap user ${phone} aur uski tamam posts delete karna chahte hain?`)) return;
  db.ref("users/" + phone).remove().then(() => {
    state.posts.forEach(p => {
      if (p.userId === phone) db.ref("posts/" + p.id).remove();
    });
    alert("User kamyabi se delete ho gaya.");
  }).catch(alert);
}

function setFilter(type) {
  state.filter = type;
  renderHome();
}

function navigateToPostForm(type) {
  state.editPostId = null;
  state.postType = type;
  state.currentScreen = "post_form";
  render();
}

function navigateTo(screen) {
  state.currentScreen = screen;
  state.editPostId = null;
  render();
}

function triggerSearch() {
  state.addressSearch = $("#search-address").value.trim();
  state.categorySearch = $("#search-category").value;
  renderHome();
}
