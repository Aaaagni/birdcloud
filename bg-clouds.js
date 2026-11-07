/* BirdCloud 鸟云首页 白云流动互动背景
 * 白云缓缓漂移，鼠标移动如风般推动云朵，并带出淡淡气流涟漪
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

    var clouds = [];
    var mouse = { x: -9999, y: -9999, vx: 0, vy: 0, moved: false };
    var puffs = [];   // 鼠标气流涟漪
    var lastT = 0;

    function rand(a, b) { return a + Math.random() * (b - a); }

    // ---------- 云朵 ----------
    function makeCloud(far) {
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
            opacity: far ? rand(0.42, 0.55) : rand(0.68, 0.88),  // 更白更明显
            speed: far ? rand(6, 11) : rand(13, 26),   // px/s
            pushX: 0,
            sway: rand(0, Math.PI * 2),
            swayAmp: rand(3, 13),
            swayFreq: rand(0.25, 0.6)
        };
    }

    function build() {
        clouds = [];
        var cn = Math.max(12, Math.round(W / 180));
        for (var i = 0; i < cn; i++) {
            clouds.push(makeCloud(Math.random() < 0.5));
        }
    }

    function resize() {
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        build();
    }

    window.addEventListener("mousemove", function (e) {
        var px = mouse.x, py = mouse.y;
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        mouse.vx = mouse.x - px;
        mouse.vy = mouse.y - py;
        mouse.moved = true;
        var sp = Math.sqrt(mouse.vx * mouse.vx + mouse.vy * mouse.vy);
        if (sp > 0.5) {
            puffs.push({
                x: e.clientX, y: e.clientY,
                r: 10, a: 0.5, life: 1,
                vx: mouse.vx * 0.22, vy: mouse.vy * 0.22
            });
            if (puffs.length > 14) puffs.shift();
        }
    });
    window.addEventListener("touchmove", function (e) {
        if (e.touches && e.touches.length) {
            var t = e.touches[0];
            mouse.vx = t.clientX - mouse.x;
            mouse.vy = t.clientY - mouse.y;
            mouse.x = t.clientX;
            mouse.y = t.clientY;
            mouse.moved = true;
        }
    }, { passive: true });
    window.addEventListener("resize", resize);

    function drawCloud(c) {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.scale(c.scale, c.scale);
        ctx.globalAlpha = c.opacity;
        for (var i = 0; i < c.blobs.length; i++) {
            var b = c.blobs[i];
            var g = ctx.createRadialGradient(b.dx, b.dy, 0, b.dx, b.dy, b.r);
            g.addColorStop(0, "rgba(255,255,255,1)");
            g.addColorStop(0.55, "rgba(255,255,255,0.88)");
            g.addColorStop(1, "rgba(255,255,255,0.32)");   // 边缘更实，轮廓清晰
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(b.dx, b.dy, b.r, 0, 6.2832);
            ctx.fill();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
    }

    // 鼠标如风：靠近的云被推着走
    function windApply(o, reach, vxK, vyK) {
        var dx = mouse.x - o.x;
        var dy = mouse.y - o.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < reach) {
            var f = (1 - dist / reach) * 1.5;
            o.pushX += mouse.vx * f * vxK;
            o.y += mouse.vy * f * vyK;
        }
    }

    function frame(t) {
        var dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016;
        lastT = t;
        ctx.clearRect(0, 0, W, H);

        var i, j;
        for (i = 0; i < clouds.length; i++) {
            var c = clouds[i];
            c.sway += dt * c.swayFreq;
            if (mouse.moved) windApply(c, 230 * c.scale, 0.05, 0.02);
            c.pushX *= 0.93;
            c.x += (c.speed + c.pushX) * dt;
            c.y += Math.sin(c.sway) * c.swayAmp * 0.06 * dt;
            if (c.x > W + 350) {
                c.x = -280;
                c.y = rand(0.04, 0.94) * H;
                c.pushX = 0;
            }
            drawCloud(c);
        }

        // 气流涟漪（淡蓝线圈，随鼠标方向飘散）
        for (j = puffs.length - 1; j >= 0; j--) {
            var p = puffs[j];
            p.x += p.vx * dt * 12;
            p.y += p.vy * dt * 12;
            p.r += 1.1;
            p.a *= 0.94;
            p.life -= 0.02;
            p.vx *= 0.97;
            p.vy *= 0.97;
            if (p.life <= 0 || p.a < 0.02) { puffs.splice(j, 1); continue; }
            ctx.globalAlpha = Math.max(0, p.a * 0.32);
            ctx.strokeStyle = "#bfe3ff";
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, 6.2832);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        requestAnimationFrame(frame);
    }

    resize();
    requestAnimationFrame(frame);
})();
