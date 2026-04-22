// Mobbin 反向代理服务
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const CONFIG = {
  TARGET_URL: 'https://mobbin.com',
  PORT: process.env.PORT || 3000,
  ACCESS_PASSWORD: 'abc123'
};

const app = express();

// Session 存储
const sessions = {};

// 生成 session ID
function generateSessionId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// 设置 session cookie
function setSessionCookie(res, sessionId) {
  res.cookie('session', sessionId, {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax'
  });
}

// 中间件：解析 Cookie
app.use((req, res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie || '';
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.trim().split('=');
    if (parts.length >= 2) {
      req.cookies[parts[0]] = parts.slice(1).join('=');
    }
  });
  req.sessionId = req.cookies.session || req.query.session;
  next();
});

// 登录页面
app.get('/', (req, res) => {
  const sessionId = req.sessionId;
  const isValid = sessionId && sessions[sessionId];

  if (isValid) {
    return res.redirect('/dashboard');
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
    body { font-family: -apple-system, sans-serif; max-width: 400px; margin: 100px auto; padding: 20px; text-align: center; }
    .box { background: #f5f5f5; padding: 30px; border-radius: 12px; }
    input { width: 100%; padding: 12px; margin: 15px 0; border: 1px solid #ddd; border-radius: 6px; }
    button { background: #0066cc; color: white; border: none; padding: 12px 30px; cursor: pointer; border-radius: 6px; width: 100%; }
    button:hover { background: #0052a3; }
    .error { color: #dc3545; margin-top: 10px; }
  </style>
</head>
<body>
  <h1>🔐 Mobbin Proxy</h1>
  <div class="box">
    <p>请输入访问密码</p>
    <input type="password" id="password" placeholder="输入密码" autofocus>
    <button onclick="login()">进入</button>
    <p id="errorMsg" class="error"></p>
  </div>
  <script>
    const passwordInput = document.getElementById('password');
    passwordInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') login();
    });

    async function login() {
      const password = passwordInput.value;
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
          credentials: 'include'
        });
        const data = await res.json();
        if (data.success) {
          window.location.href = '/dashboard';
        } else {
          document.getElementById('errorMsg').textContent = '密码错误';
        }
      } catch (e) {
        document.getElementById('errorMsg').textMsg = '网络错误：' + e.message;
      }
    }
  </script>
</body>
</html>
  `);
});

// 登录 API
app.use(express.json());
app.post('/api/login', function(req, res) {
  const password = req.body.password;

  if (password === CONFIG.ACCESS_PASSWORD) {
    const sessionId = generateSessionId();
    sessions[sessionId] = {
      created: Date.now(),
      expires: Date.now() + 24 * 60 * 60 * 1000
    };

    setSessionCookie(res, sessionId);
    console.log('✅ Login success, sessionId:', sessionId);
    res.json({ success: true, sessionId });
  } else {
    console.log('❌ Login failed');
    res.status(401).json({ success: false, error: '密码错误' });
  }
});

// Dashboard
app.get('/dashboard', function(req, res) {
  const sessionId = req.sessionId;
  const isValid = sessionId && sessions[sessionId];

  console.log('Dashboard access: sessionId=', sessionId, 'isValid=', isValid);

  if (!isValid) {
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
    body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
    .info { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
    button { background: #0066cc; color: white; border: none; padding: 12px 24px; cursor: pointer; border-radius: 6px; width: 100%; }
    button:hover { background: #0052a3; }
    button.logout { background: #dc3545; width: auto; padding: 8px 20px; font-size: 14px; }
    textarea { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; resize: vertical; }
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
    <p>已成功登录 ✅</p>
    <p>分享链接给他人：把密码 <code>${CONFIG.ACCESS_PASSWORD}</code> 和链接一起分享</p>
  </div>

  <div class="info">
    <label>Mobbin Cookie：</label>
    <textarea id="cookieInput" rows="4" placeholder="粘贴你的 Mobbin Cookie...">${global.mobbinCookie || '暂无，请手动输入'}</textarea>
    <button onclick="saveCookie()">保存 Cookie</button>
    <p id="saveMsg"></p>
  </div>

  <div class="info">
    <p>点击下方按钮访问 Mobbin：</p>
    <button onclick="openMobbin()">打开 Mobbin</button>
    <p style="font-size: 12px; color: #666; margin-top: 10px;">提示：如果还是需要登录，请尝试刷新页面</p>
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
        body: JSON.stringify({ cookie }),
        credentials: 'include'
      });
      const data = await res.json();
      document.getElementById('saveMsg').innerHTML = data.success
        ? '<span class="success">✅ Cookie 保存成功！</span>'
        : '❌ 保存失败';
    }

    function openMobbin() {
      window.location.href = '/mob/search';
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

// 设置 Cookie API
app.post('/set-cookie', function(req, res) {
  const sessionId = req.sessionId;
  if (!sessionId || !sessions[sessionId]) {
    return res.status(401).json({ success: false, error: '未授权' });
  }

  const cookie = req.body.cookie;
  if (cookie) {
    global.mobbinCookie = cookie;
    console.log('✅ Mobbin Cookie 已保存');
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// 健康检查
app.get('/health', function(req, res) {
  res.json({ status: 'ok', hasCookie: !!global.mobbinCookie, sessions: Object.keys(sessions).length });
});

// 创建代理中间件
const proxy = createProxyMiddleware({
  target: CONFIG.TARGET_URL,
  changeOrigin: true,
  ws: true,
  followRedirects: true,
  headers: {
    'X-Forwarded-Host': 'mobbin-proxy.onrender.com',
    'X-Forwarded-Proto': 'https'
  },
  onProxyReq: function(proxyReq, req, res) {
    if (global.mobbinCookie) {
      proxyReq.setHeader('cookie', global.mobbinCookie);
      console.log('🍪 Setting Mobbin Cookie for:', req.url);
    }
    console.log('📡 Proxy: ' + req.method + ' ' + req.url);
  },
  onError: function(err, req, res) {
    console.log('❌ Proxy error: ' + err.message);
    res.status(500).send('代理错误: ' + err.message);
  }
});

// 通配符中间件 - 处理所有其他路由
app.use(function(req, res, next) {
  const publicPaths = ['/', '/api/login', '/dashboard', '/set-cookie', '/health', '/favicon.ico'];
  if (publicPaths.includes(req.path)) {
    return next();
  }

  // 检查 session
  const sessionId = req.sessionId;
  if (!sessionId || !sessions[sessionId]) {
    return res.redirect('/');
  }

  // 处理 /mob 开头的路径 - 转发到 mobbin.com
  if (req.path.startsWith('/mob')) {
    const proxyPath = req.path.substring(4) || '/';
    req.url = proxyPath + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
    console.log('🔄 Proxied to:', req.url);
  } else {
    // 其他路径也直接代理
    console.log('🔄 Direct proxy:', req.path);
  }

  proxy(req, res, next);
});

// 启动服务
app.listen(CONFIG.PORT, function() {
  console.log('✅ Server running on port ' + CONFIG.PORT);
  console.log('🔒 Access password: ' + CONFIG.ACCESS_PASSWORD);
});
