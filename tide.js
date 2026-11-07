/* BirdCloud 潮汐表查询
 * 数据源：NOAA Tides & Currents（免费、无需 key、支持跨域）
 * 流程：自动定位 → 找最近 NOAA 潮汐站 → 拉取未来 48 小时高低潮
 * 定位失败时可手动搜索站点；页面每次打开自动拉取最新数据（每日更新）
 */
(function () {
    var locEl = document.getElementById("tideLoc");
    var statusEl = document.getElementById("tideStatus");
    var listEl = document.getElementById("tideList");
    var searchEl = document.getElementById("tideSearch");
    var stationsEl = document.getElementById("tideStations");
    var reloadBtn = document.getElementById("tideReload");
    if (!locEl || !statusEl || !listEl || !searchEl || !stationsEl || !reloadBtn) return;

    var stationCache = null;   // NOAA 潮汐站全量列表缓存
    var currentStation = null;

    function esc(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    // 球面距离（千米）
    function haversine(lat1, lon1, lat2, lon2) {
        var R = 6371;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLon = (lon2 - lon1) * Math.PI / 180;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // ---------- 1. 自动定位 ----------
    function getLocation() {
        return new Promise(function (resolve, reject) {
            if (!navigator.geolocation) { reject(new Error("浏览器不支持定位")); return; }
            navigator.geolocation.getCurrentPosition(function (pos) {
                resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude });
            }, function () {
                reject(new Error("定位被拒绝或失败"));
            }, { timeout: 8000, maximumAge: 600000 });
        });
    }

    // ---------- 2. 潮汐站列表（全量，缓存） ----------
    function loadStations() {
        if (stationCache) return Promise.resolve(stationCache);
        return fetch("https://api.tidesandcurrents.noaa.gov/mdapi/web/api/stations.json?type=waterlevels")
            .then(function (r) {
                if (!r.ok) throw new Error("站点列表获取失败");
                return r.json();
            })
            .then(function (j) {
                var arr = j.stations || [];
                stationCache = arr.filter(function (s) {
                    return typeof s.lat === "number" && typeof s.lng === "number";
                });
                return stationCache;
            });
    }

    // ---------- 3. 找最近的站 ----------
    function nearestStation(stations, lat, lon) {
        var best = null, bestD = Infinity;
        for (var i = 0; i < stations.length; i++) {
            var s = stations[i];
            var d = haversine(lat, lon, s.lat, s.lng);
            if (d < bestD) { bestD = d; best = s; }
        }
        return { station: best, distKm: bestD };
    }

    // ---------- 4. 反向地理编码（OpenStreetMap Nominatim，失败则回退站名） ----------
    function reverseGeo(lat, lon) {
        return fetch("https://nominatim.openstreetmap.org/reverse?lat=" + lat + "&lon=" + lon +
            "&format=json&zoom=9&accept-language=zh")
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
                if (j && j.display_name) return j.display_name;
                return null;
            })
            .catch(function () { return null; });
    }

    // ---------- 5. 拉取未来 48 小时高低潮 ----------
    function fetchTides(stationId) {
        var url = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?" +
            "product=predictions&datum=MLLW&time_zone=lst_ldt&units=metric&interval=hilo&format=json" +
            "&date=today&range=48&station=" + encodeURIComponent(stationId);
        return fetch(url).then(function (r) {
            if (!r.ok) throw new Error("潮汐数据获取失败");
            return r.json();
        }).then(function (j) {
            var preds = j.predictions || [];
            return preds.map(function (p) {
                var m = /(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})\s+(\d{1,2}):(\d{2})/.exec(p.t);
                if (!m) return null;
                return {
                    year: +m[1], mon: +m[2], day: +m[3], hh: +m[4], mm: +m[5],
                    v: parseFloat(p.v),
                    type: p.type === "H" ? "high" : "low"
                };
            }).filter(function (x) { return x !== null; });
        });
    }

    // ---------- 渲染 ----------
    function dayLabel(y, m, d) {
        var now = new Date();
        var t = new Date(y, m - 1, d);
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var diff = Math.round((t - today) / 86400000);
        var label = diff === 0 ? "（今天）" : diff === 1 ? "（明天）" : "";
        var week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][t.getDay()];
        return m + "月" + d + "日 " + week + label;
    }

    function renderTides(items) {
        if (!items || !items.length) {
            listEl.innerHTML = '<div class="empty-hint">暂无潮汐数据</div>';
            return;
        }
        var days = [], map = {};
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var key = it.year + "-" + it.mon + "-" + it.day;
            if (!map[key]) { map[key] = []; days.push(key); }
            map[key].push(it);
        }
        var html = "";
        for (var d = 0; d < days.length; d++) {
            var k = days[d].split("-");
            html += '<div class="tide-day"><h4>' + dayLabel(+k[0], +k[1], +k[2]) + "</h4>";
            var dayItems = map[days[d]];
            for (var j = 0; j < dayItems.length; j++) {
                var it2 = dayItems[j];
                var pad = (it2.hh < 10 ? "0" : "") + it2.hh + ":" + (it2.mm < 10 ? "0" : "") + it2.mm;
                var em = it2.type === "high" ? "⬆️" : "⬇️";
                var tp = it2.type === "high" ? "高潮" : "低潮";
                html += '<div class="tide-row"><span class="t-emoji">' + em + "</span>" +
                    '<span class="t-time">' + pad + "</span>" +
                    '<span class="t-type">' + tp + "</span>" +
                    '<span class="t-height">' + (it2.v > 0 ? "+" : "") + it2.v.toFixed(2) + " m</span></div>";
            }
            html += "</div>";
        }
        listEl.innerHTML = html;
    }

    // ---------- 手动搜索站点 ----------
    searchEl.addEventListener("input", function () {
        var kw = searchEl.value.trim().toLowerCase();
        if (!kw) { stationsEl.style.display = "none"; stationsEl.innerHTML = ""; return; }
        loadStations().then(function (stations) {
            var hits = stations.filter(function (s) {
                return s.name.toLowerCase().indexOf(kw) > -1;
            }).slice(0, 12);
            stationsEl.style.display = "block";
            stationsEl.innerHTML = hits.length ? hits.map(function (s) {
                return '<div class="tide-station" data-id="' + esc(s.id) + '" data-name="' + esc(s.name) + '">📍 ' + esc(s.name) + "</div>";
            }).join("") : '<div class="empty-hint">没有匹配的潮汐站</div>';
        }).catch(function () {
            stationsEl.style.display = "block";
            stationsEl.innerHTML = '<div class="empty-hint">站点列表加载失败</div>';
        });
    });

    stationsEl.addEventListener("click", function (e) {
        var st = e.target.closest ? e.target.closest(".tide-station") : null;
        if (!st) return;
        currentStation = { id: st.getAttribute("data-id"), name: st.getAttribute("data-name") };
        locEl.textContent = "📍 " + currentStation.name;
        searchEl.value = currentStation.name;
        stationsEl.style.display = "none";
        loadTideFor(currentStation);
    });

    // ---------- 指定站点拉数据 ----------
    function loadTideFor(st) {
        statusEl.textContent = "⏳ 加载中…";
        fetchTides(st.id).then(function (items) {
            statusEl.textContent = "数据更新于 " + new Date().toLocaleTimeString() + " · NOAA 潮汐预测（未来 48 小时）";
            renderTides(items);
        }).catch(function (err) {
            statusEl.textContent = "⚠️ " + err.message;
            listEl.innerHTML = "";
        });
    }

    // ---------- 主流程：自动定位 → 最近站 → 潮汐 ----------
    function run() {
        locEl.textContent = "📍 正在定位…";
        statusEl.textContent = "⏳ 定位中…";
        getLocation().then(function (pos) {
            statusEl.textContent = "⏳ 正在查找最近潮汐站…";
            return loadStations().then(function (stations) {
                var near = nearestStation(stations, pos.lat, pos.lon);
                if (!near.station) throw new Error("附近没有可用潮汐站");
                currentStation = near.station;
                return Promise.all([reverseGeo(pos.lat, pos.lon), fetchTides(near.station.id), near]);
            });
        }).then(function (res) {
            var place = res[0] || currentStation.name;
            var near = res[2];
            var distTxt = near.distKm < 100 ? Math.round(near.distKm * 10) / 10 + " km" : Math.round(near.distKm) + " km";
            locEl.textContent = "📍 " + place + "（最近潮汐站：" + currentStation.name + "，约 " + distTxt + "）";
            statusEl.textContent = "数据更新于 " + new Date().toLocaleTimeString() + " · NOAA 潮汐预测（未来 48 小时）";
            renderTides(res[1]);
        }).catch(function (err) {
            locEl.textContent = "📍 定位不可用";
            statusEl.textContent = "⚠️ " + err.message + "，可在下方手动搜索潮汐站";
            listEl.innerHTML = "";
        });
    }

    reloadBtn.addEventListener("click", run);
    run();
})();
