/* BirdCloud 鸟云首页 天气互动背景（全站统一）
 * 四种模式：晴天（白云蓝天）/ 阴天（灰云）/ 雨天（雨滴+灰云）/ 夜晚（星光+月牙+薄云）
 * 切换时天空颜色在约 2 秒内平滑渐变，云/雨/星随之自然浮现
 * 选择会记住（localStorage）；鼠标移动如风般推动云朵
 * 纯 ES5，兼容旧浏览器；canvas 置于内容层之下，不拦截点击 */
(function () {
    "use strict";
    var dpr = window.devicePixelRatio || 1;
    var canvas = document.createElement("canvas");
    canvas.id = "cloud-bg";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;";
    document.body.insertBefore(canvas, document.body.firstChild);
    var ctx = canvas.getContext("2d");
    var W = 0, H = 0;

    // ---------- 模式配置 ----------
    var MODES = {
        sunny:  { skyTop: "#bcdcf8", skyBottom: "#e9f4fc" },
        cloudy: { skyTop: "#9aa7b5", skyBottom: "#d3dbe2" },
        rainy:  { skyTop: "#5f6d7c", skyBottom: "#9aa7b2" },
        night:  { skyTop: "#081226", skyBottom: "#1c3350" }
    };
    var CLOUDS = {
        sunny:  { c: ["255,255,255", "255,255,255", "255,255,255"], ea: 0.32, n: [0.68, 0.88], f: [0.42, 0.55], mul: 1.0 },
        cloudy: { c: ["216,222,228", "205,212,220", "188,197,206"], ea: 0.38, n: [0.60, 0.78], f: [0.40, 0.52], mul: 1.1 },
        rainy:  { c: ["168,178,188", "150,162,174", "132,144,156"], ea: 0.42, n: [0.55, 0.72], f: [0.38, 0.50], mul: 1.35 },
        night:  { c: ["58,78,104", "46,64,88", "36,52,74"], ea: 0.40, n: [0.30, 0.42], f: [0.20, 0.30], mul: 0.55 }
    };

    var current = "sunny";
    var clouds = [], drops = [], stars = [], feathers = [];
    var mouse = { x: -9999, y: -9999, vx: 0, vy: 0, moved: false };
    var lastT = 0;

    // 过渡状态：切换后天空色从 fromSky 平滑渐变到新模式，元素渐显
    var fade = 1;                       // 0..1 新场景显现度（1 = 完全显示）
    var fromSky = { top: null, bottom: null };

    // 羽毛颜色：羽片 / 羽轴（随天气模式变化）
    var FEATHERS = {
        sunny:  { f: "255,255,255", s: "214,232,248" },
        cloudy: { f: "232,238,244", s: "196,208,220" },
        rainy:  { f: "206,216,228", s: "168,180,194" },
        night:  { f: "186,200,218", s: "138,153,176" }
    };

    function rand(a, b) { return a + Math.random() * (b - a); }

    // ---------- 颜色工具 ----------
    function hex2rgb(h) {
        h = h.replace("#", "");
        return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
    }
    function mixRGB(c1, c2, k) {
        return "rgb(" + Math.round(c1[0] + (c2[0] - c1[0]) * k) + "," +
                       Math.round(c1[1] + (c2[1] - c1[1]) * k) + "," +
                       Math.round(c1[2] + (c2[2] - c1[2]) * k) + ")";
    }

    // ---------- 云朵 ----------
    function makeCloud(far) {
        var cfg = CLOUDS[current];
        var blobs = [];
        var n = 3 + Math.floor(Math.random() * 4);
        var baseR = 30 + Math.random() * 46;
        for (var i = 0; i < n; i++) {
            blobs.push({
                dx: rand(-baseR * 1.15, baseR * 1.15),
                dy: rand(-baseR * 0.35, baseR * 0.5),
                r: baseR * rand(0.45, 1.0)
            });
        }
        return {
            x: Math.random() * (W + 500) - 250,
            y: rand(0.04, 0.94) * H,
            blobs: blobs,
            scale: far ? rand(0.55, 0.9) : rand(1.0, 1.85),
            opacity: far ? rand(cfg.f[0], cfg.f[1]) : rand(cfg.n[0], cfg.n[1]),
            speed: far ? rand(6, 11) : rand(13, 26),
            pushX: 0,
            sway: rand(0, Math.PI * 2),
            swayAmp: rand(3, 13),
            swayFreq: rand(0.25, 0.6)
        };
    }

    function drawCloud(c, k) {
        var cfg = CLOUDS[current];
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.scale(c.scale, c.scale);
        ctx.globalAlpha = c.opacity * k;
        for (var i = 0; i < c.blobs.length; i++) {
            var b = c.blobs[i];
            var g = ctx.createRadialGradient(b.dx, b.dy, 0, b.dx, b.dy, b.r);
            g.addColorStop(0, "rgba(" + cfg.c[0] + ",1)");
            g.addColorStop(0.55, "rgba(" + cfg.c[1] + ",0.88)");
            g.addColorStop(1, "rgba(" + cfg.c[2] + "," + cfg.ea + ")");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(b.dx, b.dy, b.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
    }

    // ---------- 雨滴（分层透视：近粗亮快、远细淡慢） ----------
    function makeDrop() {
        var z = Math.random();   // 0 = 远景雨，1 = 近景雨
        return {
            x: Math.random() * (W + 300) - 150,
            y: Math.random() * H * 0.95,
            z: z,
            len: 10 + z * 32,
            sp: 380 + z * 560,
            slant: rand(-0.8, 0.8),
            alpha: 0.22 + z * 0.62
        };
    }

    function drawDrop(d, k) {
        ctx.strokeStyle = "rgba(215, 232, 250, " + (d.alpha * k).toFixed(3) + ")";
        ctx.lineWidth = 0.8 + d.z * 1.9;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.slant * d.len * 0.45, d.y + d.len);
        ctx.stroke();
    }

    // ---------- 星星 ----------
    function makeStar() {
        return {
            x: Math.random() * W,
            y: Math.random() * H * 0.85,
            r: rand(0.6, 1.8),
            phase: Math.random() * Math.PI * 2,
            sp: rand(2, 5)
        };
    }

    function drawStar(s, t, k) {
        var a = (0.25 + 0.65 * (0.5 + 0.5 * Math.sin(s.phase + t * s.sp))) * k;
        if (s.r > 1.4) {
            var g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 5);
            g.addColorStop(0, "rgba(255,255,240," + (a * 0.28).toFixed(3) + ")");
            g.addColorStop(1, "rgba(255,255,240,0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r * 5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = "rgba(255,255,240," + a.toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
    }

    // ---------- 羽毛（鼠标拖尾） ----------
    function drawFeather(f) {
        var c = FEATHERS[current];
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rot);
        ctx.scale(f.scale, f.scale);
        ctx.globalAlpha = f.alpha;
        // 羽片：左右两条贝塞尔包络成柳叶形
        ctx.fillStyle = "rgba(" + c.f + "," + f.alpha.toFixed(3) + ")";
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-7, -11, -4.5, -24);
        ctx.quadraticCurveTo(-5, -29, 0, -34);
        ctx.quadraticCurveTo(5, -29, 4.5, -24);
        ctx.quadraticCurveTo(7, -11, 0, 0);
        ctx.closePath();
        ctx.fill();
        // 羽轴
        ctx.strokeStyle = "rgba(" + c.s + ",1)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(0, 1);
        ctx.lineTo(0, -33);
        ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
    }

    // ---------- 构建当前模式的场景 ----------
    function buildSky() {
        var cfg = CLOUDS[current];
        var cn = Math.max(12, Math.round(W / 180) * cfg.mul);
        clouds = [];
        for (var i = 0; i < cn; i++) {
            clouds.push(makeCloud(Math.random() < 0.5));
        }
        drops = [];
        if (current === "rainy") {
            var dn = Math.round((W * H) / 7000);   // 更密的雨丝
            for (var j = 0; j < dn; j++) drops.push(makeDrop());
        }
        stars = [];
        if (current === "night") {
            var sn = Math.round((W * H) / 15000);
            for (var k = 0; k < sn; k++) stars.push(makeStar());
        }
    }

    function resize() {
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        buildSky();
    }

    // ---------- 鼠标如风 ----------
    function windApply(o, reach, vxK, vyK) {
        var dx = o.x - mouse.x, dy = o.y - mouse.y;
        var d2 = dx * dx + dy * dy;
        var r2 = reach * reach;
        if (d2 < r2 && d2 > 0.01) {
            var f = (1 - d2 / r2);
            o.pushX += mouse.vx * vxK * f;
        }
    }

    function frame(t) {
        var dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016;
        lastT = t;

        // 过渡：约 1.2 秒内 fade 0 → 1（smoothstep 缓动），点击后迅速生效
        if (fade < 1) fade = Math.min(1, fade + dt / 1.2);
        var k = fade * fade * (3 - 2 * fade);

        ctx.clearRect(0, 0, W, H);

        // 天空：旧色平滑渐变到新色
        var g = ctx.createLinearGradient(0, 0, 0, H);
        if (fromSky.top) {
            g.addColorStop(0, mixRGB(fromSky.top, hex2rgb(MODES[current].skyTop), k));
            g.addColorStop(1, mixRGB(fromSky.bottom, hex2rgb(MODES[current].skyBottom), k));
        } else {
            g.addColorStop(0, MODES[current].skyTop);
            g.addColorStop(1, MODES[current].skyBottom);
        }
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        // 云（所有模式都有，随鼠标如风推动）
        var i;
        for (i = 0; i < clouds.length; i++) {
            var c = clouds[i];
            c.sway += dt * c.swayFreq;
            if (mouse.moved) windApply(c, 210, 0.05, 0.02);
            c.pushX *= 0.94;
            c.x += (c.speed + c.pushX) * dt;
            c.y += Math.sin(c.sway) * c.swayAmp * 0.06 * dt;
            if (c.x > W + 300) {
                c.x = -280;
                c.y = rand(0.04, 0.94) * H;
                c.pushX = 0;
            }
            drawCloud(c, k);
        }

        // 雨滴
        if (current === "rainy") {
            for (i = 0; i < drops.length; i++) {
                var d = drops[i];
                d.y += d.sp * dt;
                d.x += d.slant * d.sp * 0.3 * dt;
                if (d.y > H + 30) {
                    d.y = -30;
                    d.x = Math.random() * (W + 200) - 100;
                }
                drawDrop(d, k);
            }
        }

        // 星星（夜晚）
        if (current === "night") {
            for (i = 0; i < stars.length; i++) drawStar(stars[i], t / 1000, k);
        }

        // 羽毛拖尾（所有模式都有，随鼠标风飘动）
        for (i = 0; i < feathers.length; i++) {
            var f = feathers[i];
            f.vx *= 0.985;
            f.vy *= 0.985;
            f.x += f.vx * dt;
            f.y += f.vy * dt;
            f.rot = f.baseRot + Math.sin(f.phase + t * 0.004) * 0.28;
            f.alpha -= dt * 0.9;
            if (f.alpha > 0.02) drawFeather(f);
        }
        feathers = feathers.filter(function (f) { return f.alpha > 0.02; });

        // 持续动画：每一帧再次调度（缺失会导致背景静止不动）
        requestAnimationFrame(frame);
    }

    // 切换天气：点击后约 1 秒多自然渐变完成（同模式点击也重建，保证有反馈）
    function setWeather(mode) {
        fromSky = { top: hex2rgb(MODES[current].skyTop), bottom: hex2rgb(MODES[current].skyBottom) };
        current = mode;
        buildSky();
        fade = 0;
        try { localStorage.setItem("birdcloudBgMode", mode); } catch (e) { }
        var el = document.getElementById("weatherSwitch");
        if (el) {
            var btns = el.querySelectorAll("button");
            for (var m = 0; m < btns.length; m++) {
                btns[m].className = (btns[m].getAttribute("data-mode") === mode ? "on" : "");
            }
        }
    }
    // 暴露给页面按钮 onclick 直接调用
    window.setWeather = setWeather;

    // ---------- 右下角切换按钮 ----------
    function bindSwitch() {
        var el = document.getElementById("weatherSwitch");
        if (!el) return;
        var btns = el.querySelectorAll("button");
        var stored = null;
        try { stored = localStorage.getItem("birdcloudBgMode"); } catch (e) { }
        if (stored && MODES[stored]) {
            current = stored;
            buildSky();   // 同步重建粒子，避免与存储模式不匹配
        }
        for (var i = 0; i < btns.length; i++) {
            (function (btn) {
                if (btn.getAttribute("data-mode") === current) btn.className = "on";
                btn.addEventListener("click", function () {
                    setWeather(btn.getAttribute("data-mode"));
                });
            })(btns[i]);
        }
    }

    // ---------- 事件 ----------
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", function (e) {
        var nx = e.clientX, ny = e.clientY;
        mouse.vx = nx - mouse.x;
        mouse.vy = ny - mouse.y;
        mouse.x = nx;
        mouse.y = ny;
        mouse.moved = true;
        // 鼠标移动时撒出羽毛（节流：随机概率 + 上限）
        if (Math.random() < 0.75) {
            feathers.push({
                x: nx + rand(-8, 8),
                y: ny + rand(-8, 8),
                vx: mouse.vx * 0.22 + rand(-15, 15),
                vy: mouse.vy * 0.22 + rand(-20, 6),
                rot: rand(-0.4, 0.4),
                baseRot: rand(-0.5, 0.5),
                phase: rand(0, Math.PI * 2),
                scale: rand(0.8, 1.6),
                alpha: rand(0.55, 0.9)
            });
            if (feathers.length > 45) feathers.shift();
        }
    });

    resize();
    bindSwitch();
    requestAnimationFrame(frame);
})();
