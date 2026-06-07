/* ==========================================
   MADADGAR APP - JavaScript Core Engine
   ========================================== */

// 1. Firebase Configuration & Initialization
const firebaseConfig = {
  apiKey: "AIzaSyAsD-j7KclZgN01m_0snwA_m9mzoRyvtwU",
  authDomain: "get-my-client-57d42b0c5.firebaseapp.com",
  databaseURL: "https://get-my-client-57d42b0c5-default-rtdb.firebaseio.com",
  projectId: "get-my-client-57d42b0c5",
  storageBucket: "get-my-client-57d42b0c5.appspot.com",
  messagingSenderId: "374246101655",
  appId: "1:374246101655:web:ec2b87fcf3074d21e0ab5f"
};

// Initialize Firebase
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db = firebase.database();
const auth = firebase.auth();

// 2. Global App State Management
const state = {
  user: null,
  users: [],
  posts: [],
  chats: [],
  successCount: 0,
  usersLoaded: false,
  usersError: false,
  adminUserView: null,
  currentChatName: null,
  currentScreen: "home"
};

// Shorthand Selector Helper
const $ = (sel) => document.querySelector(sel);

// HTML Escape Helper
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Show Toast Notification
function showToast(msg, type = "success") {
  const toast = $("#toast-container");
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  setTimeout(() => { toast.classList.remove("show"); }, 3500);
}

/* ==========================================
   DATABASE LISTENERS & DATA FETCHING
   ========================================== */

// Fetch Users
db.ref("users").on("value", (snap) => {
  state.users = [];
  snap.forEach((child) => {
    state.users.push({ id: child.key, ...child.val() });
  });
  state.usersLoaded = true;
  state.usersError = false;
  renderApp();
}, (err) => {
  state.usersLoaded = true;
  state.usersError = true;
  renderApp();
});

// Fetch Posts
db.ref("posts").on("value", (snap) => {
  state.posts = [];
  snap.forEach((child) => {
    state.posts.push({ id: child.key, ...child.val() });
  });
  renderApp();
});

// Fetch Stats Success Count
db.ref("stats/successCount").on("value", (snap) => {
  state.successCount = snap.val() || 0;
  renderAdminStats();
});

/* ==========================================
   ADMIN PANEL RENDERING FUNCTIONS
   ========================================== */

// 1. Render Admin Top Stats
function renderAdminStats() {
  const total = state.users.length;
  const verified = state.users.filter(u => u.emailVerified === true).length;
  const pending = total - verified;

  if ($("#total-signup")) $("#total-signup").textContent = total;
  if ($("#total-verified")) $("#total-verified").textContent = verified;
  if ($("#total-pending")) $("#total-pending").textContent = pending;
  if ($("#total-posts")) $("#total-posts").textContent = state.posts.length;
  if ($("#stat-success")) $("#stat-success").textContent = state.successCount;
}

// 2. Render Registered Users List Table
function renderAdminUsersTable() {
  const body = $("#users-table-body");
  if (!body) return;

  if (!state.usersLoaded) {
    body.innerHTML = `
      <div class="loading-block">
        <div class="spinner"></div>
        <p class="muted small">Users load ho rahe hain...</p>
      </div>
    `;
    return;
  }

  if (state.usersError) {
    body.innerHTML = '<div style="color:red; padding:10px;">Users data fetch nahi ho saka.</div>';
    return;
  }

  if (state.users.length === 0) {
    body.innerHTML = '<div class="empty-block"><div class="big">👤</div><div class="title">Abhi koi user register nahi hai</div></div>';
    return;
  }

  // Calculate post counts per user
  const postCounts = {};
  state.posts.forEach(p => {
    if (p.username) postCounts[p.username] = (postCounts[p.username] || 0) + 1;
  });

  body.innerHTML = state.users.map(u => {
    const pCount = postCounts[u.username] || 0;
    const cleanUsername = escapeHtml(u.username);
    const cleanEmail = escapeHtml(u.email);
    const cleanFullName = escapeHtml(u.fullName || u.name || '');

    return `
      <div class="user-row" onclick="handleUserRowClick(event, '${cleanUsername}')" style="padding: 10px 5px; border-bottom: 1px solid #eee; display: flex; align-items: center; justify-content: space-between; font-size: 13px; cursor: pointer;">
        
        <span style="width: 30%; word-break: break-word; padding-right: 5px;">
          <b>${cleanFullName}</b><br><span style="color:#777; font-size:11px;">(@${cleanUsername})</span>
        </span>
        
        <span style="width: 40%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 5px;" title="${cleanEmail}">
          ${cleanEmail}
        </span>
        
        <span style="width: 12%; text-align: center;">
          ${pCount}
        </span>
        
        <div style="width: 18%; text-align: right;">
          <button class="user-action-btn danger" data-act="delete-user" data-username="${cleanUsername}" style="padding: 4px 8px; font-size: 11px; border-radius: 4px; cursor: pointer; width: 100%;">Delete</button>
        </div>

      </div>
    `;
  }).join('');
}

// Global Click Trigger for User Row
window.handleUserRowClick = function(event, username) {
    if (event.target.classList.contains('user-action-btn') || event.target.closest('.user-action-btn')) {
        return; // Delete button pe click ho to profile na khule
    }
    
    state.adminUserView = username;
    renderAdminUser(); // Load selected user data
    
    // Smooth scroll to target view block
    const box = document.getElementById('admin-user-content') || document.querySelector('#admin-user-content');
    if (box) {
        box.style.display = 'block';
        box.scrollIntoView({ behavior: 'smooth' });
    }
};

// 3. Render Specific User Profile, Posts & Chat Logs
function renderAdminUser() {
  const container = $("#admin-user-content");
  if (!container) return;

  if (!state.adminUserView) {
    container.innerHTML = '<div class="empty-block"><p class="muted">Kisi user par tap karein details dekhne ke liye</p></div>';
    return;
  }

  const u = state.users.find(x => x.username === state.adminUserView);
  if (!u) {
    container.innerHTML = '<div class="empty-block"><div class="title">User nahi mila</div></div>';
    return;
  }

  // Filter posts created by this user
  const userPosts = state.posts.filter(p => p.username === u.username);

  container.innerHTML = `
    <div class="profile-card" style="background: #fff; padding: 15px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); margin-bottom: 20px;">
      <h3>${escapeHtml(u.fullName || u.name || 'No Name')}</h3>
      <p style="color: #555; margin: 5px 0;"><b>Username:</b> @${escapeHtml(u.username)}</p>
      <p style="color: #555; margin: 5px 0;"><b>Email:</b> ${escapeHtml(u.email || 'N/A')}</p>
      <p style="color: #555; margin: 5px 0;"><b>Status:</b> ${u.blocked ? '<span style="color:red;font-weight:bold;">BLOCKED</span>' : '<span style="color:green;font-weight:bold;">ACTIVE</span>'}</p>
    </div>

    <div class="user-chats-section" style="background: #fff; padding: 15px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); margin-bottom: 20px;">
      <h4>💬 User Chats & Logs</h4>
      <div id="admin-chat-logs" style="max-height: 200px; overflow-y: auto; background: #f9f9f9; padding: 10px; border-radius: 4px; font-size: 12px;">
         Loading conversations...
      </div>
    </div>

    <div class="user-posts-section">
      <h4>📝 Posts by ${escapeHtml(u.fullName || u.name || 'User')} (${userPosts.length})</h4>
      ${userPosts.length === 0 ? 
        '<p class="muted" style="font-size:13px;">Is user ne abhi tak koi post nahi ki.</p>' : 
        userPosts.map(p => `
          <div class="post-item" style="background:#fff; padding:10px; border-radius:6px; margin-bottom:10px; border-left:4px solid #25D366; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <b style="font-size:14px;">${escapeHtml(p.title || 'Untitled Post')}</b>
            <p style="font-size:12px; color:#666; margin:5px 0;">${escapeHtml(p.description || p.content || '')}</p>
            <span style="font-size:11px; color:#999;">Category: ${escapeHtml(p.category || 'General')}</span>
          </div>
        `).join('')
      }
    </div>
  `;

  // Dynamic chat loader call
  loadUserChatsInAdmin(u.username);
}

// 4. Load Chat Shortcuts / Rooms inside Admin Panel
function loadUserChatsInAdmin(username) {
  const chatLogBox = $("#admin-chat-logs");
  if (!chatLogBox) return;

  db.ref(`chats`).once("value", (snap) => {
    let html = '';
    let foundChat = false;

    snap.forEach((child) => {
      const roomKey = child.key;
      if (roomKey.includes(username)) {
        foundChat = true;
        html += `<div style="padding: 6px; border-bottom: 1px solid #eee; color:#333;"><b>Room:</b> ${escapeHtml(roomKey)}</div>`;
      }
    });

    if (!foundChat) {
      chatLogBox.innerHTML = '<p class="muted">Is user ki koi chat history nahi mili.</p>';
    } else {
      chatLogBox.innerHTML = html;
    }
  });
}

/* ==========================================
   USER ACTIONS & CORE OPERATIONS
   ========================================== */

// Async function to add / publish post
async function addPost(postData) {
  try {
    const ref = db.ref("posts").push();
    await ref.set({
      ...postData,
      viewCount: 0,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    });
    showToast("Post kamyabi se upload ho gayi!");
  } catch (err) {
    showToast("Post karne mein galti hui: " + err.message, "error");
  }
}

// Click event listener for administrative actions (Delete/Block)
document.addEventListener("click", async (e) => {
  const target = e.target;
  if (!target) return;

  // Handle Delete User click event
  if (target.dataset.act === "delete-user") {
    const targetUsername = target.dataset.username;
    if (!targetUsername) return;

    const confirmDelete = confirm(`⚠️ Kya aap sach mein @${targetUsername} ka account delete karna chahte hain? Saara data khatam ho jayega.`);
    if (!confirmDelete) return;

    try {
      const userObj = state.users.find(u => u.username === targetUsername);
      if (userObj && userObj.id) {
        await db.ref(`users/${userObj.id}`).remove();
        showToast(`User @${targetUsername} kamyabi se delete ho gaya.`);
        
        if (state.adminUserView === targetUsername) {
          state.adminUserView = null;
        }
        renderApp();
      }
    } catch (error) {
      showToast("Delete karne mein galti hui: " + error.message, "error");
    }
  }
});

// Main Orchestrator View Router
function renderApp() {
  renderAdminStats();
  renderAdminUsersTable();
  if (state.adminUserView) {
    renderAdminUser();
  }
}

// Document Trigger On Load
document.addEventListener("DOMContentLoaded", () => {
  renderApp();
});
