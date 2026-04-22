// Mobbin 反向代理服务
// 通过这个服务，只有知道密码的人才能通过你的账号访问 mobbin.com

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const axios = require('axios').default;
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const crypto = require('crypto');

const CONFIG = {
  TARGET_URL: 'https://mobbin.com',
  PORT: 3000,
  // 🔒 访问密码 - 只知道这个密码的人才能使用
  ACCESS_PASSWORD: 'abc123',  // 修改为你想要的密码
  // Session 密钥
  SESSION_SECRET: 'your-secret-key-change-this'
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

// 生成 session token
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 验证 session
function isValidSession(token) {
  const sessions = global.sessions || {};
  const session = sessions[token];
  if (session && Date.now() < session.expires) {
    return true;
  }
  return false;
}

// 创建 session
function createSession() {
  if (!global.sessions) global.sessions = {};
  const token = generateSessionToken();
  global.sessions[token] = {
    created: Date.now(),
    expires: Date.now() + 24 * 60 * 60 * 1000  // 24小时过期
  };
  return token;
}

// 首页：引导页面
app.get('/', (req, res) => {
  // 检查是否已登录
  const sessionToken = req.cookies.session;
  if (!isValidSession(sessionToken)) {
    // 未登录，显示登录页面
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

  // 已登录，重定向到 dashboard
  res.redirect('/dashboard');
});

// 登录 API
app.use(express.json());
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === CONFIG.ACCESS_PASSWORD) {
    const token = createSession();
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
    <p>通过这个服务，你可以通过你的账号访问 <strong>mobbin.com</strong>，不受设备限制！</p>
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
    'X-Forwarded-Host': 'localhost:3000',
    'X-Forwarded-Proto': 'http'
  },
  onProxyReq: (proxyReq, req, res) => {
    // 注入共享的 Cookie
    if (sharedCookie) {
      const existingCookie = proxyReq.getHeader('cookie') || '';
      proxyReq.setHeader('cookie', sharedCookie + (existingCookie ? '; ' + existingCookie : ''));
    }
  },
  onProxyRes: (proxyRes, req, res) => {
    // 设置 session cookie
    const sessionToken = req.cookies.session;
    if (sessionToken && isValidSession(sessionToken)) {
      // 确保 cookie 传递给客户端
      if (!res.getHeader('set-cookie')) {
        res.setHeader('set-cookie', `session=${sessionToken}; Path=/; Max-Age=86400; HttpOnly`);
      }
    }
  },
  onError: (err, req, res) => {
    console.log(`❌ 代理错误: ${err.message}`);
    res.status(500).send('代理错误: ' + err.message);
  }
});

// 认证中间件
function requireAuth(req, res, next) {
  const sessionToken = req.cookies.session;
  if (!isValidSession(sessionToken)) {
    return res.redirect('/');
  }

  // 设置 session cookie 响应
  if (!res.getHeader('set-cookie')) {
    res.setHeader('set-cookie', `session=${sessionToken}; Path=/; Max-Age=86400; HttpOnly`);
  }
  next();
}

// 设置 session cookie 中间件
app.use((req, res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie || '';
  cookieHeader.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) {
      req.cookies[name] = decodeURIComponent(value);
    }
  });

  // 设置登录成功的 session cookie
  const sessionToken = req.cookies.session;
  if (sessionToken && isValidSession(sessionToken)) {
    if (!res.getHeader('set-cookie')) {
      res.setHeader('set-cookie', `session=${sessionToken}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax`);
    }
  }

  // 处理登录响应的 session 设置
  if (req.path === '/api/login') {
    const originalSend = res.send;
    res.send = function(data) {
      try {
        const jsonData = JSON.parse(data);
        if (jsonData.success && jsonData.token) {
          res.setHeader('set-cookie', `session=${jsonData.token}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax`);
        }
      } catch (e) {}
      originalSend.call(this, data);
    };
  }

  next();
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
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                  🚀 Mobbin 反向代理已启动（密码保护）             ║
╠════════════════════════════════════════════════════════════╣
║  本地访问: http://localhost:${CONFIG.PORT}                      ║
║  局域网访问: http://YOUR_IP:${CONFIG.PORT}                    ║
║                                                              ║
║  🔒 访问密码: ${CONFIG.ACCESS_PASSWORD}                            ║
║                                                              ║
║  使用方法：                                                   ║
║  1. 访问 http://localhost:${CONFIG.PORT}                     ║
║  2. 输入密码: ${CONFIG.ACCESS_PASSWORD}                                  ║
║  3. 粘贴你的 Mobbin Cookie 并保存                           ║
║  4. 分享链接 + 密码给信任的人！                             ║
║                                                              ║
║  ⚠️  只有知道密码的人才能使用！                             ║
╚════════════════════════════════════════════════════════════╝
  `);
});
