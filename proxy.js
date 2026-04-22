// Mobbin 反向代理服务
// 通过这个服务，只有知道密码的人才能通过你的账号访问 mobbin.com

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const axios = require('axios').default;
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const CONFIG = {
  TARGET_URL: 'https://mobbin.com',
  PORT: process.env.PORT || 3000,
  // 🔒 访问密码 - 只知道这个密码的人才能使用
  ACCESS_PASSWORD: 'abc123'
};

// 创建带 Cookie 的请求实例（用于自动登录）
const cookieJar = new CookieJar();
const request = wrapper(axios.create({
  jar: cookieJar,
  withCredentials: true,
  maxRedirects: 5,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
  }
}));

const app = express();

// Cookie 存储
let sharedCookie = '';

// Session 存储
const sessions = {};

// 生成 session token
function generateSessionToken() {
  return Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15);
}

// 验证 session
function isValidSession(token) {
  const session = sessions[token];
  if (session && Date.now() < session.expires) {
    return true;
  }
  return false;
}

// 创建 session
function createSession() {
  const token = generateSessionToken();
  sessions[token] = {
    created: Date.now(),
    expires: Date.now() + 24 * 60 * 60 * 1000  // 24小时过期
  };
  return token;
}

// 中间件：解析 Cookie
app.use((req, res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie || '';
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.trim().split('=');
    if (parts.length >= 2) {
      const name = parts[0];
      const value = parts.slice(1).join('=');
      req.cookies[name] = decodeURIComponent(value);
    }
  });
  next();
});

// 中间件：设置响应 cookie
app.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function(data) {
    const sessionToken = req.cookies.session;
    if (sessionToken && isValidSession(sessionToken)) {
      res.setHeader('Set-Cookie', `session=${sessionToken}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax`);
    }
    originalSend.call(this, data);
  };
  next();
});

// 首页：引导页面
app.get('/', (req, res) => {
  const sessionToken = req.cookies.session;
  if (!isValidSession(sessionToken)) {
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mobbin Proxy - 登录</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 400px;
      margin: 100px auto;
      padding: 20px;
      text-align: center;
    }
    h1 { color: #333; margin-bottom: 30px; }
    .login-box {
      background: #f5f5f5;
      padding: 30px;
      border-radius: 12px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    input[type="password"] {
      width: 100%;
      padding: 12px;
      margin: 15px 0;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 16px;
    }
    button {
      background: #0066cc;
      color: white;
      border: none;
      padding: 12px 30px;
      cursor: pointer;
      border-radius: 6px;
      font-size: 16px;
      width: 100%;
      margin-top: 10px;
    }
    button:hover { background: #0052a3; }
    .error { color: #dc3545; margin-top: 10px; }
  </style>
</head>
<body>
  <h1>🔐 Mobbin 代理</h1>
  <div class="login-box">
    <p>请输入访问密码</p>
    <input type="password" id="password" placeholder="输入密码" autofocus>
    <button onclick="login()">进入</button>
    <p id="errorMsg" class="error"></p>
  </div>
  <script>
    const passwordInput = document.getElementById('password');
    passwordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') login();
    });

    async function login() {
      const password = passwordInput.value;
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (data.success) {
        window.location.href = '/dashboard';
      } else {
        document.getElementById('errorMsg').textContent = '密码错误';
      }
    }
  </script>
</body>
</html>
    `);
    return;
  }
  res.redirect('/dashboard');
});

// 登录 API
app.use(express.json());
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === CONFIG.ACCESS_PASSWORD) {
    const token = createSession();
    res.setHeader('Set-Cookie', `session=${token}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax`);
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, error: '密码错误' });
  }
});

// 设置 Cookie 的 API
app.post('/set-cookie', (req, res) => {
  const sessionToken = req.cookies.session;
  if (!isValidSession(sessionToken)) {
    return res.status(401).json({ success: false, error: '未授权' });
  }

  const { cookie } = req.body;
  if (cookie) {
    sharedCookie = cookie;
    console.log('✅ Cookie 已更新');
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', hasCookie: !!sharedCookie });
});

// Dashboard 页面（需要认证）
app.get('/dashboard', (req, res) => {
  const sessionToken = req.cookies.session;
  if (!isValidSession(sessionToken)) {
    return res.redirect('/');
  }

  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mobbin Proxy</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 50px auto;
;
      padding: 20px;
    }
    h1 { color: #333; }
    .info {
      background: #f5f5f5;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
    }
    button {
      background: #0066cc;
      color: white;
      border: none;
      padding: 12px 24px;
      cursor: pointer;
      border-radius: 6px;
      font-size: 16px;
      width: 100%;
    }
    button:hover { background: #0052a3; }
    button.logout { background: #dc3545; width: auto; padding: 8px 20px; font-size: 14px; }
    button.logout:hover { background: #c82333; }
    textarea {
      width: 100%;
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      resize: vertical;
    }
    label { display: block; margin-top: 15px; font-weight: 500; }
    code { background: #e8e8e8; padding: 2px 6px; border-radius: 4px; }
    .success { color: #28a745; }
    .header { display: flex; justify-content: space-between; align-items: center; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🚀 Mobbin 代理</h1>
    <button class="logout" onclick="logout()">退出</button>
  </div>

  <div class="info">
    <p>通过这个服务，你可以通过你的账号共有 <strong>mobbin.com</strong>，不受设备限制！</p>
    <p>已成功登录 ✅</p>
  </div>

  <div class="info">
    <label>服务器已授权的 Cookie：</label>
    <textarea id="cookieInput" rows="4" placeholder="粘贴你的 Mobbin Cookie...">${sharedCookie || '暂无，请手动输入'}</textarea>
    <button onclick="saveCookie()">保存 Cookie</button>
    <p id="saveMsg"></p>
  </div>

  <div class="info">
    <p>点击下方按钮访问 Mobbin：</p>
    <button onclick="openMobbin()">打开 Mobbin</button>
  </div>

  <div class="info">
    <p><strong>分享链接：</strong></p>
    <p>把分享密码 <code>${CONFIG.ACCESS_PASSWORD}</code> 和访问链接一起分享给信任的人！</p>
    <p>他们输入密码后才能使用。</p>
  </div>

  <div class="info">
    <p>健康检查: <a href="/health">/health</a></p>
  </div>

  <script>
    async function saveCookie() {
      const cookie = document.getElementById('cookieInput').value;
      const res = await fetch('/set-cookie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie })
      });
      const data = await res.json();
      document.getElementById('saveMsg').innerHTML = data.success
        ? '<span class="success">✅ Cookie 保存成功！</span>'
        : '❌ 保存失败';
    }

    function openMobbin() {
      window.open('/', '_blank');
    }

    function logout() {
      document.cookie = 'session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      window.location.href = '/';
    }
  </script>
</body>
</html>
  `);
});

// 创建代理中间件
const proxy = createProxyMiddleware({
  target: CONFIG.TARGET_URL,
  changeOrigin: true,
  ws: true,
  followRedirects: true,
  headers: {
    'X-Forwarded-Host': `localhost:${CONFIG.PORT}`,
    'X-Forwarded-Proto': 'http'
  },
  onProxyReq: (proxyReq, req, res) => {
    if (sharedCookie) {
      const existingCookie = proxyReq.getHeader('cookie') || '';
      proxyReq.setHeader('cookie', sharedCookie + (existingCookie ? '; ' + existingCookie : ''));
    }
    console.log(`📡 代理: ${req.method} ${req.url}`);
  },
  onError: (err, req, res) => {
    console.log(`❌ 代理错误: ${err.message}`);
    res.status(500).send('代理错误: ' + err.message);
  }
});

// 应用代理（排除特定路由）
app.use((req, res, next) => {
  const publicPaths = ['/', '/api/login', '/dashboard', '/set-cookie', '/health'];
  if (publicPaths.includes(req.path)) {
    return next('route');
  }

  // 其他路径需要认证并代理
  if (isValidSession(req.cookies.session)) {
    proxy(req, res, next);
  } else {
    res.redirect('/');
  }
});

// 启动服务
app.listen(CONFIG.PORT, () => {
  console.log(`Server running on port ${CONFIG.PORT}`);
  console.log(`Access password: ${CONFIG.ACCESS_PASSWORD}`);
});
